import type { Alignment } from '../../fitting/alignment';
import type { Voice } from '../../fitting/voices';

export interface LegendPart {
    number: number;
    name: string;
    /** The voices that live here — {@link Voice.part}, so a split voice shows where most of it is. */
    voices: Voice[];
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
    const rows = new Map(
        [...new Set(msm.allNotes.map((note) => note.part))].map((number): [number, LegendPart] => [
            number,
            { number, name: names.get(number) ?? '', voices: [] },
        ]),
    );

    for (const voice of voices) rows.get(voice.part)?.voices.push(voice);

    return [...rows.values()].sort((a, b) => a.number - b.number);
};
