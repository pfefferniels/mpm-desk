import type { AlignedPedal } from '../../fitting/alignment';
import { pressOf, type CorrectPedalOptions } from '../../fitting/transformers/modification/CorrectPedal';
import { returnToRest, type Travel } from '../../performance/pedalTravel';

/** A press's line as the gestures have left it, and as the recording has it. */
export interface LineDraft {
    aspect: 'line';
    /** The call this becomes on Apply. */
    change: CorrectPedalOptions;
    /** The line the recording holds now, which the ghost draws; null for a press the roll lacks. */
    before: Travel | null;
}

/** Up in three steps over 190 ms, held, and down the same way: a second in all. */
export const defaultPress = (): Travel => [
    { ms: 0, position: 0.25 },
    { ms: 60, position: 0.5 },
    { ms: 120, position: 0.75 },
    { ms: 190, position: 1 },
    { ms: 810, position: 1 },
    { ms: 870, position: 0.75 },
    { ms: 930, position: 0.5 },
    { ms: 970, position: 0.25 },
    { ms: 1000, position: 0 },
];

/** The presses as the draft has them: one redrawn, one added, or one gone. */
export const withDraft = (pedals: readonly AlignedPedal[], draft: LineDraft): AlignedPedal[] => {
    const { change } = draft;
    const others = pedals.filter((pedal) => pedal['xml:id'] !== change.pedal);
    if ('remove' in change) return others;
    if ('onsetMs' in change) return [...others, pressOf(change)];
    return pedals.map((pedal) =>
        pedal['xml:id'] === change.pedal
            ? {
                  ...pedal,
                  travel: change.travel,
                  'milliseconds.date.end': pedal['milliseconds.date'] + returnToRest(change.travel),
              }
            : pedal,
    );
};
