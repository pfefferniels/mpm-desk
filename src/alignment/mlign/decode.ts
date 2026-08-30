/**
 * The MLign decode: model similarity logits → alignment triples.
 *
 * A port of `decode()` in `MLign/src/mlign/infer.py`, reproducing it to the
 * triple. The pipeline is:
 *
 *   1. dual softmax over `sim` with the null columns appended → confidence;
 *   2. mutual-argmax, pitch-equal, high-confidence anchors, thinned to a
 *      monotone chain;
 *   3. onset-cluster DTW over a blended pitch/confidence cost, unioned with
 *      those anchors → a score-time → perf-time map;
 *   4. per-pitch monotone assignment under that map, twice: round two
 *      re-interpolates the map from round one's matches;
 *   5. a greedy same-pitch rescue for leftovers, then labelling.
 *
 * ## Why this file is written the way it is
 *
 * The goal is bit-level agreement with NumPy, not merely "the same algorithm".
 * NumPy's defaults differ from JavaScript's in ways that change discrete
 * outcomes — an argmax tie, a DTW backtrack step, a longest-chain pick — and a
 * single flipped decision inside a repeated-pitch run silently mis-aligns a
 * passage. So the awkward-looking parts below are deliberate:
 *
 * - float32 is emulated with `Math.fround` wherever NumPy stores or reduces in
 *   float32, and left alone wherever NumPy has already widened to float64. The
 *   two are mixed within single expressions; see `clusterDtwMap`.
 * - float32 sums use NumPy's pairwise reduction, not a running total. This is
 *   not a refinement: verified against the fixtures, a naive float32 sum gets
 *   3 of 328 softmax row sums wrong and a float64 sum gets 6 wrong, while the
 *   pairwise order reproduces all 328 bit-for-bit.
 * - argmax, `np.unique`, `np.interp` and the DTW tie order are reimplemented to
 *   NumPy's semantics rather than the nearest JS idiom.
 *
 * One difference is not removable in pure JS: `np.exp` on a float32 array uses
 * NumPy's own single-precision kernel, and JS only offers a float64 `Math.exp`.
 * Rounding the float64 result disagrees with NumPy on ~0.3% of cells by one
 * ULP. That noise is far below every threshold and margin the decode tests, and
 * the golden fixtures confirm it changes no stage output; see the test file.
 */

import { clusterStarts, clusterPitchSets, jaccardMatrix, dtwPath } from "./dtw";
import type { IndexTriple, MlignRow, SimBundle } from "./types";
import {
    ANCHOR_CONF,
    CONF_BONUS_FACTOR,
    DTW_CONF_GAIN,
    DTW_GAP_DECODE,
    PERF_CLUSTER_EPS,
    PERF_MS_PER_SEC,
    PPQ,
    RESCUE_SEC,
    SCORE_CLUSTER_EPS,
    SKIP_FACTOR,
    TOL_SEC,
    ASSIGN_INF,
} from "./types";

const fr = Math.fround;

/**
 * NumPy's pairwise float32 reduction (`FLOAT_pairwise_sum`): eight interleaved
 * accumulators up to a 128-element block, recursive halving above it, and the
 * halving point rounded down to a multiple of eight.
 *
 * The summation order is part of the result, not an implementation detail — the
 * softmax denominators it feeds decide anchor thresholds and argmax ties.
 */
export function sumF32(a: Float32Array, off: number, len: number): number {
    if (len < 8) {
        let res = 0;
        for (let i = 0; i < len; i++) res = fr(res + a[off + i]);
        return res;
    }
    if (len <= 128) {
        const r = new Float32Array(8);
        for (let k = 0; k < 8; k++) r[k] = a[off + k];
        let i = 8;
        const stop = len - (len % 8);
        for (; i < stop; i += 8) {
            for (let k = 0; k < 8; k++) r[k] = fr(r[k] + a[off + i + k]);
        }
        let res = fr(fr(fr(r[0] + r[1]) + fr(r[2] + r[3])) + fr(fr(r[4] + r[5]) + fr(r[6] + r[7])));
        for (; i < len; i++) res = fr(res + a[off + i]);
        return res;
    }
    let n2 = len >> 1;
    n2 -= n2 % 8;
    return fr(sumF32(a, off, n2) + sumF32(a, off + n2, len - n2));
}

