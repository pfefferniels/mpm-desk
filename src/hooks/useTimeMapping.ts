import { useMemo, useCallback } from 'react';
import type { Alignment } from '../fitting/alignment';
import type { Scope } from '../fitting/instructions/index';
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
 * `extraPairs` are the hand-marked silent onsets, places the score has a note the roll never
 * played. They are **already in seconds** and pass through untouched, where the notes are in
 * milliseconds and converted. Mixing the two units tilts the axis by a factor of a thousand at
 * eighteen points of the piece and nowhere else, which looks like a bad recording rather than a
 * bad conversion.
 *
 * `scope` narrows the anchors to one part, which matters wherever a date is sounded twice: the
 * table deduplicates by tick and keeps the first pair, so a chord the hands spread across two
 * parts is timed by whichever part comes first in the score. The default reads the whole score
 * and gives the recording's own timeline.
 */
export const useTimeMapping = (
    msm: Alignment | null | undefined,
    extraPairs?: [number, number][],
    scope: Scope = 'global',
): TimeMapping => {
    const lookupTable = useMemo(() => {
        if (!msm) return null;

        const pairs: [number, number][] = [];
        for (const note of msm.in(scope).notes()) {
            if (!wasSounded(note)) continue;
            pairs.push([note.date, onsetSeconds(note)]);
        }

        return buildLookupTable(pairs, extraPairs);
    }, [msm, extraPairs, scope]);

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
