import type { Roll, Sounded } from '../../fitting/description/client';
import type { AlignmentData } from '../../fitting/fit.worker';
import { PULSES_PER_WHOLE } from '../../fitting/ppq';
import { bars } from '../../fitting/timeSignature';
import type { DescribeRollProps } from './roll/DescribeRoll';
import type { StaffName } from './roll/staff';
import type { RollGrace, RollNote, RollPedals } from './roll/types';

/**
 * A run, as the roll is handed it.
 *
 * The run knows every note as it sounded and as the MPM renders it; how a note is written, its
 * spelling and its staff, is the score's to say, and is read off the alignment.
 */

/** How each note of the score is written. */
type Spelling = ReadonlyMap<string, { staff: StaffName; letter: string; alter: number }>;

/** The upper staff is the treble; every other one is drawn on the bass. */
const staffOf = (written: string | number): StaffName => (String(written) === '1' ? 'treble' : 'bass');

export const spellingOf = ({ allNotes }: Pick<AlignmentData, 'allNotes'>): Spelling =>
    new Map(
        allNotes.map((note) => [
            note['xml:id'],
            { staff: staffOf(note.staff ?? note.part), letter: note.pitchname, alter: note.accidentals },
        ]),
    );

/**
 * The notes of a run for the roll.
 *
 * @param moved where a remark brought out has each note, in place of where the MPM has it.
 */
export const notesOf = (roll: Pick<Roll, 'notes'>, spelling: Spelling, moved: ReadonlyMap<string, Sounded> | null): RollNote[] =>
    roll.notes.map((note) => {
        const written = spelling.get(note.id);
        return {
            id: note.id,
            part: note.part,
            staff: written?.staff ?? staffOf(note.part),
            pitch: note.pitch,
            letter: written?.letter ?? 'c',
            alter: written?.alter ?? 0,
            date: note.date,
            duration: note.duration,
            played: { ms: note.ms, msEnd: note.msEnd, velocity: note.velocity },
            rendered: moved?.get(note.id) ?? note.mpm,
            ...(note.arrived && { arrived: note.arrived }),
        };
    });

/** The bars of the score, numbered as the score numbers them. */
export const barsOf = ({ timeSignatures, end }: Pick<Roll, 'timeSignatures' | 'end'>): DescribeRollProps['bars'] =>
    bars(timeSignatures, end, PULSES_PER_WHOLE).map(({ date, ticks, number }) => ({
        n: number,
        from: date,
        to: Math.min(date + ticks, end),
    }));

/** Everything of a run the roll draws that does not move while a remark is brought out. */
export const groundOf = (
    roll: Roll,
    { graces }: Pick<AlignmentData, 'graces'>,
): Pick<DescribeRollProps, 'graces' | 'pedals' | 'beats' | 'bars' | 'assumed'> => {
    const partOf = new Map(graces.map((grace) => [grace['xml:id'], grace.part]));
    return {
        graces: roll.graces.map(
            (grace): RollGrace => ({ id: grace.id, pitch: grace.pitch, staff: staffOf(partOf.get(grace.id) ?? 1), ms: grace.ms }),
        ),
        pedals: { played: roll.pedals.played, rendered: roll.pedals.mpm } satisfies RollPedals,
        beats: roll.beats,
        bars: barsOf(roll),
        assumed: roll.assumed.tempo,
    };
};
