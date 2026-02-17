import { useMemo, useCallback } from 'react';
import { MSM } from 'mpmify';
import { buildLookupTable, tickToSeconds as tickToSecondsImpl, secondsToTick as secondsToTickImpl } from '../utils/timeMapping';

type TimeMapping = {
    tickToSeconds: ((tick: number) => number) | null;
    secondsToTick: ((seconds: number) => number) | null;
};

export const useTimeMapping = (msm: MSM | null | undefined, extraPairs?: [number, number][]): TimeMapping => {
    const lookupTable = useMemo(() => {
        if (!msm || msm.allNotes.length === 0) return null;

        const pairs: [number, number][] = [];
        for (const note of msm.allNotes) {
            if (note['midi.onset'] === undefined) continue;
            pairs.push([note.date, note['midi.onset']]);
        }

        return buildLookupTable(pairs, extraPairs);
    }, [msm, extraPairs]);

    const tickToSeconds = useCallback(
        (tick: number) => tickToSecondsImpl(lookupTable!, tick),
        [lookupTable]
    );

    const secondsToTick = useCallback(
        (seconds: number) => secondsToTickImpl(lookupTable!, seconds),
        [lookupTable]
    );

    if (!lookupTable) {
        return { tickToSeconds: null, secondsToTick: null };
    }

    return { tickToSeconds, secondsToTick };
};
