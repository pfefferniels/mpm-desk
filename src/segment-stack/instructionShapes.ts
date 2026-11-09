/**
 * What a `<rubato>`, an `<ornament>` and an `<articulation>` do to the notes they act on, in
 * the numbers their charts are drawn from.
 *
 * As with tempo and dynamics, the numbers are the renderer's: `rubatoAt` is the warp
 * `renderExpressiveMidi` applies, and the ornament and articulation are run through
 * espressivo's own transformers on stand-in notes — a note made up only of the attributes those
 * transformers read — so a chart cannot show a roll or a shortening the performance does not
 * have.
 */
import { Attribute, Element, articulateNote } from 'espressivo';
import { rubatoAt, tempoAt, type Articulation, type Instruction, type Ornament, type PerformanceReader, type Rubato } from '../utils/mpm';
import { sequenceOf } from '../fitting/transformers/ornamentation/noteOrder';

/** A note of the score as these charts need it. */
export interface ChartNote {
    id: string;
    date: number;
    duration: number;
    pitch: number;
}

/** One onset under a rubato: where its frame has it written, and where the rubato plays it. */
interface CombTooth {
    /** Both as fractions of the frame, 0 at its start. */
    written: number;
    played: number;
}

/** Without notes to place, a frame is shown by its quarters. */
const FALLBACK_DIVISIONS = 4;

/**
 * The onsets of one frame, as written and as played.
 *
 * One frame, also for a rubato that loops: every frame of it warps alike. A frame that strikes
 * no note — or a chart given no notes — is shown by its quarters instead, which is what the
 * warp would do to notes there.
 */
export const rubatoComb = (rubato: Rubato, onsets: readonly number[]): CombTooth[] => {
    const { startDate, frameLength } = rubato;
    if (!(frameLength > 0)) return [];
    const inFrame = [...new Set(onsets)].filter((d) => d >= startDate && d < startDate + frameLength).sort((a, b) => a - b);
    const dates = inFrame.length > 0
        ? inFrame
        : Array.from({ length: FALLBACK_DIVISIONS }, (_, k) => startDate + (k * frameLength) / FALLBACK_DIVISIONS);
    return dates.map((date) => ({
        written: (date - startDate) / frameLength,
        played: (rubatoAt(rubato, date) - startDate) / frameLength,
    }));
};

/** A rubato in words: which part of the frame it lingers on, and how its window sits. */
export const rubatoCharacter = (rubato: Rubato): string => {
    const words = [rubato.intensity < 1 ? 'long–short' : rubato.intensity > 1 ? 'short–long' : 'even'];
    if (rubato.lateStart > 0) words.push(`starts ${percent(rubato.lateStart)} late`);
    if (rubato.earlyEnd < 1) words.push(`ends ${percent(1 - rubato.earlyEnd)} early`);
    if (rubato.loop) words.push('every frame to the next rubato');
    return words.join(' · ');
};

/** One note of a rolled chord. */
export interface RolledNote {
    id: string;
    pitch: number;
    /** Where it sounds against the ornament's date, in the spread's own unit. */
    offset: number;
    /** What the dynamics gradient adds to its velocity. */
    velocity: number;
}

export interface Roll {
    notes: RolledNote[];
    /** The unit of `offset`: MPM reads a spread without `@time.unit` in ticks. */
    unit: 'ticks' | 'ms';
}

/**
 * The chord an `<ornament>` rolls, note by note, in the order it rolls it.
 *
 * Each note is its own step, as the renderer makes it, and the def's gradient and spread are
 * applied in the renderer's order (`applyOrnament`): velocity first, then time.
 *
 * An MPM v3 ornament's own notes — a grace note's pool, say — are steps too, where its
 * `@note.order` names them: their pitch is given outright, or as an interval from the principal.
 * A diatonic interval needs the key and is left out.
 *
 * @param chord the notes at the ornament's date
 */
