/**
 * Which staff a played note is written on, in which voice, and how long it is written.
 *
 * All small questions once the onset is settled, and all answered from the score around the
 * note rather than from a model of piano writing: the staff is the one whose notes the new note
 * lies among, the voice is one the staff already has, and the length is the note value that
 * reaches to the next note of that voice.
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

/**
 * The values a note of its own can be given at a place, longest first: what a reader steps
 * through to make it longer or shorter.
 */
export function valuesAt(startUnits: number, measure: MeasureModel): NoteValue[] {
    const measureUnits = Math.round(measure.duration * UNITS);
    const triplet = !isCompound(measure.meter) && isTripletPosition(startUnits);
    const limit = (triplet ? cellOf(startUnits, measureUnits).to : measureUnits) - startUnits;
    return (triplet ? TRIPLET : PLAIN).filter((value) => value.units <= limit + 1e-9);
}

/**
 * The stretch of a bar one written event takes up, in grid units from the barline: the time a
 * played note is written into when it was struck while that event was sounding, or was silent.
 */
interface HostSpan {
    from: number;
    to: number;
    /** Whether the event stands inside a triplet bracket, where every value is written a third longer */
    triplet: boolean;
}

const isWhole = (units: number): boolean => Math.abs(units - Math.round(units)) < 1e-6;

/**
 * The time an event takes up, where a note can be written into it.
 *
 * Not every event can be cut in two. One that stands off the grid, inside a quintuplet or a
 * tremolo, has no place for a second note that the grid could name, and one the page draws at
 * another value than it sounds for has no value of its own to shorten.
 */
export function hostSpan(event: ScoreEvent): HostSpan | undefined {
    if (event.grace || event.duration <= 0) return undefined;
    const measure = event.layer.staff.measure;
    const from = (event.onset - measure.onset) * UNITS;
    const to = from + event.duration * UNITS;
    if (!isWhole(from) || !isWhole(to)) return undefined;

    const element = event.element;
    if (element.localName === "multiRest") return undefined;
    if (element.hasAttribute("dur.ges") || element.querySelector("note[dur\\.ges]")) return undefined;

    let triplet = false;
    for (
        let parent = element.parentElement;
        parent && parent !== event.layer.element;
        parent = parent.parentElement
    ) {
        if (parent.localName === "fTrem" || parent.localName === "bTrem") return undefined;
        if (parent.localName !== "tuplet") continue;
        // One bracket of three in the time of two, and no other
        if (triplet) return undefined;
        if ((parent.getAttribute("num") ?? "3") !== "3" || (parent.getAttribute("numbase") ?? "2") !== "2") {
            return undefined;
        }
        triplet = true;
    }
    if (triplet && (Math.round(from) % 2 !== 0 || Math.round(to) % 2 !== 0)) return undefined;

    return { from: Math.round(from), to: Math.round(to), triplet };
}

/**
 * The written event a note of its own is written into: what the voice was doing at that moment.
 *
 * A played note that no written note starts with was struck while every voice of its staff was
 * in the middle of something, a note or a silence. It is written into one of those voices and
 * not into a new one. A voice that was silent there has room for it as it stands, so silence
 * comes first, since nothing written has to change for it. Otherwise it belongs to the voice
 * whose note lies nearest, and that note ends where the new one begins, which is what one voice
 * playing two notes after each other looks like.
 *
 * Unless the performer had not let go of it. A note still held down while another is struck is
 * two voices, whatever the score has, and writing the first as ended would contradict the
 * recording. Then there is no event to write the note into, and none either where the nearest
 * note cannot be cut in two: it is not handed on to a voice further off that it has nothing to
 * do with.
 */
