/**
 * The score as the transcriber needs it: where every written event stands, in which voice, and
 * what the notation around it says about metre and key.
 *
 * Read off the document rather than off verovio's timemap, for two reasons. The timemap knows
 * when a note sounds and nothing about the layer it is written in, the rest beside it or the
 * tuplet around it, which is everything a new note has to be fitted into. And reading the
 * document is synchronous, so the whole transcription can be derived while rendering instead of
 * awaited.
 *
 * Only one reading of an `<app>` is read, the one verovio engraves: the performance reading where
 * there is one. A document that has been transcribed once is therefore read as transcribed.
 */

import {
    ALTERATION,
    accidentalsOf,
    impliedAlterations,
    keySignatureOf,
    ownAccidental,
    readableChildren,
} from "../../score/accidentals";

export interface Meter {
    count: number;
    unit: number;
}

/** One written note: a `<note>`, on its own or inside a `<chord>`. */
export interface WrittenNote {
    id: string;
    element: Element;
    event: ScoreEvent;
    /** The letter, lower case, as `@pname` writes it */
    pname: string;
    oct: number;
    /** Semitones the letter is altered by, its own accidental or the one the notation implies */
    alter: number;
    /** MIDI pitch, alteration included */
    pitch: number;
    /** The octave it sounds in, which an ottava moves away from the one it is written in */
    sounding: number;
}

/** One timed thing in a layer: a note, a chord, a rest or a space. */
export interface ScoreEvent {
    /** The `<note>`, `<chord>`, `<rest>`, `<space>`, `<mRest>` or `<mSpace>` */
    element: Element;
    kind: "note" | "chord" | "rest" | "space";
    /** Quarter notes from the start of the piece */
    onset: number;
    /** The written length in quarter notes; zero for a grace note */
    duration: number;
    grace: boolean;
    notes: WrittenNote[];
    layer: LayerModel;
}

export interface LayerModel {
    element: Element;
    n: string;
    staff: StaffModel;
    events: ScoreEvent[];
}

export interface StaffModel {
    element: Element;
    n: string;
    measure: MeasureModel;
    layers: LayerModel[];
    /** What the key signature alters on this staff, by pitch name */
    key: ReadonlyMap<string, string>;
}

export interface MeasureModel {
    element: Element;
    /** Position among the measures of the piece, from zero */
    index: number;
    /** Quarter notes from the start of the piece */
    onset: number;
    /** How long the measure is as written, which is shorter than the metre for an upbeat */
    duration: number;
    meter: Meter;
    staves: StaffModel[];
}

export interface ScoreModel {
    doc: Document;
    measures: MeasureModel[];
    /** Every written note by `@xml:id` */
    notes: Map<string, WrittenNote>;
    /** Every event that sounds, graces left out, in the order they are written */
    events: ScoreEvent[];
}

const DURATIONS: Record<string, number> = {
    maxima: 32,
    long: 16,
    longa: 16,
    breve: 8,
    brevis: 8,
    "1": 4,
    "2": 2,
    "4": 1,
    "8": 0.5,
    "16": 0.25,
    "32": 0.125,
    "64": 0.0625,
    "128": 0.03125,
    "256": 0.015625,
};

const NATURAL: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

const DEFAULT_METER: Meter = { count: 4, unit: 4 };

/**
 * How long an element lasts, in quarter notes; undefined where it states nothing.
 *
 * `@dur.ges` before `@dur`, as verovio times it. The two differ where the page draws one value
 * and means another: a half-note head inside a beam of eighths, which Chopin writes for a note
 * that is both part of the figure and held through it.
 */
const writtenLength = (element: Element): number | undefined => {
    const gestural = element.getAttribute("dur.ges");
    const dur = gestural ?? element.getAttribute("dur");
    if (dur === null) return undefined;
    const base = DURATIONS[dur];
    if (base === undefined) return undefined;

    const dots = Number(
        (gestural !== null ? element.getAttribute("dots.ges") : null) ??
            (gestural !== null ? "0" : element.getAttribute("dots") ?? "0"),
    );
    return base * (2 - Math.pow(2, -(Number.isFinite(dots) ? dots : 0)));
};

const meterOf = (element: Element): Meter | undefined => {
    const count = element.getAttribute("meter.count") ?? element.getAttribute("count");
    const unit = element.getAttribute("meter.unit") ?? element.getAttribute("unit");
    if (count !== null && unit !== null) {
        // "3+2" and the like add up; anything unreadable leaves the metre as it was
        const total = count
            .split("+")
            .map(Number)
            .reduce((sum, part) => sum + part, 0);
        if (Number.isFinite(total) && total > 0 && Number(unit) > 0) {
            return { count: total, unit: Number(unit) };
        }
    }

    const symbol = element.getAttribute("meter.sym") ?? element.getAttribute("sym");
    if (symbol === "common") return { count: 4, unit: 4 };
    if (symbol === "cut") return { count: 2, unit: 2 };
    return undefined;
};

