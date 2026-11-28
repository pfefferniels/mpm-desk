/**
 * Which notes are played for a remark, and how loud: its own, what it takes around them to hear
 * what it says, and what is still sounding where the playing begins.
 */
import type { RemarkReport, Roll, RollNote, Sounded } from '../../../fitting/description/client';
import { PULSES_PER_WHOLE } from '../../../fitting/ppq';
import { bars } from '../../../fitting/timeSignature';
import type { DescribedPlace } from '../../../fitting/transformers/description/Describe';
import type { PlayableNote } from '../../../performance/buildMidiFile';
import { contextOf, type ScoreGrid, type Subject } from './context';
import { keyOf } from './hearing';

/** A note already sounding where the playing begins is struck with its first chord, softer. */
const HELD = 0.7;
/** The hand that a remark on single notes does not name. */
const SHADED = 0.55;
/** No context further than this from the passage, however slow the music. */
const REACH_MS = 2600;

/** The playing begins this long before the first note, */
const LEAD_IN_MS = 40;
/** gives the last chord this long to be heard where nothing of the remark's sounds longer, */
const LAST_CHORD_MS = 700;
/** and ends this long after. */
const RELEASE_MS = 300;

/** What each element of an MPM says something about. */
const SUBJECTS = new Map<string, Subject>([
    ['tempo', 'tempo'],
    ['rubato', 'rubato'],
    ['dynamics', 'dynamics'],
    ['ornament', 'roll'],
    ['articulation', 'touch'],
    ['accentuationPattern', 'accent'],
    ['movement', 'pedal'],
]);

/** What a remark wrote, as far as playing it goes. */
export interface Wrote {
    /** The ids of the MPM elements its steps wrote: what there is to bring out. */
    elements: string[];
    about: Set<Subject>;
    /** The notes its articulations were fitted to. */
    touched: string[];
}

/** An element's name: off its start tag, or off its id where it has since been removed. */
const nameOf = (written: string | undefined, id: string): string =>
    /^<([\w.:-]+)/.exec(written ?? '')?.[1] ?? /^[A-Za-z]+/.exec(id)?.[0] ?? '';

export const wroteOf = ({ steps }: RemarkReport): Wrote => {
    const about = new Set<Subject>();
    const touched: string[] = [];
    for (const step of steps) {
        const subjects = step.elements.flatMap(
            (id, i) => SUBJECTS.get(nameOf(step.written[i], id)) ?? [],
        );
        for (const subject of subjects) about.add(subject);
        if (subjects.includes('touch')) touched.push(...step.evidence);
    }
    return { elements: steps.flatMap((step) => step.elements), about, touched };
};

/** The score of a run as the context rules read it. */
export const gridOf = (roll: Roll): ScoreGrid => ({
    dates: [...new Set(roll.notes.map((note) => note.date))].sort((a, b) => a - b),
    beats: roll.beats.map((beat) => beat.date),
    bars: bars(roll.timeSignatures, roll.end, PULSES_PER_WHOLE).map((bar) => bar.date),
    notes: roll.notes,
});

/** The notes to play for a remark. */
export interface Chosen {
    /** Each note that is played, with how much of its loudness it is given. */
    gains: Map<string, number>;
    /** Those of them that began before the playing does. */
    held: Set<string>;
    /** Those of them the remark was made about. */
    own: Set<string>;
}

const named = (place: DescribedPlace) => place.kind === 'notes' || place.kind === 'box';

/** The notes a remark was made about: the ones it names, or every one of its passage. */
const ownOf = (place: DescribedPlace, notes: readonly RollNote[]): Set<string> =>
    new Set(
        named(place)
            ? place.notes
            : notes
                  .filter((note) => note.date >= place.from && note.date < place.to)
                  .map((note) => note.id),
    );

/**
 * The notes to play for a remark on a passage or on single notes, each with its level: its own,
 * what it takes around them to hear what is said of them (`contextOf`), and what is held over
 * into the start.
 *
 * @param onsetOf a note's onset in the rendering that will be played, in ms.
 * @returns null where the remark's place holds no note.
 */