/**
 * `argmax` over one strided run, returning the index of the FIRST maximum.
 *
 * NumPy's rule, and not what a `reduce` that keeps the latest best would give.
 * It decides real cases here: a score note no window covered has an all-zero
 * confidence row, so every column ties and only this rule says which one the
 * mutual-argmax anchor test then rejects.
 */
export function firstArgmax(
    values: Float32Array,
    off: number,
    stride: number,
    count: number
): number {
    let arg = 0;
    let mx = -Infinity;
    for (let k = 0; k < count; k++) {
        const v = values[off + k * stride];
        if (v > mx) {
            mx = v;
            arg = k;
        }
    }
    return arg;
}

/** `_softmax` over one contiguous float32 row, in place. */
function softmaxRow(buf: Float32Array, off: number, len: number): void {
    let mx = -Infinity;
    for (let i = 0; i < len; i++) if (buf[off + i] > mx) mx = buf[off + i];
    for (let i = 0; i < len; i++) buf[off + i] = fr(Math.exp(fr(buf[off + i] - mx)));
    const s = sumF32(buf, off, len);
    for (let i = 0; i < len; i++) buf[off + i] = fr(buf[off + i] / s);
}

/** Dual-softmax confidence plus the null shares the labelling step needs. */
export interface Confidence {
    /** `sm_s * sm_p.T`, row-major `(n, m)`. */
    conf: Float32Array;
    /** Null share of each score note's softmax mass — a deletion's confidence. */
    nullShareS: Float64Array;
    /** Null share of each perf note's softmax mass — an insertion's confidence. */
    nullShareP: Float64Array;
}

/**
 * The decode's working matrix: softmax each score row over `[sim_i | null_s_i]`
 * and each perf row over `[sim_j | null_p_j]`, then multiply the two directions.
 *
 * The per-note null shares the Python recomputes at labelling time are taken
 * from the same two softmaxes here. That is not a shortcut — a 1-D softmax over
 * `concatenate([sim[i], [null_s[i]]])` reduces over exactly the same contiguous
 * values in the same order as row `i` of the 2-D one, so the results are
 * bit-identical, and recomputing would only cost a second pass.
 *
 * Exported so the dual-softmax stage can be checked against `conf.f32.bin`
 * before the rest of the decode is trusted.
 */
export function dualSoftmax(bundle: SimBundle): Confidence {
    const { n, m, sim, nullS, nullP } = bundle;

    // sm_s: (n, m+1), each row [sim_i | null_s_i].
    const wa = m + 1;
    const smS = new Float32Array(n * wa);
    for (let i = 0; i < n; i++) {
        smS.set(sim.subarray(i * m, i * m + m), i * wa);
        smS[i * wa + m] = nullS[i];
        softmaxRow(smS, i * wa, wa);
    }

    // sm_p: (m, n+1), each row [sim^T_j | null_p_j].
    const wb = n + 1;
    const smP = new Float32Array(m * wb);
    for (let j = 0; j < m; j++) {
        const off = j * wb;
        for (let i = 0; i < n; i++) smP[off + i] = sim[i * m + j];
        smP[off + n] = nullP[j];
        softmaxRow(smP, off, wb);
    }

    const conf = new Float32Array(n * m);
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < m; j++) conf[i * m + j] = fr(smS[i * wa + j] * smP[j * wb + i]);
    }

    const nullShareS = new Float64Array(n);
    for (let i = 0; i < n; i++) nullShareS[i] = smS[i * wa + m];
    const nullShareP = new Float64Array(m);
    for (let j = 0; j < m; j++) nullShareP[j] = smP[j * wb + n];

    return { conf, nullShareS, nullShareP };
}