export function hostFor(
    staff: StaffModel,
    onset: number,
    pitch: number,
    /** Whether a sounding event had been let go by then; taken to have been where nobody says */
    letGo: (event: ScoreEvent) => boolean = () => true,
): ScoreEvent | undefined {
    let silent: ScoreEvent | undefined;
    let silentDistance = Infinity;
    let sounding: ScoreEvent | undefined;
    let soundingDistance = Infinity;

    for (const layer of staff.layers) {
        let nearest = Infinity;
        for (const event of layer.events) {
            for (const note of event.notes) nearest = Math.min(nearest, Math.abs(note.pitch - pitch));
        }

        for (const event of layer.events) {
            if (event.grace) continue;
            const quiet = event.kind === "rest" || event.kind === "space";
            if (!quiet && event.notes.length === 0) continue;
            // A sounding event the note starts with is one it joins, as a chord: not this
            const begun = quiet ? event.onset <= onset + 1e-6 : event.onset < onset - 1e-6;
            if (!begun || event.onset + event.duration <= onset + 1e-6) continue;

            if (quiet) {
                if (hostSpan(event) && (!silent || nearest < silentDistance)) {
                    silent = event;
                    silentDistance = nearest;
                }
                continue;
            }
            let distance = Infinity;
            for (const note of event.notes) distance = Math.min(distance, Math.abs(note.pitch - pitch));
            if (distance < soundingDistance) {
                sounding = event;
                soundingDistance = distance;
            }
        }
    }

    if (silent) return silent;
    return sounding && hostSpan(sounding) && letGo(sounding) ? sounding : undefined;
}

/**
 * The lengths a moment written into an event can be given, longest first.
 *
 * It reaches no further than the next moment written into the same event, or the end of that
 * event, or `until` where the caller knows of something sooner. Where any of the moments stands
 * on a triplet position, the quarter it is in is written as a triplet, and everything in that
 * quarter is counted in triplet values and stays inside it.
 */
export function valuesInside(
    host: HostSpan,
    /** Where each moment written into the event starts, in order */
    starts: readonly number[],
    index: number,
    measure: MeasureModel,
    until = Infinity,
): NoteValue[] {
    const start = starts[index];
    const measureUnits = Math.round(measure.duration * UNITS);
    const cells = tripletCells(host, starts, measure);
    if (!cells) return [];

    const cell = cellOf(start, measureUnits);
    const triplet = host.triplet || cells.has(cell.from);
    if (triplet ? start % 2 !== 0 : start % 3 !== 0) return [];

    let end = Math.min(starts[index + 1] ?? host.to, host.to, until);
    if (triplet && !host.triplet) end = Math.min(end, cell.to);
    // A plain value stops at the bracket of the next triplet
    for (const from of cells) if (!triplet && from > start) end = Math.min(end, from);

    return (triplet ? TRIPLET : PLAIN).filter((value) => value.units <= end - start + 1e-9);
}

/**
 * The quarters of an event that have to be written as triplets, by where each begins; undefined
 * where one of them does not lie wholly inside the event, which cannot then be written.
 */
function tripletCells(host: HostSpan, starts: readonly number[], measure: MeasureModel): Set<number> | undefined {
    const cells = new Set<number>();
    if (host.triplet) return cells;
    const measureUnits = Math.round(measure.duration * UNITS);

    for (const start of starts) {
        if (!isTripletPosition(start)) continue;
        if (isCompound(measure.meter)) return undefined;
        const cell = cellOf(start, measureUnits);
        if (cell.from < host.from || cell.to > host.to) return undefined;
        cells.add(cell.from);
    }
    return cells;
}

/** One stretch of an event rewritten around the notes played during it. */
export type HostPiece<T> =
    /** The event itself for this long: one piece where its new length is a note value, tied pieces where not */
    | { kind: "host"; value: NoteValue }
    /** Nothing: what is left after a note that does not reach the next one */
    | { kind: "gap"; value: NoteValue }
    | { kind: "item"; value: NoteValue; item: LayerItem<T> }
    | { kind: "tuplet"; pieces: HostPiece<T>[] };

/**
 * Write an event again with the moments played during it: the event up to the first of them,
 * then each moment for its length, so that together they take exactly the time the event took.
 *
 * Undefined where it cannot be done, and the caller has to find the notes another place.
 */