export const playedFor = (
    roll: Roll,
    place: DescribedPlace,
    { about, touched }: Pick<Wrote, 'about' | 'touched'>,
    onsetOf: (note: RollNote) => number,
): Chosen | null => {
    const own = ownOf(place, roll.notes);
    const mine = roll.notes.filter((note) => own.has(note.id));
    if (mine.length === 0) return null;
    const grid = gridOf(roll);
    const span = contextOf(grid, place, about, touched);
    const onsets = mine.map(onsetOf);
    const dates = mine.map((note) => note.date);
    // In slow music two beats are a long time; the nearest chord either side is kept all the same.
    const nearest = new Set([
        grid.dates.findLast((date) => date < Math.min(...dates)),
        grid.dates.find((date) => date > Math.max(...dates)),
    ]);
    const near = (note: RollNote) =>
        nearest.has(note.date) ||
        (onsetOf(note) >= Math.min(...onsets) - REACH_MS &&
            onsetOf(note) <= Math.max(...onsets) + REACH_MS);
    // Of single notes the other hand is held back, so that they are heard in their line; not
    // where loudness is the point.
    const hands = new Set(mine.map((note) => note.part));
    const levelOf = (note: RollNote) =>
        named(place) && !about.has('dynamics') && !hands.has(note.part) ? SHADED : 1;

    const around = roll.notes.filter(
        (note) =>
            own.has(note.id) || (note.date >= span.from && note.date <= span.to && near(note)),
    );
    const gains = new Map(around.map((note) => [note.id, levelOf(note)]));
    const begins = Math.min(...around.map((note) => note.date));
    const held = new Set<string>();
    for (const note of roll.notes) {
        if (note.date >= begins || note.date + note.duration <= begins + 1) continue;
        held.add(note.id);
        gains.set(note.id, HELD * levelOf(note));
    }
    return { gains, held, own };
};

/**
 * The notes to play for a remark on the whole piece: every one the MPM has from `line` on, in ms
 * of the recording.
 */
export const playedFrom = (roll: Roll, line: number): Chosen | null => {
    const ids = roll.notes.filter((note) => note.mpm.ms >= line).map((note) => note.id);
    if (ids.length === 0) return null;
    return { gains: new Map(ids.map((id) => [id, 1])), held: new Set(), own: new Set(ids) };
};

/** The notes chosen that are struck where one of them begins, rather than held into it. */
export const freshOf = (notes: readonly RollNote[], { gains, held }: Chosen): RollNote[] =>
    notes.filter((note) => gains.has(note.id) && !held.has(note.id));

/**
 * The notes chosen as the piano strikes them in one rendering, each at its level. A held note
 * begins with the first of the others, if it still sounds by then.
 */
export const soundsOf = (
    notes: readonly RollNote[],
    soundOf: (note: RollNote) => Sounded,
    chosen: Chosen,
): PlayableNote[] => {
    const key = (note: RollNote, sound: Sounded) =>
        keyOf(note.id, note.pitch, sound, chosen.gains.get(note.id));
    const fresh = freshOf(notes, chosen).map((note) => key(note, soundOf(note)));
    const start = Math.min(...fresh.map((sound) => sound.onsetMs));
    const under = notes
        .filter((note) => chosen.held.has(note.id) && soundOf(note).msEnd > start + 50)
        .map((note) => key(note, { ...soundOf(note), ms: start }));
    return [...fresh, ...under];
};

/**
 * When to begin and end playing some sounds: a moment before the first, and the last chord given
 * time to be heard.
 *
 * @param own those of the sounds the remark was made about.
 */
export const timesOf = (
    sounds: readonly Sounded[],
    own: readonly Sounded[],
): { from: number; until: number } => {
    const onsets = sounds.map((sound) => sound.ms);
    return {
        from: Math.min(...onsets) - LEAD_IN_MS,
        until:
            Math.max(...own.map((sound) => sound.msEnd), Math.max(...onsets) + LAST_CHORD_MS) +
            RELEASE_MS,
    };
};