/**
 * `np.interp` for one query point: piecewise linear over `(xp, fp)`, clamped to
 * the endpoint *values* — not extrapolated — outside the range.
 *
 * Follows NumPy's `arr_interp`, including the single-point case (every query
 * returns `fp[0]`) and the exact-hit shortcut that returns `fp[j]` without
 * touching the slope.
 *
 * The interior interpolation can land one ULP from NumPy's. On arm64 the C
 * compiler contracts `slope * (x - dx[j]) + dy[j]` into a fused multiply-add,
 * rounding once where this rounds twice, and JS has no FMA to match it with.
 * Emulating one would be the wrong target anyway: whether NumPy fuses at all
 * depends on the machine that built it, so matching this one would break
 * against fixtures generated on another. Everything the decode branches on —
 * the clamps, the exact-knot hits, the single-point case — is bit-exact, and a
 * ULP of a time in seconds is ~1e-15 s against a tolerance of 1 s.
 */
export function interp(x: number, xp: Float64Array, fp: Float64Array): number {
    const len = xp.length;
    if (len === 1) return fp[0];
    if (x < xp[0]) return fp[0];
    if (x > xp[len - 1]) return fp[len - 1];

    // Largest j with xp[j] <= x; the guards above bound it to [0, len-1].
    let lo = 0;
    let hi = len - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (xp[mid] <= x) lo = mid;
        else hi = mid - 1;
    }
    const j = lo;
    if (j === len - 1) return fp[j];
    if (xp[j] === x) return fp[j];

    const slope = (fp[j + 1] - fp[j]) / (xp[j + 1] - xp[j]);
    let res = slope * (x - xp[j]) + fp[j];
    if (Number.isNaN(res)) {
        res = slope * (x - xp[j + 1]) + fp[j + 1];
        if (Number.isNaN(res) && fp[j] === fp[j + 1]) res = fp[j];
    }
    return res;
}

/**
 * `np.unique(values, return_index=True)`: the distinct values ascending, and
 * for each the index of its *first* occurrence in the input.
 *
 * Implemented as NumPy does it — a stable argsort, then the head of each run —
 * so that when several entries share a value the earliest input position wins.
 * That tie-break decides which perf time a duplicated score onset maps to.
 */
export function uniqueWithIndex(values: Float64Array): { values: Float64Array; index: Int32Array } {
    const k = values.length;
    const order = new Int32Array(k);
    for (let i = 0; i < k; i++) order[i] = i;
    const sorted = Array.from(order).sort((p, q) =>
        values[p] < values[q] ? -1 : values[p] > values[q] ? 1 : p - q
    );

    const outV: number[] = [];
    const outI: number[] = [];
    for (let i = 0; i < k; i++) {
        const idx = sorted[i];
        if (i === 0 || values[idx] !== outV[outV.length - 1]) {
            outV.push(values[idx]);
            outI.push(idx);
        }
    }
    return { values: Float64Array.from(outV), index: Int32Array.from(outI) };
}

/**
 * The longest chain of anchors increasing in both score and perf time
 * (`_monotone_subset`): patience sorting with `bisect_right`, then a
 * back-link walk to recover the chain itself.
 *
 * `bisect_right` rather than `bisect_left` is what makes the chain
 * non-decreasing in perf time — simultaneous perf notes may share an onset and
 * must be allowed to coexist in the chain.
 */
export function monotoneSubset(
    anchors: readonly (readonly [number, number])[],
    sOnset: Float64Array,
    pOnset: Float64Array
): [number, number][] {
    if (anchors.length === 0) return [];

    const sortedAnchors = anchors.slice().sort((a, b) => {
        const sa = sOnset[a[0]];
        const sb = sOnset[b[0]];
        if (sa !== sb) return sa < sb ? -1 : 1;
        const pa = pOnset[a[1]];
        const pb = pOnset[b[1]];
        return pa < pb ? -1 : pa > pb ? 1 : 0;
    });

    const tails: number[] = [];
    const tailIdx: number[] = [];
    const links: number[] = new Array(sortedAnchors.length);
    for (let k = 0; k < sortedAnchors.length; k++) {
        const t = pOnset[sortedAnchors[k][1]];
        // bisect_right: first position whose tail is strictly greater than t.
        let lo = 0;
        let hi = tails.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (t < tails[mid]) hi = mid;
            else lo = mid + 1;
        }
        const pos = lo;
        if (pos === tails.length) {
            tails.push(t);
            tailIdx.push(k);
        } else {
            tails[pos] = t;
            tailIdx[pos] = k;
        }
        links[k] = pos > 0 ? tailIdx[pos - 1] : -1;
    }

    const out: [number, number][] = [];
    let k = tailIdx[tails.length - 1];
    while (k >= 0) {
        out.push([sortedAnchors[k][0], sortedAnchors[k][1]]);
        k = links[k];
    }
    out.reverse();
    return out;
}