/** How long a measure of this metre is, in quarter notes. */
const meterLength = (meter: Meter): number => (meter.count * 4) / meter.unit;

/**
 * The beat of a metre, in quarter notes.
 *
 * A dotted value where the count groups in threes, 6/8 and its relations, which is what decides
 * whether three notes to the beat are the ordinary division or a triplet.
 */
export const beatLength = (meter: Meter): number => {
    const unit = 4 / meter.unit;
    const compound = meter.count % 3 === 0 && meter.count > 3 && meter.unit >= 8;
    return compound ? unit * 3 : unit;
};

export const isCompound = (meter: Meter): boolean =>
    meter.count % 3 === 0 && meter.count > 3 && meter.unit >= 8;

/**
 * Read the document.
 *
 * The onsets are the written ones, each layer counted through from the barline, and a measure
 * is as long as its longest layer. That is how verovio counts too, and the corpus check in
 * `scripts/transcription` holds the two against each other.
 */
export function readScore(doc: Document): ScoreModel {
    const measures: MeasureModel[] = [];
    const notes = new Map<string, WrittenNote>();
    const events: ScoreEvent[] = [];

    let meter = DEFAULT_METER;
    let scoreKey: ReadonlyMap<string, string> = new Map();
    const staffKeys = new Map<string, ReadonlyMap<string, string>>();
    let clock = 0;

    const readLayer = (layerElement: Element, staff: StaffModel, start: number): LayerModel => {
        const layer: LayerModel = {
            element: layerElement,
            n: layerElement.getAttribute("n") ?? "",
            staff,
            events: [],
        };
        let at = start;

        const push = (
            element: Element,
            kind: ScoreEvent["kind"],
            duration: number,
            grace: boolean,
        ): void => {
            const event: ScoreEvent = {
                element,
                kind,
                onset: at,
                duration: grace ? 0 : duration,
                grace,
                notes: [],
                layer,
            };

            const written = kind === "note" ? [element] : kind === "chord" ? chordNotes(element) : [];
            for (const note of written) {
                const pname = note.getAttribute("pname");
                const id = note.getAttribute("xml:id");
                if (!pname || !id) continue;
                const info: WrittenNote = {
                    id,
                    element: note,
                    event,
                    pname,
                    oct: Number(note.getAttribute("oct") ?? "4"),
                    alter: 0,
                    pitch: 0,
                    // An ottava is written an octave away from where it sounds
                    sounding: Number(note.getAttribute("oct.ges") ?? note.getAttribute("oct") ?? "4"),
                };
                event.notes.push(info);
                notes.set(id, info);
            }

            layer.events.push(event);
            if (!grace) {
                events.push(event);
                at += duration;
            }
        };

        const walk = (parent: Element, factor: number, grace: boolean): void => {
            for (const child of readableChildren(parent)) {
                const isGrace = grace || child.hasAttribute("grace");
                switch (child.localName) {
                    case "note":
                        push(child, "note", (writtenLength(child) ?? 1) * factor, isGrace);
                        break;
                    case "chord": {
                        const own =
                            writtenLength(child) ??
                            chordNotes(child)
                                .map(writtenLength)
                                .find((length) => length !== undefined) ??
                            1;
                        const graceChord =
                            isGrace || chordNotes(child).some((note) => note.hasAttribute("grace"));
                        push(child, "chord", own * factor, graceChord);
                        break;
                    }
                    case "rest":
                        push(child, "rest", (writtenLength(child) ?? 1) * factor, isGrace);
                        break;
                    case "space":
                        push(child, "space", (writtenLength(child) ?? 1) * factor, isGrace);
                        break;
                    case "mRest":
                    case "multiRest":
                        push(child, "rest", meterLength(meter), false);
                        break;
                    case "mSpace":
                        push(child, "space", meterLength(meter), false);
                        break;
                    case "tuplet": {
                        const num = Number(child.getAttribute("num") ?? "3");
                        const numbase = Number(child.getAttribute("numbase") ?? "2");
                        walk(child, num > 0 && numbase > 0 ? (factor * numbase) / num : factor, isGrace);
                        break;
                    }
                    case "fTrem":
                        // Two notes written at the length of the whole figure, which between
                        // them last as long as one of them is written
                        walk(child, factor / 2, isGrace);
                        break;
                    case "graceGrp":
                        walk(child, factor, true);
                        break;
                    case "meterSig": {
                        const stated = meterOf(child);
                        if (stated) meter = stated;
                        break;
                    }
                    case "keySig":
                        staffKeys.set(staff.n, accidentalsOf(child));
                        staff.key = accidentalsOf(child);
                        break;
                    case "clef":
                    case "barLine":
                    case "accid":
                    case "artic":
                    case "verse":
                    case "dot":
                        break;
                    default:
                        // A beam, an editorial wrapper, a reading: whatever holds events
                        if (child.children.length > 0) walk(child, factor, isGrace);
                }
            }
        };

        walk(layerElement, 1, false);
        return layer;
    };

    const readMeasure = (element: Element): void => {
        const measure: MeasureModel = {
            element,
            index: measures.length,
            onset: clock,
            duration: 0,
            meter,
            staves: [],
        };

        const visit = (parent: Element): void => {
            for (const child of readableChildren(parent)) {
                if (child.localName === "staff") {
                    const n = child.getAttribute("n") ?? "";
                    const staff: StaffModel = {
                        element: child,
                        n,
                        measure,
                        layers: [],
                        key: staffKeys.get(n) ?? scoreKey,
                    };
                    const readStaff = (inner: Element): void => {
                        for (const grandchild of readableChildren(inner)) {
                            if (grandchild.localName === "layer") {
                                staff.layers.push(readLayer(grandchild, staff, clock));
                            } else if (grandchild.children.length > 0) {
                                readStaff(grandchild);
                            }
                        }
                    };
                    readStaff(child);
                    measure.staves.push(staff);
                } else if (isControlEvent(child)) {
                    continue;
                } else if (child.children.length > 0) {
                    visit(child);
                }
            }
        };
        visit(element);

        // The metre may have been stated inside the first layer of this very measure
        measure.meter = meter;

        let longest = 0;
        for (const staff of measure.staves) {
            for (const layer of staff.layers) {
                const last = layer.events[layer.events.length - 1];
                if (last) longest = Math.max(longest, last.onset + last.duration - clock);
            }
        }
        measure.duration = longest > 0 ? longest : meterLength(meter);
        clock += measure.duration;
        measures.push(measure);
    };

    const visit = (element: Element): void => {
        switch (element.localName) {
            case "scoreDef": {
                const stated = meterOf(element);
                if (stated) meter = stated;
                const key = keySignatureOf(element);
                if (key) {
                    scoreKey = key;
                    staffKeys.clear();
                }
                break;
            }
            case "staffDef": {
                const stated = meterOf(element);
                if (stated) meter = stated;
                const key = keySignatureOf(element);
                const n = element.getAttribute("n");
                if (key && n) staffKeys.set(n, key);
                break;
            }
            case "meterSig": {
                const stated = meterOf(element);
                if (stated) meter = stated;
                return;
            }
            case "measure":
                readMeasure(element);
                return;
        }
        for (const child of readableChildren(element)) visit(child);
    };

    const music = doc.querySelector("music") ?? doc.documentElement;
    visit(music);

    // What each note sounds as. Its own accidental where it states one, and otherwise what the
    // key signature and the accidentals before it in the measure imply.
    const onsets = new Map<string, number>();
    for (const note of notes.values()) onsets.set(note.id, note.event.onset);
    const implied = impliedAlterations(doc, onsets);
    for (const note of notes.values()) {
        const own = ownAccidental(note.element);
        note.alter = own !== undefined ? ALTERATION[own] ?? 0 : implied.get(note.id) ?? 0;
        note.pitch = (note.sounding + 1) * 12 + (NATURAL[note.pname] ?? 0) + note.alter;
    }

    return { doc, measures, notes, events };
}

/** The notes of a chord as verovio reads them, one reading of any `<app>` inside it. */
function chordNotes(chord: Element): Element[] {
    const found: Element[] = [];
    const walk = (parent: Element): void => {
        for (const child of readableChildren(parent)) {
            if (child.localName === "note") found.push(child);
            else if (child.children.length > 0) walk(child);
        }
    };
    walk(chord);
    return found;
}

const CONTROL_EVENTS = new Set([
    "slur", "tie", "dynam", "hairpin", "dir", "tempo", "pedal", "fermata", "trill", "mordent",
    "turn", "arpeg", "ornam", "octave", "harm", "fing", "breath", "caesura", "phrase", "gliss",
    "lv", "bend", "reh", "tupletSpan", "beamSpan", "bracketSpan", "mNum", "anchoredText",
]);

const isControlEvent = (element: Element): boolean => CONTROL_EVENTS.has(element.localName);

/** The measure a moment falls in: the last one starting at or before it. */
export function measureAt(model: ScoreModel, onset: number): MeasureModel | undefined {
    const { measures } = model;
    let low = 0;
    let high = measures.length - 1;
    let found: MeasureModel | undefined;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (measures[mid].onset <= onset + 1e-9) {
            found = measures[mid];
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return found;
}
