/**
 * How a piece is cut up for the model, and the classical baseline that decides
 * where the cuts land.
 *
 * Mirrors `MLign/src/mlign/infer.py:accumulate_logits` (the whole-piece / windowed
 * choice) and `coarse_windows`, plus the `align_baseline` it leans on from
 * `MLign/src/mlign/baseline.py`.
 *
 * A piece short enough to fit `MAX_SINGLE_TOKENS` goes to the model whole. A
 * longer one is walked in overlapping windows of `WIN_SCORE` score notes at a
 * stride of half that, and each window is paired with the stretch of the
 * performance it plausibly covers. Finding that stretch is what the baseline is
 * for: a cheap onset-cluster DTW with pitch-set Jaccard costs gives a scatter of
 * anchor pairs, and the perf range of a window is the span of the anchors falling
 * inside it, widened by `MARGIN_SEC` at each end.
 *
 * The baseline is only a router here, so it need not be good — but it does need
 * to be *identical*, because a single anchor moved by one note can shift a window
 * boundary and change what the model ever gets to see.
 */

import { clusterPitchSets, clusterStarts, dtwPath, jaccardMatrix } from "./dtw";
import {
    DTW_GAP_BASELINE,
    MARGIN_SEC,
    MAX_SINGLE_TOKENS,
    PERF_CLUSTER_EPS,
    PERF_MS_PER_SEC,
    PPQ,
    SCORE_CLUSTER_EPS,
    WIN_SCORE,
    type MlignRow,
    type Window,
} from "./types";

/**
 * The constants the Python keeps as module-level globals.
 *
 * They are options rather than hardcoded because the fixtures override them:
 * `schubert-d783-15-win128` is generated with `WIN_SCORE = 128` and
 * `MAX_SINGLE_TOKENS = 0`, so that a 646-token piece yields five real windows in
 * 1 MB of fixture instead of the Berceuse's 25 MB. Its manifest records that in
 * `meta.overrides`, and anything reproducing the fixture has to pass the same
 * values or it is comparing two different plans — which is exactly what a
 * hardcoded 384 did on the first run.
 *
 * There is deliberately no stride knob: the Python derives the stride inside
 * `coarse_windows` as `WIN_SCORE // 2`, so it is not independently settable.
 */
export interface WindowOptions {
    /** Score notes per window. Default `WIN_SCORE`. */
    winScore?: number;
    /** At or below this many tokens the piece goes through whole. Default `MAX_SINGLE_TOKENS`. */
    maxSingleTokens?: number;
    /** Slack at each end of a window's perf range, in seconds. Default `MARGIN_SEC`. */
    marginSec?: number;
}

/**
 * The windows the whole piece is run in.
 *
 * A piece of `maxSingleTokens` tokens or fewer is one window covering
 * everything — which is also what the golden manifests record for the pieces
 * that fit, so this is the function their `windows` array is the contract for.
 */
export function planWindows(row: MlignRow, options: WindowOptions = {}): Window[] {
    const n = row.score.length;
    const m = row.perf.length;
    if (2 + n + m <= (options.maxSingleTokens ?? MAX_SINGLE_TOKENS)) return [[0, n, 0, m]];
    return coarseWindows(row, options);
}

/**
 * Score windows and the perf range each is paired with.
 *
 * The last window is not necessarily stride-aligned: the loop steps by half a
 * window but stops as soon as a window reaches the end of the score, so a piece
 * of 500 notes gives `[0, 384)` and `[192, 500)` and nothing after.
 *
 * **Coverage is asymmetric, and downstream code should not assume otherwise.**
 * Every score note lands in at least one window — windows start at multiples of
 * the stride and span twice it, so consecutive windows always overlap and their
 * union is `[0, n)`. The *performance* has no such guarantee: a window's perf
 * range is the span of its anchors widened by `marginSec`, so performed notes
 * more than that margin before the first anchor or after the last are covered by
 * no window at all. Verified against the reference Python, not assumed: a
 * performance with 60 unmatched notes before the first match leaves all 60
 * uncovered, and 60 after the last leaves 34. Those notes reach the decode with
 * `UNCOVERED_SIM` / `UNCOVERED_NULL`, which is what those sentinels are for.
 */
