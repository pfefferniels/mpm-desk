/**
 * Which staff a played note is written on and how long it is written.
 *
 * Both are small questions once the onset is settled, and both are answered from the score
 * around the note rather than from a model of piano writing: the staff is the one whose notes
 * the new note lies among, and the length is the plain note value nearest to how long the key
 * was held.
 */

import { UNITS } from "./grid";
import { isCompound, type MeasureModel, type ScoreEvent, type StaffModel } from "./scoreModel";

/** How far either side of a moment the notes of a staff are looked at, in quarter notes. */
const NEIGHBOURHOOD = 1;

/**
 * The staff a pitch belongs on at a moment.
 *
 * The staff holding the written note nearest in pitch, among the notes sounding around that
 * moment. That is the hand: a note added a third below the melody is the right hand's, and one
 * an octave under the bass the left's, wherever middle C happens to be.
 */
export function chooseStaff(
    measure: MeasureModel,
    onset: number,
    pitch: number,
    hidden?: ReadonlySet<ScoreEvent>,
): StaffModel | undefined {
    let best: StaffModel | undefined;
    let bestDistance = Infinity;

    measure.staves.forEach((staff, index) => {
        let distance = Infinity;
        let any = Infinity;
        for (const layer of staff.layers) {
            for (const event of layer.events) {
                if (hidden?.has(event)) continue;
                for (const note of event.notes) {
                    const away = Math.abs(note.pitch - pitch);
                    any = Math.min(any, away);
                    const near =
                        event.onset <= onset + NEIGHBOURHOOD &&
                        event.onset + Math.max(event.duration, 1e-6) >= onset - NEIGHBOURHOOD;
                    if (near) distance = Math.min(distance, away);
                }
            }
        }

        // A staff with nothing near falls back on everything it has in the bar, and one with
        // nothing at all on where its clef usually sits
        if (!Number.isFinite(distance)) distance = Number.isFinite(any) ? any + 0.5 : Math.abs(pitch - (index === 0 ? 67 : 48)) + 12;

        if (distance < bestDistance - 1e-9) {
            best = staff;
            bestDistance = distance;
        }
    });

    return best;
}

/**
 * The written event a note joins: one on this staff that starts at the same moment.
 *
 * A chord is one stem, so a note struck with a written note becomes part of that note's chord
 * and takes its length. Where two voices start together it joins the one nearer in pitch.
 */
export function joinable(
    staff: StaffModel,
    onset: number,
    pitch: number,
    hidden?: ReadonlySet<ScoreEvent>,
): ScoreEvent | undefined {
    let best: ScoreEvent | undefined;
    let bestDistance = Infinity;
    for (const layer of staff.layers) {
        for (const event of layer.events) {
            if (event.grace || event.notes.length === 0 || hidden?.has(event)) continue;
            if (Math.abs(event.onset - onset) > 1e-6) continue;
            for (const note of event.notes) {
                const away = Math.abs(note.pitch - pitch);
                if (away < bestDistance) {
                    best = event;
                    bestDistance = away;
                }
            }
        }
    }
    return best;
}

/** One note value: how long it is in grid units, and how it is written. */
export interface NoteValue {
    units: number;
    dur: string;
    dots: number;
}

/** The plain values, longest first. A dotted thirty-second is not a whole number of units. */
const PLAIN: NoteValue[] = [
    { units: 144, dur: "1", dots: 1 },
    { units: 96, dur: "1", dots: 0 },
    { units: 72, dur: "2", dots: 1 },
    { units: 48, dur: "2", dots: 0 },
    { units: 36, dur: "4", dots: 1 },
    { units: 24, dur: "4", dots: 0 },
    { units: 18, dur: "8", dots: 1 },
    { units: 12, dur: "8", dots: 0 },
    { units: 9, dur: "16", dots: 1 },
    { units: 6, dur: "16", dots: 0 },
    { units: 3, dur: "32", dots: 0 },
];

/**
 * The values a note inside a triplet can take, in real grid units.
 *
 * Three in the time of two: what is written as an eighth lasts two thirds of one.
 */
const TRIPLET: NoteValue[] = PLAIN.filter((value) => value.units % 3 === 0 && value.units <= 36).map(
    (value) => ({ ...value, units: (value.units * 2) / 3 }),
);

/** Whether a position, in grid units from the barline, can only be written inside a triplet. */
const isTripletPosition = (units: number): boolean => units % 3 !== 0;

/** The quarter-note cell a position lies in: where a triplet bracket would begin and end. */
const cellOf = (units: number, measureUnits: number): { from: number; to: number } => {
    const from = Math.floor(units / UNITS) * UNITS;
    return { from, to: Math.min(from + UNITS, measureUnits) };
};

/**
 * The note value for a note of its own: the longest plain value that reaches no further than
 * the next thing written in its hand.
 *
 * Not how long the key was held. That is the obvious measure and a poor one: held out of their
 * own scores, the notes of thirty-two piano rolls come back with the value Chopin wrote 39% of
 * the time by how long they were held and 84% by how far it is to the next note. A note value
 * says where the next note comes, and how much of that time the key stays down is articulation,
 * which the performance markup has an instruction of its own for. Nakamura, Yoshii and Dixon
 * (2017) find the same of transcription at large.
 *
 * One value and never two tied: a note the performer added is not tied over a barline by an
 * algorithm, and a value that does not fit before the barline, or inside the triplet it starts
 * in, is cut to one that does.
 */
