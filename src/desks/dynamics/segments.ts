import type { Alignment } from '../../fitting/alignment';
import type { Scope } from '../TransformerViewProps';
import type { Range } from '../tempo/Tempo';

/**
 * One dot on a velocity plot: a date, the velocity the recording sounded there, and the note it
 * came from.
 *
 * Here rather than in `DynamicsDesk` because two desks draw this plot — the dynamics desk fits
 * curves over it, the corrections desk corrects the dots themselves — and `DynamicsCircle` needs
 * the type as well. Importing it from the desk module made the shared circle depend on one of its
 * two callers.
 */
export interface DynamicsSegment {
    date: Range;
    velocity: number;
    active: boolean;
    noteID?: string;
}

/**
 * The recorded velocities of a part, one dot per distinct velocity per chord.
 *
 * Chords rather than notes, because a chord struck at one velocity is one dot; the guard on
 * `date` and `velocity` together is what keeps a six-note chord from stacking six dots on the
 * same pixel while still showing a chord whose notes differ.
 */
export const extractDynamicsSegments = (msm: Alignment, part: Scope): DynamicsSegment[] => {
    const segments: DynamicsSegment[] = [];
    msm.in(part).chords().forEach((notes, date) => {
        if (!notes.length) return;

        for (const note of notes) {
            if (segments.findIndex((s) => s.date.start === date && s.velocity === note.velocity) !== -1)
                continue;
            segments.push({
                date: {
                    start: date,
                    end: date,
                },
                velocity: note.velocity,
                active: false,
                noteID: note['xml:id'],
            });
        }
    });

    return segments;
};