export function coarseWindows(row: MlignRow, options: WindowOptions = {}): Window[] {
    const n = row.score.length;
    const m = row.perf.length;
    // Rejected rather than repaired, because both values the check rejects are
    // ones the Python refuses too — `range(0, n, 192.0)` raises TypeError and
    // `range(0, n, 0)` raises ValueError. Turning a module constant into a
    // caller option is what made them reachable at all, so the option validates
    // what the constant never had to.
    //
    // Neither degenerate value has a sensible repair. A fractional size puts
    // fractional indices into the emitted tuples, which everything downstream
    // then slices arrays with. A size below 2 gives stride 0 and a loop that
    // never advances; flooring the stride to 1 instead would "work" but emit one
    // window per note — 400 model forward passes for a 400-note score, a hang by
    // another name. Failing at the call is the only honest option.
    const winScore = options.winScore ?? WIN_SCORE;
    if (!Number.isInteger(winScore) || winScore < 2) {
        throw new RangeError(
            `MLign: winScore must be an integer >= 2, got ${winScore}` +
                " (the stride is winScore >> 1 and must not be zero)"
        );
    }
    // `stride = WIN_SCORE // 2` in the Python — computed from the window size
    // rather than configured beside it. `types.ts`'s `WIN_STRIDE` is this value
    // for the default window size; a test pins the two together.
    //
    // `>> 1` rather than `/ 2` matches Python's flooring `//` exactly, including
    // for negatives (an arithmetic shift right by one *is* floor-division by
    // two). The two part company only above 2^31, where `>>` wraps through
    // ToInt32, and for negative non-integers — both excluded by the check above.
    const stride = winScore >> 1;
    const marginSec = options.marginSec ?? MARGIN_SEC;

    const sOnset = new Float64Array(n);
    const sPitch = new Int32Array(n);
    for (let i = 0; i < n; i++) {
        sOnset[i] = row.score[i][0] / PPQ;
        sPitch[i] = row.score[i][2];
    }
    const pOnset = new Float64Array(m);
    const pPitch = new Int32Array(m);
    for (let j = 0; j < m; j++) {
        pOnset[j] = row.perf[j][0] / PERF_MS_PER_SEC;
        pPitch[j] = row.perf[j][2];
    }

    const pairs = baselinePairs(sOnset, sPitch, pOnset, pPitch);
    if (pairs.length === 0) return [[0, n, 0, m]];

    // With no anchors the perf range falls back to the WHOLE performance, not to
    // whatever the neighbouring window used.
    const wholeLo = pOnset[0];
    const wholeHi = pOnset[m - 1];

    const out: Window[] = [];
    for (let s0 = 0; s0 < n; s0 += stride) {
        const s1 = Math.min(n, s0 + winScore);

        let count = 0;
        let lo = Infinity;
        let hi = -Infinity;
        for (let k = 0; k < pairs.length; k += 2) {
            const si = pairs[k];
            if (si < s0 || si >= s1) continue;
            count++;
            const t = pOnset[pairs[k + 1]];
            if (t < lo) lo = t;
            if (t > hi) hi = t;
        }

        let tLo: number;
        let tHi: number;
        if (count < 2) {
            tLo = wholeLo;
            tHi = wholeHi;
        } else {
            tLo = lo - marginSec;
            tHi = hi + marginSec;
        }

        // `np.searchsorted(a, v, "left")` against `"right"`: they differ exactly
        // when `v` is present in `a`, and both sides of the range want the
        // inclusive answer — the first note at or after `tLo`, and one past the
        // last note at or before `tHi`.
        let p0 = searchSortedLeft(pOnset, tLo);
        let p1 = searchSortedRight(pOnset, tHi);
        p0 = Math.max(0, p0);
        p1 = Math.min(m, Math.max(p1, p0 + 1));

        out.push([s0, s1, p0, p1]);
        if (s1 >= n) break;
    }
    return out;
}

