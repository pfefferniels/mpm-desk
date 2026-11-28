import { BASS, TREBLE, ledgersOf, signatureOf, spell, stepOf, type Signature, type StaffName } from './staff';
import type { PedalKind, RollGrace, RollNote, RollPedals, Sounded } from './types';

/**
 * Where everything on the roll goes: pure, and in the roll's own pixels.
 *
 * Across, the roll is the recording's clock at the Desk's physical zoom, pixels per second, with
 * second zero at x = 0: that is what every other physical scroller of the Desk assumes, and what
 * `ScrollSyncProvider` multiplies by. Down, it is a ruler, then room for what is written over the
 * notes, then the notes on their rows, then the pedals.
 *
 * A **row** is one staff position on the grand staff, or one key when the roll is put back key
 * by key. Rows count upwards, as pitches do; y counts downwards.
 */

/** The ruler along the top: bar numbers, and the line under what has a described tempo. */
export const RULER = 18;
/** Where the roll proper begins under the ruler. */
export const TOP = RULER + 6;
/** Room above the top row, for the words of the remarks. */
export const HEAD = 62;
/** Pixels per staff position at most; a staff is eight positions tall. */
export const STAFF_STEP = 8.5;
/** How tall a pedal row is, and what parts it from the next. */
export const PEDAL = 9;
const PEDAL_GAP = 4;

/** Beside the roll: room for the clefs, and for each accidental of the key signature; or for the name of a C. */
export const GUTTER_STAFF = 68;
const GUTTER_KEYS = 34;
export const SIGN = 7;

export const clamp = (value: number, lo: number, hi: number): number => Math.min(Math.max(value, lo), Math.max(lo, hi));

/** A line one pixel wide falls on a pixel only half-way between two. */
export const crisp = (value: number): number => Math.round(value) + 0.5;

/** How wide the gutter is: on the staff as wide as the clefs and the key signature need. */
export const gutterOf = (staff: boolean, signature: Signature): number => (staff ? GUTTER_STAFF + SIGN * signature.size : GUTTER_KEYS);

// ---------------------------------------------------------------------------------------------
// What is written
// ---------------------------------------------------------------------------------------------

/** A note as it stands on paper: its staff, and its position there (see `stepOf`). */
export interface Written {
    staff: StaffName;
    step: number;
    pitch: number;
    letter: string;
    alter: number;
}

interface Span {
    lo: number;
    hi: number;
}

/** What the roll has to show: the keys the piece uses, and each staff with what is written on it. */
export interface Reach {
    keys: readonly [number, number];
    treble: Span;
    bass: Span;
}

export interface Notation {
    /** The key signature, read off the notes. */
    signature: Signature;
    /** Every note and grace note by id. */
    written: ReadonlyMap<string, Written>;
    reach: Reach;
}

export const reachOf = (written: readonly Written[]): Reach => {
    const pitches = written.map((note) => note.pitch);
    // A staff is shown whole, and a position beyond its outer lines, whatever is written on it.
    const reach = (staff: StaffName, lines: readonly number[]): Span => {
        const steps = [...written.filter((note) => note.staff === staff).map((note) => note.step), lines[0] - 1, lines[4] + 1];
        return { lo: Math.min(...steps), hi: Math.max(...steps) };
    };
    return {
        keys: pitches.length ? [Math.min(...pitches), Math.max(...pitches)] : [48, 72],
        treble: reach('treble', TREBLE),
        bass: reach('bass', BASS),
    };
};

/** The notes as they are written, and what follows from all of them together. */
export const notationOf = (notes: readonly RollNote[], graces: readonly RollGrace[]): Notation => {
    const signature = signatureOf(notes);
    const written = new Map<string, Written>();
    for (const { id, staff, pitch, letter, alter } of notes) {
        written.set(id, { staff, pitch, letter, alter, step: stepOf({ letter, alter, pitch }) });
    }
    // The score gives a grace note no spelling of its own.
    for (const { id, staff, pitch } of graces) {
        const spelled = spell(pitch, signature);
        written.set(id, { staff, ...spelled, step: stepOf(spelled) });
    }
    return { signature, written, reach: reachOf([...written.values()]) };
};

// ---------------------------------------------------------------------------------------------
// Down the roll
// ---------------------------------------------------------------------------------------------

