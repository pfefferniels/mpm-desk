/**
 * Onset-cluster DTW primitives, shared by the decode and by the coarse
 * windowing that feeds the model.
 *
 * Both callers group each table into onset clusters, score every pair, then walk
 * a monotone path through that cost matrix, differing only in how a cell is
 * scored and in the gap penalty. So the caller builds the cost matrix and the
 * path is found here.
 *
 * Every routine below reproduces NumPy semantics rather than idiomatic JS. The
 * accumulated DTW table is float32 in Python and the backtrack decides steps by
 * exact float equality against it, so the arithmetic has to be float32 in the
 * same places or a tie breaks the other way and the path forks.
 */

/**
 * Start index of each onset cluster: a new cluster begins wherever the onset
 * gap exceeds `eps`. Cluster `k` covers `[starts[k], starts[k + 1])`, the last
 * one running to the end of the table.
 *
 * Mirrors `np.split(np.arange(len), np.flatnonzero(np.diff(onsets) > eps) + 1)`,
 * including its one oddity: an empty table yields a single empty cluster rather
 * than no clusters at all.
 */
export function clusterStarts(onsets: ArrayLike<number>, eps: number): Int32Array {
    const starts: number[] = [0];
    for (let i = 1; i < onsets.length; i++) {
        if (onsets[i] - onsets[i - 1] > eps) starts.push(i);
    }
    return Int32Array.from(starts);
}

/** The pitch set of every cluster, in cluster order. */
export function clusterPitchSets(
    pitch: ArrayLike<number>,
    starts: Int32Array,
    total: number
): Set<number>[] {
    const sets: Set<number>[] = [];
    for (let k = 0; k < starts.length; k++) {
        const lo = starts[k];
        const hi = k + 1 < starts.length ? starts[k + 1] : total;
        const s = new Set<number>();
        for (let i = lo; i < hi; i++) s.add(pitch[i]);
        sets.push(s);
    }
    return sets;
}

/**
 * Jaccard overlap of every score cluster against every perf cluster, row-major
 * `(sSets.length, pSets.length)`.
 *
 * Kept as raw float64 overlap rather than a cost, because the two callers turn
 * it into a cost differently and each rounds to float32 only at the end. Two
 * empty sets score 0, matching the Python's `if union else 0.0`.
 */
export function jaccardMatrix(sSets: Set<number>[], pSets: Set<number>[]): Float64Array {
    const ns = sSets.length;
    const mp = pSets.length;
    const out = new Float64Array(ns * mp);
    for (let i = 0; i < ns; i++) {
        const ss = sSets[i];
        for (let j = 0; j < mp; j++) {
            const ps = pSets[j];
            // Iterate the smaller set; membership is O(1) either way.
            const [small, large] = ss.size <= ps.size ? [ss, ps] : [ps, ss];
            let inter = 0;
            for (const p of small) if (large.has(p)) inter++;
            const union = ss.size + ps.size - inter;
            out[i * mp + j] = union ? inter / union : 0.0;
        }
    }
    return out;
}

/**
 * A monotone path through `cost` (row-major `(ns, mp)`), with diagonal, vertical
 * and horizontal steps and a flat `gap` penalty for the two skips.
 *
 * Returns the diagonal steps only, the matched cluster pairs, flattened as
 * `[i0, j0, i1, j1, ...]` in increasing order.
 *
 * Two NumPy details are load-bearing:
 *
 * The accumulated table is float32 and the gap is added as a float32, but the
 * first row and column are seeded by `np.cumsum` over a *float64* array and only
 * rounded on assignment. So the seed uses the float64 gap while every later step
 * uses the float32 one. At gap 0.6 those differ, and the difference survives
 * into the accumulated sums.
 *
 * The backtrack compares by exact equality (`best == d`, then `best == v`), so
 * diagonal wins a tie over vertical and vertical over horizontal. Ties do arise:
 * a gap step and a diagonal step through a zero-cost cell reach the same sum,
 * and which is taken changes the anchor map.
 */
export function dtwPath(cost: Float32Array, ns: number, mp: number, gap: number): Int32Array {
    const w = mp + 1;
    const acc = new Float32Array((ns + 1) * w).fill(Infinity);
    acc[0] = 0.0;

    // Seeds: float64 running sum, rounded to float32 only by the store.
    let run = 0.0;
    for (let j = 1; j <= mp; j++) {
        run += gap;
        acc[j] = run;
    }
    run = 0.0;
    for (let i = 1; i <= ns; i++) {
        run += gap;
        acc[i * w] = run;
    }

    // Steps: float32 gap, float32 sums.
    const g = Math.fround(gap);
    for (let i = 1; i <= ns; i++) {
        const rowOff = (i - 1) * mp;
        const prevOff = (i - 1) * w;
        const curOff = i * w;
        for (let j = 1; j <= mp; j++) {
            const d = Math.fround(acc[prevOff + j - 1] + cost[rowOff + j - 1]);
            const v = Math.fround(acc[prevOff + j] + g);
            const h = Math.fround(acc[curOff + j - 1] + g);
            acc[curOff + j] = d < v ? (d < h ? d : h) : v < h ? v : h;
        }
    }

    const rev: number[] = [];
    let i = ns;
    let j = mp;
    while (i > 0 && j > 0) {
        const d = Math.fround(acc[(i - 1) * w + (j - 1)] + cost[(i - 1) * mp + (j - 1)]);
        const v = Math.fround(acc[(i - 1) * w + j] + g);
        const h = Math.fround(acc[i * w + (j - 1)] + g);
        const best = d < v ? (d < h ? d : h) : v < h ? v : h;
        if (best === d) {
            rev.push(i - 1, j - 1);
            i -= 1;
            j -= 1;
        } else if (best === v) {
            i -= 1;
        } else {
            j -= 1;
        }
    }

    const out = new Int32Array(rev.length);
    for (let k = 0; k < rev.length; k += 2) {
        out[rev.length - 2 - k] = rev[k];
        out[rev.length - 1 - k] = rev[k + 1];
    }
    return out;
}