/**
 * The baseline aligner's matched pairs, flattened as `[s0, p0, s1, p1, …]` in
 * increasing score order.
 *
 * Onset clusters on both sides (score: notes sharing an onset; performance:
 * notes within `PERF_CLUSTER_EPS` of the one before), a DTW over the cluster
 * sequences with Jaccard-distance costs, then equal pitches paired inside each
 * matched cluster pair. `MLign/src/mlign/baseline.py:align_baseline` also emits
 * the leftovers as insertions and deletions; the windowing only ever reads the
 * matches, so only those are built here.
 *
 * The result comes out sorted by score index without sorting: the DTW path is
 * strictly increasing in both cluster indices, cluster index ranges are
 * contiguous and increasing, and each cluster is visited once.
 */
export function baselinePairs(
    sOnset: ArrayLike<number>,
    sPitch: ArrayLike<number>,
    pOnset: ArrayLike<number>,
    pPitch: ArrayLike<number>
): Int32Array {
    const n = sOnset.length;
    const m = pOnset.length;

    // The score threshold is an exact-onset test wearing a tolerance's clothes:
    // 1e-9 quarters is far below anything a score encodes, so a cluster is the
    // set of notes written at the same moment. The perf one at 0.05 s is a real
    // tolerance, grouping what a player struck as a chord.
    const sStarts = clusterStarts(sOnset, SCORE_CLUSTER_EPS);
    const pStarts = clusterStarts(pOnset, PERF_CLUSTER_EPS);
    const ns = sStarts.length;
    const mp = pStarts.length;

    const overlap = jaccardMatrix(
        clusterPitchSets(sPitch, sStarts, n),
        clusterPitchSets(pPitch, pStarts, m)
    );
    const cost = new Float32Array(ns * mp);
    for (let k = 0; k < cost.length; k++) cost[k] = 1.0 - overlap[k];

    const path = dtwPath(cost, ns, mp, DTW_GAP_BASELINE);

    // `matched_s` / `matched_p` are shared across cluster pairs in the Python and
    // are kept shared here. They cannot actually fire — the path visits each
    // cluster once and clusters are disjoint — but the order of iteration is
    // load-bearing either way, so the shape is left as it is rather than argued
    // away.
    const matchedS = new Uint8Array(n);
    const matchedP = new Uint8Array(m);
    const out: number[] = [];

    for (let k = 0; k < path.length; k += 2) {
        const ci = path[k];
        const cj = path[k + 1];
        const sLo = sStarts[ci];
        const sHi = ci + 1 < ns ? sStarts[ci + 1] : n;
        const pLo = pStarts[cj];
        const pHi = cj + 1 < mp ? pStarts[cj + 1] : m;

        // Per-pitch queues in increasing perf index; the score note takes the
        // front one (`cand.pop(0)`), so a repeated pitch inside a chord is paired
        // in the order both tables list it.
        const byPitch = new Map<number, number[]>();
        for (let j = pLo; j < pHi; j++) {
            if (matchedP[j]) continue;
            const queue = byPitch.get(pPitch[j]);
            if (queue) queue.push(j);
            else byPitch.set(pPitch[j], [j]);
        }

        for (let i = sLo; i < sHi; i++) {
            if (matchedS[i]) continue;
            const cand = byPitch.get(sPitch[i]);
            if (!cand || cand.length === 0) continue;
            const pk = cand.shift() as number;
            out.push(i, pk);
            matchedS[i] = 1;
            matchedP[pk] = 1;
        }
    }

    return Int32Array.from(out);
}

/** First index whose value is `>= v`; `np.searchsorted(a, v, "left")`. */
function searchSortedLeft(a: ArrayLike<number>, v: number): number {
    let lo = 0;
    let hi = a.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (a[mid] < v) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/** First index whose value is `> v`; `np.searchsorted(a, v, "right")`. */
function searchSortedRight(a: ArrayLike<number>, v: number): number {
    let lo = 0;
    let hi = a.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (a[mid] <= v) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}