export function splitHost<T>(
    host: HostSpan,
    items: readonly LayerItem<T>[],
    measure: MeasureModel,
): HostPiece<T>[] | undefined {
    const sorted = [...items].sort((a, b) => a.start - b.start);
    if (sorted.length === 0) return undefined;
    const measureUnits = Math.round(measure.duration * UNITS);
    const cells = tripletCells(host, sorted.map((item) => item.start), measure);
    if (!cells) return undefined;
    const inTriplet = (units: number): boolean => host.triplet || cells.has(cellOf(units, measureUnits).from);

    interface Atom { from: number; triplet: boolean; piece: HostPiece<T> }
    const atoms: Atom[] = [];

    /** A stretch of the event or of nothing, in as few values as write it. */
    const fill = (from: number, to: number, kind: "host" | "gap"): boolean => {
        let at = from;
        while (at < to - 1e-9) {
            const triplet = inTriplet(at);
            let stop = to;
            if (!host.triplet) {
                // As far as the time stays of one kind: to the end of this triplet, or the start of the next
                if (triplet) stop = Math.min(to, cellOf(at, measureUnits).to);
                else for (const cell of cells) if (cell > at) stop = Math.min(stop, cell);
            }
            if (triplet ? at % 2 !== 0 || stop % 2 !== 0 : at % 3 !== 0 || stop % 3 !== 0) return false;

            // The event is counted on from where it began, and what is left over is counted
            // back from where the next thing begins, so that either lines up with the beat
            const values: NoteValue[] = [];
            let left = stop - at;
            while (left > 1e-9) {
                const value = (triplet ? TRIPLET : PLAIN).find((candidate) => candidate.units <= left + 1e-9);
                if (!value) return false;
                values.push(value);
                left -= value.units;
            }
            if (kind === "gap") values.reverse();

            let cursor = at;
            for (const value of values) {
                atoms.push({ from: cursor, triplet, piece: { kind, value: triplet ? tripletValue(value) : value } });
                cursor += value.units;
            }
            at = stop;
        }
        return true;
    };

    let at = host.from;
    let lead: "host" | "gap" = "host";
    for (const item of sorted) {
        const end = item.start + item.value.units;
        if (item.start < at - 1e-9 || end > host.to + 1e-9) return undefined;
        if (item.start > at + 1e-9 && !fill(at, item.start, lead)) return undefined;

        const triplet = inTriplet(item.start);
        if (triplet) {
            // Counted in triplet values and closed inside its quarter
            if (item.start % 2 !== 0 || !TRIPLET.some((value) => value.units === item.value.units)) return undefined;
            if (!host.triplet && end > cellOf(item.start, measureUnits).to + 1e-9) return undefined;
        } else {
            if (item.start % 3 !== 0 || item.value.units % 3 !== 0) return undefined;
            for (const cell of cells) if (cell > item.start && end > cell + 1e-9) return undefined;
        }
        atoms.push({
            from: item.start,
            triplet,
            piece: { kind: "item", value: triplet ? tripletValue(item.value) : item.value, item },
        });
        at = end;
        lead = "gap";
    }
    if (at < host.to - 1e-9 && !fill(at, host.to, "gap")) return undefined;

    // A bracket over each quarter that is a triplet; inside a bracket the score has, none
    const pieces: HostPiece<T>[] = [];
    let bracket: { cell: number; pieces: HostPiece<T>[] } | undefined;
    for (const atom of atoms) {
        if (host.triplet || !atom.triplet) {
            bracket = undefined;
            pieces.push(atom.piece);
            continue;
        }
        const cell = cellOf(atom.from, measureUnits).from;
        if (!bracket || bracket.cell !== cell) {
            bracket = { cell, pieces: [] };
            pieces.push({ kind: "tuplet", pieces: bracket.pieces });
        }
        bracket.pieces.push(atom.piece);
    }
    return pieces;
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