/**
 * `_cluster_dtw_map`: a dense monotone time map from an onset-cluster DTW whose
 * cost blends pitch-set overlap with mean model confidence.
 *
 * The float widths here are mixed and the mix is load-bearing. The cluster mean
 * is a float32 reduction (NumPy's `.mean()` over a float32 block sums and
 * divides in float32), the blend around it is float64 because the Python calls
 * `float()` on that mean, and the result narrows to float32 once, on the store
 * into the cost matrix.
 */
function clusterDtwMap(
    sOnset: Float64Array,
    sPitch: Int32Array,
    pOnset: Float64Array,
    pPitch: Int32Array,
    conf: Float32Array,
    n: number,
    m: number
): { ax: Float64Array; ay: Float64Array } {
    const sStarts = clusterStarts(sOnset, SCORE_CLUSTER_EPS);
    const pStarts = clusterStarts(pOnset, PERF_CLUSTER_EPS);
    const ns = sStarts.length;
    const mp = pStarts.length;
    const sSets = clusterPitchSets(sPitch, sStarts, n);
    const pSets = clusterPitchSets(pPitch, pStarts, m);
    const jac = jaccardMatrix(sSets, pSets);

    const cost = new Float32Array(ns * mp);
    // Scratch for the largest cluster pair — a chord against one 50 ms window,
    // so a few dozen cells, not the whole matrix.
    const widest = (starts: Int32Array, total: number) => {
        let w = 0;
        for (let k = 0; k < starts.length; k++) {
            const size = (k + 1 < starts.length ? starts[k + 1] : total) - starts[k];
            if (size > w) w = size;
        }
        return w;
    };
    const block = new Float32Array(Math.max(1, widest(sStarts, n) * widest(pStarts, m)));
    for (let i = 0; i < ns; i++) {
        const sLo = sStarts[i];
        const sHi = i + 1 < ns ? sStarts[i + 1] : n;
        for (let j = 0; j < mp; j++) {
            const pLo = pStarts[j];
            const pHi = j + 1 < mp ? pStarts[j + 1] : m;

            // Gather the block contiguously: NumPy's fancy indexing materialises
            // it before reducing, and the pairwise sum depends on that layout.
            let k = 0;
            for (let si = sLo; si < sHi; si++) {
                const off = si * m;
                for (let pj = pLo; pj < pHi; pj++) block[k++] = conf[off + pj];
            }
            const cConf = k > 0 ? fr(sumF32(block, 0, k) / k) : NaN;

            cost[i * mp + j] =
                0.5 * (1.0 - jac[i * mp + j]) +
                0.5 * (1.0 - Math.min(1.0, cConf * DTW_CONF_GAIN));
        }
    }

    const path = dtwPath(cost, ns, mp, DTW_GAP_DECODE);
    const ax = new Float64Array(path.length / 2);
    const ay = new Float64Array(path.length / 2);
    for (let t = 0; t < path.length; t += 2) {
        ax[t / 2] = sOnset[sStarts[path[t]]];
        ay[t / 2] = pOnset[pStarts[path[t + 1]]];
    }
    return { ax, ay };
}

/**
 * `_assign_monotone`: a small edit-distance DP pairing expected times against
 * actual ones, monotonically, with skips allowed on both sides.
 *
 * This DP is float64 throughout — the Python allocates it without a dtype — so
 * no rounding happens here except on the confidence bonus, which is float32
 * because it comes off a float32 slice and NumPy 2's scalar promotion keeps the
 * weak Python float on the narrower type.
 *
 * Ties resolve to a match first, then a score skip, then a perf skip.
 */
