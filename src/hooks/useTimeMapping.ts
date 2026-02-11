import { useMemo, useCallback } from 'react';
import { MSM } from 'mpmify';

type TimeMapping = {
    tickToSeconds: ((tick: number) => number) | null;
    secondsToTick: ((seconds: number) => number) | null;
};

export const useTimeMapping = (msm: MSM | null | undefined): TimeMapping => {
    const lookupTable = useMemo(() => {
        if (!msm || msm.allNotes.length === 0) return null;

        const seen = new Set<number>();
        const pairs: [number, number][] = [];

        for (const note of msm.allNotes) {
            if (note['midi.onset'] === undefined) continue;
            if (seen.has(note.date)) continue;
            seen.add(note.date);
            pairs.push([note.date, note['midi.onset']]);
        }

        if (pairs.length === 0) return null;

        pairs.sort((a, b) => a[0] - b[0]);
        return pairs;
    }, [msm]);

    const tickToSeconds = useCallback((tick: number): number => {
        if (!lookupTable || lookupTable.length === 0) return 0;
        if (lookupTable.length === 1) return lookupTable[0][1];

        // Before first point: extrapolate
        if (tick <= lookupTable[0][0]) {
            const [t0, s0] = lookupTable[0];
            const [t1, s1] = lookupTable[1];
            const rate = (s1 - s0) / (t1 - t0);
            return s0 + rate * (tick - t0);
        }

        // After last point: extrapolate
        if (tick >= lookupTable[lookupTable.length - 1][0]) {
            const [t0, s0] = lookupTable[lookupTable.length - 2];
            const [t1, s1] = lookupTable[lookupTable.length - 1];
            const rate = (s1 - s0) / (t1 - t0);
            return s1 + rate * (tick - t1);
        }

        // Binary search for surrounding pair
        let lo = 0;
        let hi = lookupTable.length - 1;
        while (lo < hi - 1) {
            const mid = (lo + hi) >> 1;
            if (lookupTable[mid][0] <= tick) {
                lo = mid;
            } else {
                hi = mid;
            }
        }

        const [t0, s0] = lookupTable[lo];
        const [t1, s1] = lookupTable[hi];
        if (t1 === t0) return s0;
        const t = (tick - t0) / (t1 - t0);
        return s0 + t * (s1 - s0);
    }, [lookupTable]);

    const secondsToTick = useCallback((seconds: number): number => {
        if (!lookupTable || lookupTable.length === 0) return 0;
        if (lookupTable.length === 1) return lookupTable[0][0];

        // Before first point: extrapolate
        if (seconds <= lookupTable[0][1]) {
            const [t0, s0] = lookupTable[0];
            const [t1, s1] = lookupTable[1];
            const rate = (t1 - t0) / (s1 - s0);
            return t0 + rate * (seconds - s0);
        }

        // After last point: extrapolate
        if (seconds >= lookupTable[lookupTable.length - 1][1]) {
            const [t0, s0] = lookupTable[lookupTable.length - 2];
            const [t1, s1] = lookupTable[lookupTable.length - 1];
            const rate = (t1 - t0) / (s1 - s0);
            return t1 + rate * (seconds - s1);
        }

        // Binary search on the seconds column
        let lo = 0;
        let hi = lookupTable.length - 1;
        while (lo < hi - 1) {
            const mid = (lo + hi) >> 1;
            if (lookupTable[mid][1] <= seconds) {
                lo = mid;
            } else {
                hi = mid;
            }
        }

        const [t0, s0] = lookupTable[lo];
        const [t1, s1] = lookupTable[hi];
        if (s1 === s0) return t0;
        const t = (seconds - s0) / (s1 - s0);
        return t0 + t * (t1 - t0);
    }, [lookupTable]);

    if (!lookupTable) {
        return { tickToSeconds: null, secondsToTick: null };
    }

    return { tickToSeconds, secondsToTick };
};