/** The vertical mapping. */
export interface Frame {
    /** On the grand staff, or key by key. */
    staff: boolean;
    /** Where the roll begins under the ruler, and where the notes' share of it ends over the pedals. */
    top: number;
    bottom: number;
    /** Pixels per row. */
    rowHeight: number;
    /** How tall a note at the level is. */
    unit: number;
    /** How many rows the treble staff is lifted off the bass. */
    shift: number;
    /** The lowest and the highest row shown. */
    low: number;
    high: number;
    /** What is left over above and below the rows, each. */
    pad: number;
}

interface FrameOptions {
    /** How tall the roll is, ruler and pedals included. */
    height: number;
    pedalRows: number;
    staff: boolean;
    reach: Reach;
}

/**
 * Lays the rows out in the height there is.
 *
 * On the staff: two compact staves, the treble lifted clear of the bass, far enough that what
 * hangs under the one never meets what stands on the other, and further where there is room. A
 * position is never more than `STAFF_STEP` tall; of the height that leaves, the gap between the
 * staves takes the larger share and the margins the rest.
 *
 * Key by key: every key from the lowest to the highest its row, and the rows share the height.
 */
export const frameOf = ({ height, pedalRows, staff, reach }: FrameOptions): Frame => {
    const top = TOP;
    const bottom = height - 8 - pedalRows * (PEDAL + PEDAL_GAP);
    const room = bottom - top - HEAD;
    if (!staff) {
        const [low, high] = reach.keys;
        const rowHeight = Math.max(3, room / (high - low + 1));
        return { staff, top, bottom, rowHeight, unit: rowHeight, shift: 0, low, high, pad: 0 };
    }
    const { treble, bass } = reach;
    const least = Math.max(bass.hi - treble.lo + 3, 6);
    const rows = (shift: number) => treble.hi + shift - bass.lo + 1;
    const rowHeight = clamp(room / rows(least), 3, STAFF_STEP);
    const shift = least + clamp((room / rowHeight - rows(least)) * 0.6, 0, 18);
    return {
        staff,
        top,
        bottom,
        rowHeight,
        // A note at the level is a good half of a notehead, so a box on a line is told from one in a space.
        unit: rowHeight * 1.15,
        shift,
        low: bass.lo,
        high: treble.hi + shift,
        pad: (room - rowHeight * rows(shift)) / 2,
    };
};

/** How far a staff's positions are lifted, in rows: the treble staff stands apart from the bass. */
export const liftOf = (frame: Frame, staff: StaffName): number => (staff === 'treble' ? frame.shift : 0);

/** The row a note is drawn in: its position on its staff, or its key. */
export const rowOf = (frame: Frame, { staff, step, pitch }: Pick<Written, 'staff' | 'step' | 'pitch'>): number =>
    frame.staff ? step + liftOf(frame, staff) : pitch;

/** The middle of a row. */
export const yOf = (frame: Frame, row: number): number => frame.top + HEAD + frame.pad + (frame.high - row + 0.5) * frame.rowHeight;

/** The rows of the ten staff lines, from the bottom. */
export const staffRows = (frame: Frame): number[] => [...BASS, ...TREBLE.map((step) => step + frame.shift)];

/** The pedals the roll has a row for, in the order they are stacked, with what each is called in the gutter. */
export const pedalRowsOf = ({ played, rendered }: RollPedals): { kind: PedalKind; label: string }[] =>
    (
        [
            { kind: 'sustain', label: 'Ped' },
            { kind: 'soft', label: 'u.c.' },
        ] as const
    ).filter(({ kind }) => played.some((press) => press.kind === kind) || rendered.some((move) => move.kind === kind));

/** The top of a pedal row, counted from the first under the notes. */
export const pedalY = (frame: Frame, row: number): number => frame.bottom + 6 + row * (PEDAL + PEDAL_GAP);

// ---------------------------------------------------------------------------------------------
// Loudness
// ---------------------------------------------------------------------------------------------

/**
 * The loudness scale of one recording: its median velocity is one unit tall, and every doubling
 * of the velocity adds `perOctave` units, set so that its 98th percentile is three.
 */
export interface LoudnessScale {
    level: number;
    perOctave: number;
}

/** @param velocities of the notes as they were played */
export const scaleOf = (velocities: readonly number[]): LoudnessScale => {
    if (velocities.length === 0) return { level: 64, perOctave: 2 };
    const sorted = [...velocities].sort((a, b) => a - b);
    const level = Math.max(1, sorted[sorted.length >> 1]);
    const loudest = sorted[Math.floor(sorted.length * 0.98)];
    return { level, perOctave: 2 / Math.max(0.15, Math.log2(Math.max(loudest, level + 1) / level)) };
};

