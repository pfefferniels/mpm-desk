/**
 * A sorted array of [tick, seconds] pairs used for interpolation
 * between symbolic (tick) and physical (seconds) time domains.
 */
export type LookupTable = [number, number][];

/**
 * Build a sorted lookup table from tick/onset pairs, deduplicating by tick.
 * Returns null if no valid pairs exist.
 */
export function buildLookupTable(
    pairs: [number, number][],
    extraPairs?: [number, number][]
): LookupTable | null {
    const seen = new Set<number>();
    const result: [number, number][] = [];

    for (const [tick, seconds] of pairs) {
        if (seen.has(tick)) continue;
        seen.add(tick);
        result.push([tick, seconds]);
    }

    if (extraPairs) {
        for (const [tick, seconds] of extraPairs) {
            if (seen.has(tick)) continue;
            seen.add(tick);
            result.push([tick, seconds]);
        }
    }

    if (result.length === 0) return null;

    result.sort((a, b) => a[0] - b[0]);
    return result;
}

/**
 * Interpolate from tick to seconds using a lookup table.
 * Uses binary search for the surrounding pair and linear interpolation.
 * Extrapolates beyond the table boundaries.
 */
export function tickToSeconds(table: LookupTable, tick: number): number {
    if (table.length === 0) return 0;
    if (table.length === 1) return table[0][1];

    // Before first point: extrapolate
    if (tick <= table[0][0]) {
        const [t0, s0] = table[0];
        const [t1, s1] = table[1];
        const rate = (s1 - s0) / (t1 - t0);
        return s0 + rate * (tick - t0);
    }

    // After last point: extrapolate
    if (tick >= table[table.length - 1][0]) {
        const [t0, s0] = table[table.length - 2];
        const [t1, s1] = table[table.length - 1];
        const rate = (s1 - s0) / (t1 - t0);
        return s1 + rate * (tick - t1);
    }

    // Binary search for surrounding pair
    let lo = 0;
    let hi = table.length - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (table[mid][0] <= tick) {
            lo = mid;
        } else {
            hi = mid;
        }
    }

    const [t0, s0] = table[lo];
    const [t1, s1] = table[hi];
    if (t1 === t0) return s0;
    const t = (tick - t0) / (t1 - t0);
    return s0 + t * (s1 - s0);
}

/**
 * Interpolate from seconds to tick using a lookup table.
 * Uses binary search for the surrounding pair and linear interpolation.
 * Extrapolates beyond the table boundaries.
 */
export function secondsToTick(table: LookupTable, seconds: number): number {
    if (table.length === 0) return 0;
    if (table.length === 1) return table[0][0];

    // Before first point: extrapolate
    if (seconds <= table[0][1]) {
        const [t0, s0] = table[0];
        const [t1, s1] = table[1];
        const rate = (t1 - t0) / (s1 - s0);
        return t0 + rate * (seconds - s0);
    }

    // After last point: extrapolate
    if (seconds >= table[table.length - 1][1]) {
        const [t0, s0] = table[table.length - 2];
        const [t1, s1] = table[table.length - 1];
        const rate = (t1 - t0) / (s1 - s0);
        return t1 + rate * (seconds - s1);
    }

    // Binary search on the seconds column
    let lo = 0;
    let hi = table.length - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (table[mid][1] <= seconds) {
            lo = mid;
        } else {
            hi = mid;
        }
    }

    const [t0, s0] = table[lo];
    const [t1, s1] = table[hi];
    if (s1 === s0) return t0;
    const t = (seconds - s0) / (s1 - s0);
    return t0 + t * (t1 - t0);
}
