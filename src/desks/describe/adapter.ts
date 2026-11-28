import { isCallOf } from '../../fitting/calls';
import type { Roll, Sounded } from '../../fitting/description/client';
import { expansion } from '../../fitting/expansion';
import type { AlignmentData } from '../../fitting/fit.worker';
import { PULSES_PER_WHOLE } from '../../fitting/ppq';
import { bars } from '../../fitting/timeSignature';
import type { Call } from '../../model/Work';
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

/** The velocity a note of a part stands at on the document's scale, given the one it arrived at. */
type Scale = (part: number, velocity: number) => number;

/**
 * The scale the document reads the roll's loudness on.
 *
 * A `Modify` of the velocity that states `points` and names no place is said of the medium, not
 * of a place in the music: the roll squeezed its whole range against a floor, and the call opens
 * it again, every note of its scope along one line. The published reconstruction holds one,
 * `[[35, 20], [54, 46]]`, and by it every one of its 450 notes arrived louder than it stands.
 *
 * What is done to all alike singles no note out. So a note is asked where it arrived *on that
 * scale*, and the roll outlines it only where a correction made at its place took it elsewhere
 * (`notesOf`). An expansion that names a place is such a correction, and is left out here.
 *
 * Read off the calls, by the arithmetic `Modify` runs itself (`fitting/expansion`). Every
 * expansion runs before every shift, whatever order they were made in, so what arrived, taken
 * along these lines, is the note as it stood before anything was corrected at a place.
 *
 * @param calls the calls a run was made of: those made by hand, and what its remarks came to.
 */
export const scaleOf = (calls: readonly Call[]): Scale => {
    const lines = calls.filter(isCallOf('Modify')).flatMap(({ options }) => {
        const names = options.noteIDs !== undefined || options.pedalIDs !== undefined || options.from !== undefined || options.to !== undefined;
        if (options.aspect !== 'velocity' || options.points === undefined || names) return [];
        const map = expansion(options.points);
        return map ? [{ scope: options.scope, map }] : [];
    });
    // A part's scope is counted from nought and a note's part from one, as `Alignment.in` reads them.
    return (part, velocity) =>
        lines.reduce((value, { scope, map }) => (scope === 'global' || scope === part - 1 ? Math.max(0, map(value)) : value), velocity);
};

/** Far enough apart to be two values, and not one that went through an addition and came back. */
const differs = (a: number, b: number) => Math.abs(a - b) > 1e-6;

/**
 * The notes of a run for the roll.
 *
 * A note is handed over as it arrived only where it arrived elsewhere than it now stands, in
 * onset, end or loudness, once it is read on the document's scale.
 *
 * @param scale the scale the document reads the roll's loudness on; see {@link scaleOf}.
 * @param moved where a remark brought out has each note, in place of where the MPM has it.
 */
export const notesOf = (
    roll: Pick<Roll, 'notes'>,
    spelling: Spelling,
    scale: Scale,
    moved: ReadonlyMap<string, Sounded> | null,
): RollNote[] =>
    roll.notes.map((note) => {
        const written = spelling.get(note.id);
        const arrived = note.arrived && { ...note.arrived, velocity: scale(note.part, note.arrived.velocity) };
        const elsewhere =
            arrived !== undefined &&
            (differs(arrived.ms, note.ms) || differs(arrived.msEnd, note.msEnd) || differs(arrived.velocity, note.velocity));
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
            ...(elsewhere && { arrived }),
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