export function chooseValue(
    startUnits: number,
    /** Grid units from the note to the next thing written on its staff, or to the barline */
    roomUnits: number,
    measure: MeasureModel,
): NoteValue {
    const measureUnits = Math.round(measure.duration * UNITS);
    const triplet = !isCompound(measure.meter) && isTripletPosition(startUnits);
    const values = triplet ? TRIPLET : PLAIN;
    const limit = Math.min(
        roomUnits,
        (triplet ? cellOf(startUnits, measureUnits).to : measureUnits) - startUnits,
    );

    return values.find((value) => value.units <= limit + 1e-9) ?? values[values.length - 1];
}

/** One thing in a layer being written: a note or chord at a place, for a length. */
export interface LayerItem<T> {
    start: number;
    value: NoteValue;
    payload: T;
}

/** A stretch of a new layer: something sounding or nothing, possibly inside a triplet bracket. */
export type LayerPiece<T> =
    | { kind: "space"; value: NoteValue }
    | { kind: "item"; value: NoteValue; item: LayerItem<T> }
    | { kind: "tuplet"; pieces: LayerPiece<T>[] };

/**
 * Whether an item can go into a layer beside the items already in it.
 *
 * It may not sound while another does, and a triplet bracket has to close over whole values:
 * nothing may reach into the quarter a triplet occupies from outside it, or out of it.
 */
export function fitsLayer<T>(
    items: readonly LayerItem<T>[],
    item: LayerItem<T>,
    measure: MeasureModel,
): boolean {
    const measureUnits = Math.round(measure.duration * UNITS);
    const all = [...items, item];

    for (const other of items) {
        if (item.start < other.start + other.value.units - 1e-9 && other.start < item.start + item.value.units - 1e-9) {
            return false;
        }
    }
    if (isCompound(measure.meter)) return true;

    for (const candidate of all) {
        if (!isTripletPosition(candidate.start) && !isTripletPosition(candidate.start + candidate.value.units)) continue;
        const cell = cellOf(candidate.start, measureUnits);
        for (const other of all) {
            const end = other.start + other.value.units;
            const inside = other.start >= cell.from - 1e-9 && end <= cell.to + 1e-9;
            const outside = end <= cell.from + 1e-9 || other.start >= cell.to - 1e-9;
            if (!inside && !outside) return false;
            if (!inside) continue;

            // Inside the bracket everything is counted in triplet values: a thirty-second
            // has no place among them, and neither has a length that is not one of theirs
            if (other.start % 2 !== 0 || end % 2 !== 0) return false;
            if (!PLAIN.some((plain) => Math.abs(plain.units - (other.value.units * 3) / 2) < 1e-9)) return false;
        }
    }
    return true;
}

/**
 * Lay a layer out: the items where they belong and silence everywhere else, so that the layer
 * is exactly as long as the measure.
 *
 * The silence is `<space>`, which takes time and draws nothing. A rest would say the performer
 * stopped, and nobody stopped: the other voices are sounding.
 */
export function layOut<T>(items: readonly LayerItem<T>[], measure: MeasureModel): LayerPiece<T>[] {
    const measureUnits = Math.round(measure.duration * UNITS);
    const sorted = [...items].sort((a, b) => a.start - b.start);
    const compound = isCompound(measure.meter);

    // The quarters that have to be written as triplets
    const triplets = new Set<number>();
    if (!compound) {
        for (const item of sorted) {
            if (isTripletPosition(item.start) || isTripletPosition(item.start + item.value.units)) {
                triplets.add(cellOf(item.start, measureUnits).from);
            }
        }
    }

    const pieces: LayerPiece<T>[] = [];
    let at = 0;
    let next = 0;

    /** Silence from `from` to `to`, in the longest values that fit, into `target`. */
    const silence = (from: number, to: number, target: LayerPiece<T>[], values: NoteValue[]) => {
        let left = to - from;
        while (left > 1e-9) {
            const value = values.find((candidate) => candidate.units <= left + 1e-9);
            if (!value) break;
            target.push({ kind: "space", value });
            left -= value.units;
        }
    };

    while (at < measureUnits - 1e-9) {
        const cell = cellOf(at, measureUnits);
        const inTriplet = triplets.has(cell.from) && at >= cell.from - 1e-9;

        if (inTriplet) {
            const inner: LayerPiece<T>[] = [];
            let cursor = cell.from;
            while (next < sorted.length && sorted[next].start < cell.to - 1e-9) {
                const item = sorted[next++];
                silence(cursor, item.start, inner, TRIPLET);
                inner.push({ kind: "item", value: tripletValue(item.value), item });
                cursor = item.start + item.value.units;
            }
            silence(cursor, cell.to, inner, TRIPLET);
            pieces.push({ kind: "tuplet", pieces: inner });
            at = cell.to;
            continue;
        }

        // Plain time, up to the next item or the next triplet, whichever comes first
        const item = sorted[next];
        const nextTriplet = [...triplets].filter((from) => from >= at - 1e-9).sort((a, b) => a - b)[0];
        const stop = Math.min(item ? item.start : measureUnits, nextTriplet ?? measureUnits);

        if (stop > at + 1e-9) {
            silence(at, stop, pieces, PLAIN);
            at = stop;
            continue;
        }
        if (item && Math.abs(item.start - at) < 1e-9) {
            pieces.push({ kind: "item", value: item.value, item });
            at = item.start + item.value.units;
            next++;
            continue;
        }
        break;
    }

    return pieces;
}

/** The value as it is written inside a triplet: what lasts two thirds of an eighth is an eighth. */
function tripletValue(value: NoteValue): NoteValue {
    const written = PLAIN.find((plain) => Math.abs(plain.units - (value.units * 3) / 2) < 1e-9);
    return written ? { ...written, units: value.units } : value;
}