function assignMonotone(
    expected: Float64Array,
    actual: Float64Array,
    tol: number,
    confBlock: Float32Array
): [number, number][] {
    const a = expected.length;
    const b = actual.length;
    const skip = tol * SKIP_FACTOR;
    const w = b + 1;
    const dp = new Float64Array((a + 1) * w);
    for (let j = 0; j <= b; j++) dp[j] = j * skip;
    for (let i = 0; i <= a; i++) dp[i * w] = i * skip;
    const back = new Int8Array((a + 1) * w);

    const bonusScale = fr(CONF_BONUS_FACTOR * tol);
    for (let i = 1; i <= a; i++) {
        for (let j = 1; j <= b; j++) {
            const delta = Math.abs(expected[i - 1] - actual[j - 1]);
            const matchCost =
                dp[(i - 1) * w + (j - 1)] +
                (delta <= tol ? delta - fr(bonusScale * confBlock[(i - 1) * b + (j - 1)]) : ASSIGN_INF);
            const delCost = dp[(i - 1) * w + j] + skip;
            const insCost = dp[i * w + (j - 1)] + skip;
            const best = Math.min(matchCost, delCost, insCost);
            dp[i * w + j] = best;
            back[i * w + j] = best === matchCost ? 0 : best === delCost ? 1 : 2;
        }
    }

    const pairs: [number, number][] = [];
    let i = a;
    let j = b;
    while (i > 0 && j > 0) {
        const step = back[i * w + j];
        if (step === 0) {
            pairs.push([i - 1, j - 1]);
            i -= 1;
            j -= 1;
        } else if (step === 1) {
            i -= 1;
        } else {
            j -= 1;
        }
    }
    pairs.reverse();
    return pairs;
}

/** Per-stage intermediates, for checking the decode against golden fixtures. */
export interface DecodeTrace {
    conf: Float32Array;
    anchorsRaw: [number, number][];
    anchors: [number, number][];
    dtwAx: Float64Array;
    dtwAy: Float64Array;
    map1Ax: Float64Array;
    map1Ay: Float64Array;
    map2Ax: Float64Array | null;
    map2Ay: Float64Array | null;
    roundsRun: number;
    round1MatchedS: Int32Array;
    round2MatchedS: Int32Array | null;
    rescued: [number, number][];
}

export interface DecodeOptions {
    anchorConf?: number;
    tolSec?: number;
}

