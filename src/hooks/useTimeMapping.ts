import { useMemo, useCallback } from 'react';
import type { Alignment } from '../fitting/alignment';
import { onsetSeconds, wasSounded } from '../desks/noteTiming';
import { buildLookupTable, tickToSeconds as tickToSecondsImpl, secondsToTick as secondsToTickImpl } from '../utils/timeMapping';

type TimeMapping = {
    tickToSeconds: ((tick: number) => number) | null;
    secondsToTick: ((seconds: number) => number) | null;
};

/**
 * The recording's own tick ⇄ seconds table.
 *
 * Built from where the recording actually sounded each note, and deliberately NOT from the tempo
 * map: the tempo map is the thing the desks are fitting, so a ground measured with it would
 * agree with whatever curve was last drawn.
 *
 * `extraPairs` are the hand-marked silent onsets — places the score has a note the roll never
 * played, timed by the editor. They are **already in seconds** and pass through untouched; the
 * notes are in milliseconds and are converted. Mixing the two units here would tilt the whole
 * axis by a factor of a thousand at eighteen points of the piece and nowhere else, which is the
 * kind of wrongness that looks like a bad recording rather than a bad conversion.
 */
export const useTimeMapping = (msm: Alignment | null | undefined, extraPairs?: [number, number][]): TimeMapping => {
    const lookupTable = useMemo(() => {
        if (!msm || msm.allNotes.length === 0) return null;

        const pairs: [number, number][] = [];
        for (const note of msm.allNotes) {
            if (!wasSounded(note)) continue;
            pairs.push([note.date, onsetSeconds(note)]);
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