/** Units a velocity stands above the recording's level (below, if negative): the scale height and opacity share. */
export const loudness = (scale: LoudnessScale, velocity: number): number =>
    scale.perOctave * Math.log2(Math.max(velocity, 1) / scale.level);

/** How tall a note of this velocity is drawn. */
export const tall = (frame: Frame, scale: LoudnessScale, gain: number, velocity: number): number =>
    frame.unit * clamp(1 + gain * loudness(scale, velocity), 0.3, 6);

/** Opacity of a note: the louder, the more solid. */
export const solid = (scale: LoudnessScale, velocity: number): number => clamp(0.7 + 0.15 * loudness(scale, velocity), 0.3, 1);

// ---------------------------------------------------------------------------------------------
// Along the roll
// ---------------------------------------------------------------------------------------------

/** Where a moment of the recording is drawn. */
export const xOf = (ms: number, pxPerSecond: number): number => (ms / 1000) * pxPerSecond;

/** The inverse: the moment a place on the roll names. */
export const msOf = (x: number, pxPerSecond: number): number => (x / pxPerSecond) * 1000;

/** Linear interpolation through (xs, ys), extrapolated past both ends. */
const along = (xs: readonly number[], ys: readonly number[], x: number): number => {
    const last = xs.length - 1;
    if (last < 0) return x;
    if (last === 0) return ys[0];
    let lo = 0;
    let hi = last;
    if (x <= xs[0]) hi = 1;
    else if (x >= xs[last]) lo = last - 1;
    else {
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (xs[mid] <= x) lo = mid;
            else hi = mid;
        }
    }
    return ys[lo] + ((x - xs[lo]) / (xs[hi] - xs[lo])) * (ys[hi] - ys[lo]);
};

/** When a score date falls on the recording's clock, as the beats place it. */
export const clockOf = (beats: readonly { date: number; ms: number }[]): ((date: number) => number) => {
    const dates = beats.map((beat) => beat.date);
    const ms = beats.map((beat) => beat.ms);
    return (date) => along(dates, ms, date);
};

/** The last moment anything on the roll reaches. */
export const lastMs = (notes: readonly RollNote[], beats: readonly { ms: number }[], pedals: RollPedals): number => {
    let last = beats.length ? beats[beats.length - 1].ms : 0;
    for (const note of notes) last = Math.max(last, note.played.msEnd, note.rendered.msEnd);
    for (const press of pedals.played) last = Math.max(last, press.msEnd);
    return last;
};

/** A bar line: where it stands, and whether the tempo that puts it there is only assumed. */
export interface BarLine {
    n: number;
    x: number;
    assumed: boolean;
    /** Whether there is room for its number on the ruler. */
    numbered: boolean;
}

type Stretch = Readonly<{ from: number; to: number }>;

const within = (stretches: readonly Stretch[], date: number) => stretches.some((stretch) => date >= stretch.from && date < stretch.to);

/** How far apart two numbers on the ruler have to stand to be told apart, in px. */
const NUMBER_ROOM = 26;

/**
 * A number that would run into the one before it is left out. The upbeat's `0` is the exception,
 * and gives way to the bar after it: bar 1 is the one a reader looks for first.
 *
 * @param xAt where a score date is drawn
 */
export const barLinesOf = (
    bars: readonly ({ n: number } & Stretch)[],
    assumed: readonly Stretch[],
    xAt: (date: number) => number,
): BarLine[] => {
    let numbered = -Infinity;
    return bars.map((bar, index) => {
        const x = xAt(bar.from);
        const next = bars.at(index + 1);
        const crowdsTheFirstBar = index === 0 && bar.n === 0 && next !== undefined && xAt(next.from) - x < NUMBER_ROOM;
        const room = !crowdsTheFirstBar && x - numbered >= NUMBER_ROOM;
        if (room) numbered = x;
        return { n: bar.n, x, assumed: within(assumed, bar.from), numbered: room };
    });
};

/** The beats inside the bars, where the tempo is described and they stand far enough apart to be told. */
export const beatLinesOf = (
    bars: readonly Stretch[],
    beats: readonly { date: number }[],
    assumed: readonly Stretch[],
    xAt: (date: number) => number,
): number[] => {
    const lines: number[] = [];
    let next = 0;
    for (const bar of bars) {
        while (next < beats.length && beats[next].date <= bar.from) next++;
        const inside: number[] = [];
        while (next < beats.length && beats[next].date < bar.to - 1) inside.push(beats[next++].date);
        if (within(assumed, bar.from) || inside.length === 0) continue;
        if ((xAt(bar.to) - xAt(bar.from)) / (inside.length + 1) > 9) lines.push(...inside.map(xAt));
    }
    return lines;
};

