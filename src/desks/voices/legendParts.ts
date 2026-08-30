import type { Alignment } from '../../fitting/alignment';
import type { Voice } from '../../fitting/voices';

export interface LegendPart {
    number: number;
    name: string;
    /** The voices that live here — {@link Voice.part}, so a split voice shows where most of it is. */
    voices: Voice[];
    /** Distinct notes in the part, which is not the sum of its voices once notes have been moved. */
    notes: number;
}

/**
 * The parts as the legend shows them: what the chain produced, named by the layout.
 *
 * Read off the **notes** rather than off the layout or off the voices. Off the layout, because a
 * part the layout names but nothing is in is not a part anyone can see. Off the voices, because a
 * move puts notes in a part that no voice as a whole belongs to — grouping voices then shows
 * nothing at all for it, which is a move to a new part repainting the score and leaving the panel
 * saying the part does not exist.
 */
export const legendParts = (
    msm: Alignment,
    voices: readonly Voice[],
    names: ReadonlyMap<number, string>,
): LegendPart[] => {
    const held = new Map<number, Set<string>>();
    for (const note of msm.allNotes) {
        const ids = held.get(note.part) ?? new Set<string>();
        held.set(note.part, ids);
        ids.add(note['xml:id']);
    }

    const rows = new Map(
        [...held].map(([number, ids]): [number, LegendPart] => [
            number,
            { number, name: names.get(number) ?? '', voices: [], notes: ids.size },
        ]),
    );

    for (const voice of voices) rows.get(voice.part)?.voices.push(voice);

    return [...rows.values()].sort((a, b) => a.number - b.number);
};