export const rollOf = (ornament: Ornament, chord: readonly ChartNote[]): Roll | null => {
    const def = ornament.ornamentDef;
    if (!def || chord.length === 0) return null;
    const spread = def.getTemporalSpread();
    const gradient = def.getDynamicsGradient();
    const principal = chord.find((n) => n.id === ornament.noteid?.replace(/^#/, ''));
    const pool = ornament.notes.flatMap((note) => {
        const { kind, value } = note.pitchSpec;
        if (kind === 'midi') return [{ 'xml:id': note.id, 'midi.pitch': value }];
        if (kind === 'chromatic' && principal) return [{ 'xml:id': note.id, 'midi.pitch': principal.pitch + value }];
        return [];
    });
    const ordered = sequenceOf(ornament.noteOrder ?? undefined, [
        ...chord.map((n) => ({ 'xml:id': n.id, 'midi.pitch': n.pitch })),
        ...pool,
    ]);
    const stand = ordered.map((note) => {
        const element = new Element('note');
        element.addAttribute(new Attribute('midi.pitch', String(note['midi.pitch'])));
        return [element];
    });
    gradient?.apply(stand, ornament.scale);
    spread?.apply(stand);
    const ms = stand.some(([e]) => e.getAttributeValue('ornament.milliseconds.date.offset') !== null);
    const read = (element: Element, name: string) => Number(element.getAttributeValue(name) ?? 0);
    return {
        unit: ms ? 'ms' : 'ticks',
        notes: ordered.map((note, i) => ({
            id: note['xml:id'],
            pitch: note['midi.pitch'],
            offset: read(stand[i][0], ms ? 'ornament.milliseconds.date.offset' : 'ornament.date.offset'),
            velocity: read(stand[i][0], 'ornament.dynamics'),
        })),
    };
};

/** How long a tick lasts at `date`, in milliseconds, by the tempo in force there. */
export const msPerTickAt = (mpm: PerformanceReader, date: number): number | null => {
    const instruction = mpm.effectiveAt(date, 'tempo').at(-1);
    const tempo = instruction ? mpm.tempoOf(instruction) : null;
    if (!tempo) return null;
    const bpm = tempoAt(tempo, date);
    if (!(bpm > 0) || !(tempo.beatLength > 0)) return null;
    return 60000 / (bpm * tempo.beatLength * 4 * mpm.meter.ppq);
};

/** The notes an `<articulation>` acts on: the one it names, or every note at its date. */
export const articulatedNotes = (articulation: Articulation, notes: readonly ChartNote[]): ChartNote[] =>
    articulation.noteid !== null
        ? notes.filter((n) => n.id === articulation.noteid)
        : notes.filter((n) => n.date === articulation.date);

/** What an articulation makes of one note. */
export interface Articulated {
    /** Ticks the onset moves by. */
    delay: number;
    /** The duration played, in ticks. */
    duration: number;
    /** The velocity played, against the one it would have had. */
    velocity: number;
    /** A duration set in milliseconds instead, which the tick chart cannot place. */
    durationMs: number | null;
}

/** The velocity a stand-in note is given, so that a factor and a change both show. */
const STAND_IN_VELOCITY = 100;

export const articulate = (articulation: Articulation, note: Pick<ChartNote, 'date' | 'duration'>): Articulated => {
    const element = new Element('note');
    element.addAttribute(new Attribute('date.perf', String(note.date)));
    element.addAttribute(new Attribute('duration.perf', String(note.duration)));
    element.addAttribute(new Attribute('velocity', String(STAND_IN_VELOCITY)));
    articulateNote(articulation, element);
    const read = (name: string) => {
        const value = element.getAttributeValue(name);
        return value === null ? null : Number(value);
    };
    return {
        delay: (read('date.perf') ?? note.date) - note.date,
        duration: read('duration.perf') ?? note.duration,
        velocity: (read('velocity') ?? STAND_IN_VELOCITY) / STAND_IN_VELOCITY,
        durationMs: read('articulation.absoluteDurationMs'),
    };
};

/** An articulation in words. */
export const articulationCharacter = (played: Articulated, written: number): string => {
    const words: string[] = [];
    if (played.durationMs !== null) words.push(`held ${Math.round(played.durationMs)} ms`);
    else if (written > 0) {
        const ratio = played.duration / written;
        if (Math.round(ratio * 100) === 100) words.push('held its full length');
        else if (ratio > 1) words.push(`held over, ${percent(ratio)}`);
        else words.push(`shortened to ${percent(ratio)}`);
    }
    if (Math.abs(played.velocity - 1) >= 0.005) {
        words.push(`${percent(Math.abs(played.velocity - 1))} ${played.velocity > 1 ? 'louder' : 'softer'}`);
    }
    if (played.delay !== 0) words.push(`${played.delay > 0 ? 'delayed' : 'early'} by ${Math.round(Math.abs(played.delay))} ticks`);
    return words.join(' · ');
};

/** The notes struck where an instruction acts, for the charts that place it among them. */
export const notesAt = (instruction: Pick<Instruction, 'date'>, notes: readonly ChartNote[]): ChartNote[] =>
    notes.filter((n) => n.date === instruction.date);

const percent = (fraction: number) => `${Math.round(fraction * 100)} %`;