/** The stretches whose tempo is described, not assumed: what `assumed` leaves of the piece. */
export const describedOf = (assumed: readonly Stretch[], end: number): [number, number][] => {
    const described: [number, number][] = [];
    let cursor = 0;
    for (const gap of [...assumed].sort((a, b) => a.from - b.from)) {
        if (gap.from > cursor) described.push([cursor, gap.from]);
        cursor = Math.max(cursor, gap.to);
    }
    if (cursor < end) described.push([cursor, end]);
    return described;
};

// ---------------------------------------------------------------------------------------------
// The notes
// ---------------------------------------------------------------------------------------------

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** A note's box, and how solid it is drawn. */
export interface NoteRect extends Rect {
    ink: number;
}

/** All a sounding needs to be drawn. */
export interface Drawing {
    frame: Frame;
    scale: LoudnessScale;
    /** How much taller a louder note is drawn. */
    gain: number;
    pxPerSecond: number;
}

/** The box of one sounding of a note on `row`: as long as it sounded, as tall as it was loud. */
export const rectOf = (sounded: Sounded, row: number, { frame, scale, gain, pxPerSecond }: Drawing): NoteRect => {
    const h = tall(frame, scale, gain, sounded.velocity);
    return {
        x: xOf(sounded.ms, pxPerSecond),
        y: yOf(frame, row) - h / 2,
        w: Math.max(2, xOf(sounded.msEnd - sounded.ms, pxPerSecond)),
        h,
        ink: solid(scale, sounded.velocity),
    };
};

/** Whether a shadow can be told from its note: it begins or ends elsewhere, or is taller or lower. */
export const apart = (a: Rect, b: Rect): boolean =>
    Math.abs(a.x - b.x) >= 1.5 || Math.abs(a.h - b.h) >= 1 || Math.abs(a.x + a.w - b.x - b.w) >= 2.5;

export interface PlacedNote {
    note: RollNote;
    /** The middle of the line or space it is on. */
    y: number;
    /** As the MPM so far renders it. */
    now: NoteRect;
    /** As it was played: its shadow. */
    was: NoteRect;
    /** Whether the shadow differs visibly from the note, and so is drawn. */
    shadowed: boolean;
    /** As the roll had it before a correction. */
    arrived: NoteRect | null;
    /** Where its ledger lines run. */
    ledgers: number[];
    /** The accidental it carries, where it departs from the key signature. */
    accidental: number | null;
}

export const placeNotes = (notes: readonly RollNote[], { written, signature }: Notation, drawing: Drawing): PlacedNote[] => {
    const { frame } = drawing;
    return notes.map((note) => {
        const place = written.get(note.id) ?? { ...note, step: stepOf(note) };
        const row = rowOf(frame, place);
        const now = rectOf(note.rendered, row, drawing);
        const was = rectOf(note.played, row, drawing);
        const lift = liftOf(frame, place.staff);
        return {
            note,
            y: yOf(frame, row),
            now,
            was,
            shadowed: apart(was, now),
            arrived: note.arrived ? rectOf(note.arrived, row, drawing) : null,
            ledgers: frame.staff
                ? ledgersOf(place.step, place.staff === 'treble' ? TREBLE : BASS).map((line) => yOf(frame, line + lift))
                : [],
            accidental: frame.staff && place.alter !== (signature.get(place.letter) ?? 0) ? place.alter : null,
        };
    });
};

/**
 * The note at a point: the rendered one, else the one whose shadow is there. Of several the
 * smallest, so that a soft note over a loud one can still be reached.
 *
 * @param shadows whether the shadows are drawn, and so can be pointed at
 */
export const noteAt = (placed: readonly PlacedNote[], x: number, y: number, shadows: boolean): PlacedNote | null => {
    const reach = 2;
    const holds = (rect: Rect) => x >= rect.x - reach && x <= rect.x + rect.w + reach && y >= rect.y - reach && y <= rect.y + rect.h + reach;
    const smallest = (rectOfNote: (entry: PlacedNote) => Rect | null): PlacedNote | null => {
        let best: PlacedNote | null = null;
        let area = Infinity;
        for (const entry of placed) {
            const rect = rectOfNote(entry);
            if (!rect || !holds(rect) || rect.w * rect.h >= area) continue;
            best = entry;
            area = rect.w * rect.h;
        }
        return best;
    };
    return smallest((entry) => entry.now) ?? (shadows ? smallest((entry) => (entry.shadowed ? entry.was : null)) : null);
};