/** The decode, with every intermediate stage exposed. */
export function decodeTraced(
    row: MlignRow,
    bundle: SimBundle,
    options: DecodeOptions = {}
): { triples: IndexTriple[]; trace: DecodeTrace } {
    const anchorConf = options.anchorConf ?? ANCHOR_CONF;
    const tolSec = options.tolSec ?? TOL_SEC;
    const { n, m } = bundle;

    const sPitch = new Int32Array(n);
    const sOnset = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        sPitch[i] = row.score[i][2];
        sOnset[i] = row.score[i][0] / PPQ;
    }
    const pPitch = new Int32Array(m);
    const pOnset = new Float64Array(m);
    for (let j = 0; j < m; j++) {
        pPitch[j] = row.perf[j][2];
        pOnset[j] = row.perf[j][0] / PERF_MS_PER_SEC;
    }

    const { conf, nullShareS, nullShareP } = dualSoftmax(bundle);

    // --- phase 1: monotone time map.
    const bestP = new Int32Array(n);
    for (let i = 0; i < n; i++) bestP[i] = firstArgmax(conf, i * m, 1, m);
    const bestS = new Int32Array(m);
    for (let j = 0; j < m; j++) bestS[j] = firstArgmax(conf, j, m, n);

    const anchorsRaw: [number, number][] = [];
    for (let i = 0; i < n; i++) {
        const j = bestP[i];
        if (bestS[j] === i && conf[i * m + j] >= anchorConf && sPitch[i] === pPitch[j]) {
            anchorsRaw.push([i, j]);
        }
    }
    const anchors = monotoneSubset(anchorsRaw, sOnset, pOnset);

    const { ax: dtwAx, ay: dtwAy } = clusterDtwMap(sOnset, sPitch, pOnset, pPitch, conf, n, m);

    // Union, not choice: the DTW path densifies the gaps between sparse anchors,
    // and the anchors sharpen the path where the model is confident. The
    // concatenation order matters — where an anchor lands on an onset the DTW
    // already covers, `uniqueWithIndex` keeps the first, so the DTW value wins.
    const total = dtwAx.length + anchors.length;
    const catX = new Float64Array(total);
    const catY = new Float64Array(total);
    catX.set(dtwAx, 0);
    catY.set(dtwAy, 0);
    for (let k = 0; k < anchors.length; k++) {
        catX[dtwAx.length + k] = sOnset[anchors[k][0]];
        catY[dtwAx.length + k] = pOnset[anchors[k][1]];
    }
    const order = Array.from({ length: total }, (_, i) => i).sort((p, q) =>
        catX[p] < catX[q] ? -1 : catX[p] > catX[q] ? 1 : p - q
    );
    const sortedX = new Float64Array(total);
    const sortedY = new Float64Array(total);
    for (let k = 0; k < total; k++) {
        sortedX[k] = catX[order[k]];
        sortedY[k] = catY[order[k]];
    }

    // Fewer than two points is not a degenerate map but no map at all: the
    // Python falls back to `np.zeros_like`, sending every score note to time 0
    // and letting the tolerance gate reject nearly everything. The trace records
    // an empty map to say so, rather than the lone unusable point.
    let map1Ax: Float64Array = new Float64Array(0);
    let map1Ay: Float64Array = new Float64Array(0);
    let s2pTime: (x: number) => number;
    if (total >= 2) {
        const uniq = uniqueWithIndex(sortedX);
        map1Ax = uniq.values;
        map1Ay = new Float64Array(uniq.index.length);
        for (let k = 0; k < uniq.index.length; k++) map1Ay[k] = sortedY[uniq.index[k]];
        const rx = map1Ax;
        const ry = map1Ay;
        s2pTime = (x) => interp(x, rx, ry);
    } else {
        s2pTime = () => 0;
    }

    // --- phase 2: per-pitch assignment, twice.
    const matchedS = new Int32Array(n).fill(-1);
    const matchedP = new Int32Array(m).fill(-1);

    // Rarest pitch first, as the Python does. The order cannot change the
    // result — each pitch draws from its own disjoint pool of score and perf
    // notes — so `np.argsort`'s unstable tie-break among equal counts is not
    // something this port has to reproduce. Kept for readability, not effect.
    const counts = new Map<number, number>();
    for (let i = 0; i < n; i++) counts.set(sPitch[i], (counts.get(sPitch[i]) ?? 0) + 1);
    const pitchOrder = [...counts.keys()].sort((p, q) => p - q);
    pitchOrder.sort((p, q) => (counts.get(p) as number) - (counts.get(q) as number));

    let roundsRun = 0;
    let round1MatchedS: Int32Array = new Int32Array(0);
    let round2MatchedS: Int32Array | null = null;
    let map2Ax: Float64Array | null = null;
    let map2Ay: Float64Array | null = null;

    for (let round = 0; round < 2; round++) {
        matchedS.fill(-1);
        matchedP.fill(-1);
        roundsRun = round + 1;

        for (const pitch of pitchOrder) {
            const si: number[] = [];
            for (let i = 0; i < n; i++) if (sPitch[i] === pitch && matchedS[i] === -1) si.push(i);
            const pj: number[] = [];
            for (let j = 0; j < m; j++) if (pPitch[j] === pitch && matchedP[j] === -1) pj.push(j);
            if (si.length === 0 || pj.length === 0) continue;

            const expected = new Float64Array(si.length);
            for (let k = 0; k < si.length; k++) expected[k] = s2pTime(sOnset[si[k]]);
            const actual = new Float64Array(pj.length);
            for (let k = 0; k < pj.length; k++) actual[k] = pOnset[pj[k]];
            const confBlock = new Float32Array(si.length * pj.length);
            for (let k = 0; k < si.length; k++) {
                for (let l = 0; l < pj.length; l++) {
                    confBlock[k * pj.length + l] = conf[si[k] * m + pj[l]];
                }
            }

            for (const [ai, bj] of assignMonotone(expected, actual, tolSec, confBlock)) {
                matchedS[si[ai]] = pj[bj];
                matchedP[pj[bj]] = si[ai];
            }
        }

        if (round === 0) {
            round1MatchedS = matchedS.slice();
            const got: number[] = [];
            for (let i = 0; i < n; i++) if (matchedS[i] >= 0) got.push(i);
            if (got.length < 8) break;
            const pairs2 = monotoneSubset(
                got.map((i) => [i, matchedS[i]] as [number, number]),
                sOnset,
                pOnset
            );
            if (pairs2.length < 8) break;

            const rxAll = Float64Array.from(pairs2, ([i]) => sOnset[i]);
            const ryAll = Float64Array.from(pairs2, ([, j]) => pOnset[j]);
            const uniq = uniqueWithIndex(rxAll);
            const rx = uniq.values;
            const ry = new Float64Array(uniq.index.length);
            for (let k = 0; k < uniq.index.length; k++) ry[k] = ryAll[uniq.index[k]];
            map2Ax = rx;
            map2Ay = ry;
            // Rebind: round two runs against the map built from round one.
            s2pTime = (x) => interp(x, rx, ry);
        } else {
            round2MatchedS = matchedS.slice();
        }
    }

    // Residual rescue: an unmatched score note and an unmatched perf note of the
    // same pitch, close together under the map, are almost always a pair the DP
    // dropped on a local order violation. Greedy nearest-first.
    const byPitchP = new Map<number, number[]>();
    for (let j = 0; j < m; j++) {
        if (matchedP[j] < 0) {
            const list = byPitchP.get(pPitch[j]);
            if (list) list.push(j);
            else byPitchP.set(pPitch[j], [j]);
        }
    }
    const cands: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
        if (matchedS[i] >= 0) continue;
        const exp = s2pTime(sOnset[i]);
        for (const j of byPitchP.get(sPitch[i]) ?? []) {
            const d = Math.abs(pOnset[j] - exp);
            if (d <= RESCUE_SEC) cands.push([d, i, j]);
        }
    }
    // Python sorts the (d, i, j) tuples, so equal distances break on i then j.
    // Sorting on distance alone would pick a different pair among ties.
    cands.sort((p, q) => (p[0] !== q[0] ? p[0] - q[0] : p[1] !== q[1] ? p[1] - q[1] : p[2] - q[2]));
    const rescued: [number, number][] = [];
    for (const [, i, j] of cands) {
        if (matchedS[i] < 0 && matchedP[j] < 0) {
            matchedS[i] = j;
            matchedP[j] = i;
            rescued.push([i, j]);
        }
    }

    const triples: IndexTriple[] = [];
    for (let i = 0; i < n; i++) {
        if (matchedS[i] >= 0) {
            const j = matchedS[i];
            triples.push({ label: "match", scoreIdx: i, perfIdx: j, confidence: conf[i * m + j] });
        } else {
            triples.push({ label: "deletion", scoreIdx: i, confidence: nullShareS[i] });
        }
    }
    for (let j = 0; j < m; j++) {
        if (matchedP[j] < 0) {
            triples.push({ label: "insertion", perfIdx: j, confidence: nullShareP[j] });
        }
    }

    return {
        triples,
        trace: {
            conf,
            anchorsRaw,
            anchors,
            dtwAx,
            dtwAy,
            map1Ax,
            map1Ay,
            map2Ax,
            map2Ay,
            roundsRun,
            round1MatchedS,
            round2MatchedS,
            rescued,
        },
    };
}

/** Model similarity logits → alignment triples over table indices. */
export function decode(
    row: MlignRow,
    bundle: SimBundle,
    options: DecodeOptions = {}
): IndexTriple[] {
    return decodeTraced(row, bundle, options).triples;
}
