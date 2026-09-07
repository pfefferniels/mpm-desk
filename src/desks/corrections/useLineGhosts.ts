import { useMemo } from 'react';
import { filterMap } from 'espressivo';
import { rowId, travelOf, type AlignedPedal, type Alignment } from '../../fitting/alignment';
import type { CorrectPedalOptions } from '../../fitting/transformers/modification/CorrectPedal';
import type { Travel } from '../../performance/pedalTravel';
import { useCallSelection } from '../../hooks/CallSelection';
import { useScoreDocument } from '../../hooks/ScoreDocument';

/** The line a press had before the chain redrew it, at the time the chain has put it. */
export interface LineGhost {
    type: AlignedPedal['type'];
    dateMs: number;
    travel: Travel;
}

/**
 * How far the chain has moved the recording's zero.
 *
 * `InsertTempo` shifts every event to the first onset, so a pristine time has to move by the same
 * amount to be drawn against the fitted recording. Measured on one note present in both, less
 * what the corrections moved that note by, which the pristine copy knows nothing of.
 */
const chainShiftMs = (
    pristine: Alignment,
    fitted: Alignment,
    onsetGhosts: ReadonlyMap<string, number>,
): number => {
    const original = new Map(pristine.allNotes.map((note) => [rowId(note), note['milliseconds.date']]));
    const witness = fitted.allNotes.find(
        (note) => Number.isFinite(note['milliseconds.date']) && original.has(rowId(note)),
    );
    if (!witness) return 0;
    const before = original.get(rowId(witness)) ?? 0;
    return before + (onsetGhosts.get(witness['xml:id']) ?? 0) - witness['milliseconds.date'];
};

/**
 * The line each press had before the chain redrew it, keyed by pedal id.
 *
 * Read off the pristine alignment, since the fitted one shows the corrected line and has no
 * memory of what it was; the calls say which presses to look up. Cumulative, as the other ghosts
 * are: a press redrawn twice shows the recording's own line, not the first redraw's. A press a
 * call added had no line before it, and gets no ghost.
 */
export const useLineGhosts = (
    msm: Alignment,
    onsetGhosts: ReadonlyMap<string, number>,
): ReadonlyMap<string, LineGhost> => {
    const { calls } = useCallSelection();
    const { pristine, recording } = useScoreDocument();

    return useMemo(() => {
        if (!pristine) return new Map<string, LineGhost>();
        const shift = chainShiftMs(pristine, msm, onsetGhosts);
        const corrected = new Set(
            calls
                .filter((call) => call.name === 'CorrectPedal')
                .map((call) => (call.options as unknown as CorrectPedalOptions).pedal),
        );
        const rowOf = (id: string): AlignedPedal | undefined => {
            const rows = pristine.pedals.filter((pedal) => pedal['xml:id'] === id);
            return rows.find((pedal) => pedal.source === recording) ?? rows[0];
        };

        return new Map(
            filterMap([...corrected], (id): readonly [string, LineGhost] | null => {
                const row = rowOf(id);
                if (!row) return null;
                return [
                    id,
                    {
                        type: row.type,
                        dateMs: Math.max(0, row['milliseconds.date'] - shift),
                        travel: travelOf(row),
                    },
                ];
            }),
        );
    }, [calls, msm, onsetGhosts, pristine, recording]);
};
