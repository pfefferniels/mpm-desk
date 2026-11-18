/**
 * Writing the transcription into the document, as readings.
 *
 * Everything the performer did differently goes into an `<app>` holding what the source writes
 * in `<rdg source="original">` beside what was played in `<rdg source="performance">`, the
 * vocabulary the alignment desk has always written by hand. Nothing of the source is changed or
 * lost: taking the first reading of every `<app>` gives the score back as it was, and
 * {@link revertTranscription} does exactly that.
 *
 * The readings are kept as small as the notation allows, because a note that stands in both
 * readings stands in the document twice:
 *
 *   a note added to a written chord    an `<app>` inside the `<chord>`, holding the new note
 *   a note of a chord not played       an `<app>` around that note, its performance reading empty
 *   a note played at another pitch     an `<app>` around that note, holding the played one
 *   a note on its own not played       an `<app>` around it, holding a rest of its length
 *   a grace note                       an `<app>` before the note it leans on
 *   a note at a place of its own       an `<app>` around what its voice was doing there: the
 *                                      note it was played during, ending where the new one
 *                                      begins, or the silence, with the new note in it
 *   the same, where no voice takes it  a new `<layer>` in the staff, inside an `<app>`
 *   a tied note struck again           an `<app>` around the `<tie>`, its performance reading empty
 *   a note held instead of struck      an `<app>` in the measure, holding a `<tie>`
 *
 * Two things need a written note in both readings. A note added to a *single* written note,
 * because one note and another make a `<chord>`, and a chord is a different element from a
 * note. And a note a new one was played during, because one voice plays one thing at a time:
 * the written note is as long in the performance reading as it took the performer to get to the
 * next, one value where that is one and tied values where it is not, and the tie is a reading
 * of its own in the measure, as every tie written here is.
 *
 * Every measure stays as long as it was. What is written into an event takes exactly that
 * event's time, a new layer is padded with `<space>` to the barline, a note taken out leaves a
 * rest, and a triplet is closed inside its quarter, so that verovio counts the other voices
 * exactly as before.
 */

import { ownAccidental } from "../../score/accidentals";
import type { FigureSign } from "./figure";
import { UNITS } from "./grid";
import {
    fitsLayer,
    hostSpan,
    layOut,
    splitHost,
    type HostPiece,
    type LayerItem,
    type LayerPiece,
    type NoteValue,
} from "./place";
import type { MeasureModel, ScoreEvent, ScoreModel, StaffModel, WrittenNote } from "./scoreModel";
import { accidentalOf, type Spelling } from "./spell";

const MEI_NS = "http://www.music-encoding.org/ns/mei";

/** What marks an `<app>` as written here, so that it can be found and taken out again. */
const TRANSCRIPTION = "transcription";

/** What marks a written note whose accidental was restated here to keep it sounding as it did. */
const PINNED = "transcription-pin";

/** A note to be written: what was played, and what it is called. */
export interface NewNote {
    id: string;
    pitch: number;
    spelling: Spelling;
    /** The divergence it belongs to, which is what a reader's decision is filed under */
    group: string;
    /** Why the performance has it, for `@cause`: `added-octave`, `ornamentation`, `substitution`, … */
    cause: string;
    /** How sure the placement is, in [0, 1] */
    confidence: number;
}

/** Everything that happens to one written event. */
export interface EventEdit {
    event: ScoreEvent;
    /** Played notes that join it */
    add: NewNote[];
    /** Written notes of it that were not played */
    remove: WrittenNote[];
    /** Written notes of it played at another pitch */
    replace: Map<WrittenNote, NewNote>;
    /** Grace notes that lean on it, each inner list one moment, in the order they sounded */
    graces: NewNote[][];
    /** Played moments written into its time: struck while it sounded, or while it was silent */
    inside: OwnPlace[];
}

/** A played moment written at a place of its own. */
export interface OwnPlace {
    /** Grid units from the barline */
    start: number;
    value: NoteValue;
    notes: NewNote[];
    graces: NewNote[][];
}

export interface StaffAddition {
    staff: StaffModel;
    places: OwnPlace[];
}

export interface SignEdit {
    anchor: WrittenNote;
    sign: FigureSign;
    group: string;
    confidence: number;
}

/** A tie the score writes and the performer did not hold: the second note was struck. */
export interface UntieEdit {
    tie: Element;
    group: string;
    confidence: number;
}

/** A tie the score does not write: a note held on into the next of its pitch, not struck again. */
export interface TieEdit {
    from: WrittenNote;
    to: WrittenNote;
    group: string;
}

export interface Edits {
    events: EventEdit[];
    staves: StaffAddition[];
    signs: SignEdit[];
    unties: UntieEdit[];
    ties: TieEdit[];
}

interface Attribution {
    /** Who answers for the reading, for `@resp` */
    resp?: string;
}

/** `high` from four in five, `medium` from one in two: what `@cert` can say. */
const certaintyOf = (confidence: number): string =>
    confidence >= 0.8 ? "high" : confidence >= 0.5 ? "medium" : "low";

/** Attributes a `<chord>` carries for its notes, moved up when a note becomes one. */
const EVENT_ATTRIBUTES = [
    "dur", "dots", "dur.ges", "dots.ges", "dur.ppq", "grace", "grace.time", "stem.dir",
    "stem.len", "stem.mod", "cue", "tuplet", "beam", "breaksec",
];

/**
 * Carry the edits out.
 *
 * Returns the ids of the notes actually written, by divergence, which is not always all of
 * them: a note whose staff or event could not be found again is left out rather than guessed.
 */
export function applyEdits(
    model: ScoreModel,
    edits: Edits,
    attribution: Attribution = {},
): Map<string, string[]> {
    const { doc } = model;
    const written = new Map<string, string[]>();
    const record = (note: NewNote) => {
        const list = written.get(note.group);
        if (list) list.push(note.id);
        else written.set(note.group, [note.id]);
    };
    const notation = planNotation(edits);

    /** An `<app>` with both readings, the performance one attributed. */
    const appFor = (notes: readonly { cause: string; confidence: number }[], fallback: string) => {
        const app = doc.createElementNS(MEI_NS, "app");
        app.setAttribute("type", TRANSCRIPTION);

        const original = doc.createElementNS(MEI_NS, "rdg");
        original.setAttribute("source", "original");
        app.appendChild(original);

        const performance = doc.createElementNS(MEI_NS, "rdg");
        performance.setAttribute("source", "performance");
        performance.setAttribute("cause", notes[0]?.cause ?? fallback);
        if (attribution.resp) performance.setAttribute("resp", attribution.resp);
        const least = notes.reduce((min, note) => Math.min(min, note.confidence), 1);
        performance.setAttribute("cert", certaintyOf(notes.length > 0 ? least : 1));
        app.appendChild(performance);

        return { app, original, performance };
    };

    /** A `<note>` for a played note, spelled, with no length of its own. */
    const noteFor = (note: NewNote): Element => {
        const element = doc.createElementNS(MEI_NS, "note");
        const how = notation.get(note);
        element.setAttribute("xml:id", note.id);
        element.setAttribute("pname", note.spelling.pname);
        element.setAttribute("oct", String(how?.oct ?? note.spelling.oct));
        if (how && how.oct !== note.spelling.oct) element.setAttribute("oct.ges", String(note.spelling.oct));
        if (how?.accid) element.setAttribute("accid", how.accid);
        else element.setAttribute("accid.ges", accidentalOf(note.spelling.alter));
        record(note);
        return element;
    };

    /** A grace moment: one note, or a chord of them. */
    const graceFor = (moment: NewNote[]): Element => {
        const notes = moment.map((note) => noteFor(note));
        const element = notes.length === 1 ? notes[0] : doc.createElementNS(MEI_NS, "chord");
        if (notes.length > 1) notes.forEach((note) => element.appendChild(note));
        element.setAttribute("grace", "unacc");
        element.setAttribute("dur", "8");
        return element;
    };

    /** The notes of an event's element, the one it is or the ones it holds. */
    const notesOf = (element: Element): Element[] =>
        element.localName === "note" ? [element] : [...element.querySelectorAll("note")];

    /**
     * An event as it was played, in one piece: what was not played gone from it, what was played
     * otherwise changed, what joined it added. Undefined where nothing of it sounded.
     *
     * Only for an event that is written again whole, which one that a note was played during
     * is. Everywhere else the changes are readings inside the event, so that nothing is said twice.
     */
    const asPlayed = (edit: EventEdit): Element | undefined => {
        const { event } = edit;
        if (event.notes.length === 0) return undefined;
        const source = event.element;
        const removed = new Set(edit.remove.filter((note) => !edit.replace.has(note)));

        if (source.localName !== "chord") {
            const only = event.notes[0];
            const replacement = edit.replace.get(only);
            const [first, ...others] = edit.add;
            const unplayed = removed.has(only);
            if (unplayed && !first) return undefined;

            const kept = replacement
                ? substituteFor(only, noteFor(replacement))
                : unplayed
                  ? substituteFor(only, noteFor(first))
                  : (source.cloneNode(true) as Element);
            const joining = unplayed && !replacement ? others : edit.add;
            if (joining.length === 0) return kept;

            const chord = doc.createElementNS(MEI_NS, "chord");
            for (const attribute of EVENT_ATTRIBUTES) {
                const value = kept.getAttribute(attribute);
                if (value === null) continue;
                chord.setAttribute(attribute, value);
                kept.removeAttribute(attribute);
            }
            chord.appendChild(kept);
            for (const note of joining) chord.appendChild(noteFor(note));
            return chord;
        }

        const chord = source.cloneNode(true) as Element;
        const written = notesOf(source);
        const copies = notesOf(chord);
        const copyOf = (note: WrittenNote): Element | undefined => copies[written.indexOf(note.element)];
        for (const note of removed) copyOf(note)?.remove();
        for (const [note, played] of edit.replace) {
            const copy = copyOf(note);
            copy?.parentNode?.replaceChild(substituteFor(note, noteFor(played)), copy);
        }
        for (const note of edit.add) chord.appendChild(noteFor(note));
        return notesOf(chord).length > 0 ? chord : undefined;
    };

    /**
     * A note held on from the piece of it before: the same notes under names of their own, with
     * nothing on them that belongs to the moment a note is struck.
     */
    const heldOn = (played: Element, count: number): Element => {
        const held = played.cloneNode(true) as Element;
        for (const named of [held, ...held.querySelectorAll("*")]) {
            const id = named.getAttribute("xml:id");
            if (id) named.setAttribute("xml:id", `${id}-held${count > 1 ? String(count) : ""}`);
        }
        for (const note of notesOf(held)) {
            // What it sounds as is said once, where it is struck
            const accidental = writtenAccidental(note);
            if (accidental !== undefined && !note.hasAttribute("accid.ges")) note.setAttribute("accid.ges", accidental);
            note.removeAttribute("accid");
            for (const child of [...note.children]) child.remove();
        }
        for (const child of [...held.children]) {
            if (child.localName === "artic" || child.localName === "accid" || child.localName === "verse") child.remove();
        }
        for (const attribute of ["artic", "fermata", "ornam", "grace", "grace.time", "slur", "tie"]) {
            held.removeAttribute(attribute);
        }
        return held;
    };

    /**
     * Write an event again around the moments played during it.
     *
     * The source's event goes into the original reading as it stands. The performance reading has
     * the event as it was played, as long as it took to get to the first of the moments, and then
     * each moment for its length: together exactly the time the event took.
     */
    const writeInside = (edit: EventEdit): void => {
        const { event } = edit;
        const element = event.element;
        const parent = element.parentElement;
        const span = hostSpan(event);
        if (!parent || !span) return;

        const measure = event.layer.staff.measure;
        const pieces = splitHost(
            span,
            edit.inside.map((place) => ({ start: place.start, value: place.value, payload: place })),
            measure,
        );
        if (!pieces) return;

        const played = asPlayed(edit);
        // What the voice has where it has no note: a rest where the score draws its silence,
        // and where it does not, or where a note was sounding, time that draws nothing
        const silence = element.localName === "space" || element.localName === "mSpace" ? "space" : "rest";
        const inserted = edit.inside.flatMap((place) => [...place.notes, ...place.graces.flat()]);
        const { app, original, performance } = appFor(
            [...inserted, ...edit.add, ...edit.replace.values()],
            "added-note",
        );
        parent.insertBefore(app, element);
        original.appendChild(element);

        const chain: Element[] = [];
        const build = (list: HostPiece<OwnPlace>[], into: Element) => {
            for (const piece of list) {
                if (piece.kind === "tuplet") {
                    const tuplet = doc.createElementNS(MEI_NS, "tuplet");
                    tuplet.setAttribute("num", "3");
                    tuplet.setAttribute("numbase", "2");
                    build(piece.pieces, tuplet);
                    into.appendChild(tuplet);
                } else if (piece.kind === "item") {
                    const place = piece.item.payload;
                    for (const moment of place.graces) into.appendChild(graceFor(moment));
                    const notes = place.notes.map((note) => noteFor(note));
                    const sounding = notes.length === 1 ? notes[0] : doc.createElementNS(MEI_NS, "chord");
                    if (notes.length > 1) notes.forEach((note) => sounding.appendChild(note));
                    into.appendChild(valued(sounding, piece.value));
                } else if (piece.kind === "gap" || !played) {
                    const quiet = doc.createElementNS(MEI_NS, played ? "space" : silence);
                    into.appendChild(valued(quiet, piece.value));
                } else {
                    const held = chain.length === 0 ? played : heldOn(played, chain.length);
                    chain.push(held);
                    into.appendChild(resized(held, piece.value));
                }
            }
        };
        build(pieces, performance);

        // Where its new length is no one note value it is tied values, and a tie is a line in
        // the measure: a reading of its own, beside the one the notes are in
        if (chain.length > 1) {
            const { app: lines, performance: ties } = appFor(inserted, "added-note");
            for (let index = 1; index < chain.length; index++) {
                const before = notesOf(chain[index - 1]);
                notesOf(chain[index]).forEach((note, at) => {
                    const from = before[at]?.getAttribute("xml:id");
                    const to = note.getAttribute("xml:id");
                    if (!from || !to) return;
                    const tie = doc.createElementNS(MEI_NS, "tie");
                    tie.setAttribute("startid", `#${from}`);
                    tie.setAttribute("endid", `#${to}`);
                    ties.appendChild(tie);
                });
            }
            measure.element.appendChild(lines);
        }
    };

    // The events first: what joins, leaves or changes inside the notation there is
    for (const edit of [...edits.events].sort((a, b) => a.event.onset - b.event.onset)) {
        const { event } = edit;
        const element = event.element;
        const parent = element.parentElement;
        if (!parent) continue;

        if (edit.graces.length > 0) {
            const { app, performance } = appFor(edit.graces.flat(), "ornamentation");
            for (const moment of edit.graces) performance.appendChild(graceFor(moment));
            const before = outsideItsBeam(element);
            before.parentElement?.insertBefore(app, before);
        }

        if (edit.inside.length > 0) {
            writeInside(edit);
            continue;
        }

        const removed = new Set(edit.remove);
        const staying = event.notes.filter((note) => !removed.has(note));
        const sounding = staying.length + edit.add.length;

        if (edit.remove.length === 0 && edit.add.length === 0 && edit.replace.size === 0) continue;

        if (sounding === 0) {
            // Nothing of it was played: the reading is its length in silence
            const { app, original, performance } = appFor([], "simplification");
            parent.insertBefore(app, element);
            original.appendChild(element);
            if (!event.grace) performance.appendChild(restLike(doc, element));
            continue;
        }

        if (element.localName === "chord") {
            for (const note of edit.remove) {
                const { app, original } = appFor([], "simplification");
                note.element.parentElement?.insertBefore(app, note.element);
                original.appendChild(note.element);
            }
            for (const [note, played] of edit.replace) {
                const { app, original, performance } = appFor([played], "substitution");
                note.element.parentElement?.insertBefore(app, note.element);
                original.appendChild(note.element);
                performance.appendChild(substituteFor(note, noteFor(played)));
            }
            if (edit.add.length > 0) {
                const { app, performance } = appFor(edit.add, "fuller-chord");
                for (const note of edit.add) performance.appendChild(noteFor(note));
                element.appendChild(app);
            }
            continue;
        }

        // A single written note. Played at another pitch it stays a note; joined by another
        // it becomes a chord, which is the one place the written note has to be said twice
        const only = event.notes[0];
        const replacement = edit.replace.get(only);
        const unplayed = removed.has(only);
        const { app, original, performance } = appFor(
            [...(replacement ? [replacement] : []), ...edit.add],
            replacement || unplayed ? "substitution" : "fuller-chord",
        );
        parent.insertBefore(app, element);
        original.appendChild(element);

        // Not played, with something else struck in its place: what was struck takes its
        // length and its stem, exactly as a note played at another pitch does
        const [first, ...others] = edit.add;
        const kept = replacement
            ? substituteFor(only, noteFor(replacement))
            : unplayed
              ? substituteFor(only, noteFor(first))
              : (element.cloneNode(true) as Element);
        const joining = unplayed && !replacement ? others : edit.add;

        if (joining.length === 0) {
            performance.appendChild(kept);
            continue;
        }

        const chord = doc.createElementNS(MEI_NS, "chord");
        for (const attribute of EVENT_ATTRIBUTES) {
            const value = kept.getAttribute(attribute);
            if (value === null) continue;
            chord.setAttribute(attribute, value);
            kept.removeAttribute(attribute);
        }
        chord.appendChild(kept);
        for (const note of joining) chord.appendChild(noteFor(note));
        performance.appendChild(chord);
    }

    // The voice the added notes go into is the same one all through the piece: the first
    // number no layer of that staff uses anywhere. Numbered bar by bar instead it would be
    // voice 2 where the bar has one voice and voice 3 where it has two, and a reader sorting
    // voices into parts would find the performer's additions scattered among the composer's.
    const highestLayer = new Map<string, number>();
    for (const measure of model.measures) {
        for (const staff of measure.staves) {
            for (const layer of staff.layers) {
                highestLayer.set(staff.n, Math.max(highestLayer.get(staff.n) ?? 0, Number(layer.n) || 0));
            }
        }
    }

    // Then the places of their own that no voice of the staff could take, a layer at a time
    for (const addition of edits.staves) {
        const { staff } = addition;
        const measure = staff.measure;

        const layers = packLayers(addition.places, measure);
        let n = highestLayer.get(staff.n) ?? 0;

        for (const places of layers) {
            const { app, performance } = appFor(
                places.flatMap((place) => [...place.notes, ...place.graces.flat()]),
                "added-note",
            );
            const layer = doc.createElementNS(MEI_NS, "layer");
            layer.setAttribute("n", String(++n));

            const items: LayerItem<OwnPlace>[] = places.map((place) => ({
                start: place.start,
                value: place.value,
                payload: place,
            }));

            const build = (pieces: LayerPiece<OwnPlace>[], into: Element) => {
                for (const piece of pieces) {
                    if (piece.kind === "tuplet") {
                        const tuplet = doc.createElementNS(MEI_NS, "tuplet");
                        tuplet.setAttribute("num", "3");
                        tuplet.setAttribute("numbase", "2");
                        build(piece.pieces, tuplet);
                        into.appendChild(tuplet);
                        continue;
                    }
                    if (piece.kind === "space") {
                        into.appendChild(valued(doc.createElementNS(MEI_NS, "space"), piece.value));
                        continue;
                    }

                    const place = piece.item.payload;
                    for (const moment of place.graces) into.appendChild(graceFor(moment));
                    const notes = place.notes.map((note) => noteFor(note));
                    const sounding = notes.length === 1 ? notes[0] : doc.createElementNS(MEI_NS, "chord");
                    if (notes.length > 1) notes.forEach((note) => sounding.appendChild(note));
                    into.appendChild(valued(sounding, piece.value));
                }
            };
            build(layOut(items, measure), layer);

            performance.appendChild(layer);
            staff.element.appendChild(app);
        }
    }

    for (const edit of edits.signs) {
        const measure = edit.anchor.event.layer.staff.measure.element;
        const { app, performance } = appFor([{ cause: "ornamentation", confidence: edit.confidence }], "ornamentation");
        const sign = doc.createElementNS(MEI_NS, edit.sign.name);
        sign.setAttribute("startid", `#${edit.anchor.id}`);
        if (edit.sign.name === "mordent") sign.setAttribute("form", edit.sign.form);
        performance.appendChild(sign);
        measure.appendChild(app);
    }

    // A tie is a line between two notes and not a note, so a tie that was not held and a tie
    // that was not written are both a reading of the line alone. The notes stand as they are.
    for (const edit of edits.unties) {
        const parent = edit.tie.parentElement;
        if (!parent) continue;
        const { app, original } = appFor([{ cause: "struck-again", confidence: edit.confidence }], "struck-again");
        parent.insertBefore(app, edit.tie);
        original.appendChild(edit.tie);
    }
    for (const edit of edits.ties) {
        const measure = edit.from.event.layer.staff.measure.element;
        const { app, performance } = appFor([{ cause: "held", confidence: 1 }], "held");
        const tie = doc.createElementNS(MEI_NS, "tie");
        tie.setAttribute("startid", `#${edit.from.id}`);
        tie.setAttribute("endid", `#${edit.to.id}`);
        performance.appendChild(tie);
        measure.appendChild(app);
    }

    nameReadings(doc);
    return written;
}

/**
 * Give every reading a name, said by what it holds: the first note written into it, or else the
 * first note of the source it changes, or else the line it draws or takes away.
 *
 * By what it holds and not by a count, so that transcribing the same differences again names
 * the same readings, and a decision recorded against one still finds it.
 */
function nameReadings(doc: Document): void {
    const taken = new Set<string>();
    const idOf = (element: Element) => element.getAttribute("xml:id") ?? undefined;

    for (const app of doc.querySelectorAll(`app[type~="${TRANSCRIPTION}"]`)) {
        const inside = [...app.querySelectorAll("*")];
        const line = inside.find((element) => element.hasAttribute("startid"));
        const about =
            inside.map(idOf).find((id) => id?.startsWith("played-")) ??
            inside.map(idOf).find((id) => id !== undefined) ??
            (line ? `${line.localName}-${(line.getAttribute("startid") ?? "").replace(/^#/, "")}` : undefined) ??
            "empty";

        let id = `reading-${about}`;
        for (let count = 2; taken.has(id); count++) id = `reading-${about}-${String(count)}`;
        taken.add(id);
        app.setAttribute("xml:id", id);
    }
}

/** The names of the readings a transcription wrote into a score, in the order they stand. */
export function readingsOf(doc: Document): string[] {
    return [...doc.querySelectorAll(`app[type~="${TRANSCRIPTION}"]`)].flatMap((app) => {
        const id = app.getAttribute("xml:id");
        return id ? [id] : [];
    });
}

/**
 * What a grace note is written in front of, so that it is not beamed to the note it leans on.
 *
 * A grace note goes directly before its note. Where that note opens a beam, directly before it
 * is the first place inside the beam, and a beam takes in whatever it begins with: the grace
 * note would hang from the beam of the notes it ornaments. So it goes in front of the beam, the
 * outermost one the note opens, through any tuplet on the way. In the middle of a beam it stays
 * where it is: a grace note between beamed notes is left out of their beam as it stands.
 */
function outsideItsBeam(element: Element): Element {
    let before = element;
    let at = element;
    for (
        let parent = at.parentElement;
        parent && (parent.localName === "beam" || parent.localName === "tuplet") && parent.firstElementChild === at;
        parent = at.parentElement
    ) {
        at = parent;
        if (parent.localName === "beam") before = parent;
    }
    return before;
}

/** Write a note value onto an element. */
function valued(element: Element, value: NoteValue): Element {
    element.setAttribute("dur", value.dur);
    if (value.dots > 0) element.setAttribute("dots", String(value.dots));
    return element;
}

/** Write a note value onto an event that had another, leaving nothing of the old one behind. */
function resized(element: Element, value: NoteValue): Element {
    for (const holder of [element, ...element.querySelectorAll("note")]) {
        for (const attribute of ["dur", "dots", "dur.ges", "dots.ges", "dur.ppq"]) holder.removeAttribute(attribute);
    }
    for (const dot of [...element.querySelectorAll("dot")]) dot.remove();
    return valued(element, value);
}

/** A rest as long as an event, by the event's own account of how long that is. */
function restLike(doc: Document, event: Element): Element {
    const rest = doc.createElementNS(MEI_NS, "rest");
    const source =
        event.hasAttribute("dur") || event.localName !== "chord"
            ? event
            : [...event.children].find((child) => child.hasAttribute("dur")) ?? event;
    for (const attribute of ["dur", "dots", "dur.ges", "dots.ges", "dur.ppq"]) {
        const value = source.getAttribute(attribute);
        if (value !== null) rest.setAttribute(attribute, value);
    }
    if (!rest.hasAttribute("dur")) rest.setAttribute("dur", "4");
    return rest;
}

/**
 * The played note standing where a written one stood: the written note's length, stem and
 * articulation, the played note's pitch and name.
 */
function substituteFor(written: WrittenNote, played: Element): Element {
    for (const attribute of written.element.attributes) {
        if (played.hasAttribute(attribute.name)) continue;
        if (["pname", "oct", "accid", "accid.ges", "oct.ges", "pnum", "pname.ges", "xml:id"].includes(attribute.name)) continue;
        played.setAttribute(attribute.name, attribute.value);
    }
    for (const child of written.element.children) {
        if (child.localName !== "accid") played.appendChild(child.cloneNode(true));
    }
    return played;
}

/**
 * Sort places into as few layers as hold them.
 *
 * Moments at one place and of one length are one chord. The rest go into the first layer they
 * fit beside what is already in it, and a new one when they fit none.
 */
function packLayers(places: readonly OwnPlace[], measure: MeasureModel): OwnPlace[][] {
    const merged: OwnPlace[] = [];
    for (const place of [...places].sort((a, b) => a.start - b.start || b.value.units - a.value.units)) {
        const same = merged.find(
            (other) => other.start === place.start && other.value.units === place.value.units,
        );
        if (same) {
            same.notes.push(...place.notes);
            same.graces.push(...place.graces);
        } else {
            merged.push({ ...place, notes: [...place.notes], graces: [...place.graces] });
        }
    }

    const layers: OwnPlace[][] = [];
    for (const place of merged) {
        const item = { start: place.start, value: place.value, payload: place };
        const home = layers.find((layer) => fits(layer, item, measure));
        if (home) home.push(place);
        else layers.push([place]);
    }
    return layers;
}

const fits = (layer: OwnPlace[], item: LayerItem<OwnPlace>, measure: MeasureModel): boolean =>
    fitsLayer(
        layer.map((place) => ({ start: place.start, value: place.value, payload: place })),
        item,
        measure,
    );

/** How one new note is written: its octave on the page, and its accidental if it prints one. */
interface NoteNotation {
    /** The octave it is written in, which an ottava moves away from the one it sounds in */
    oct: number;
    /** The accidental printed on it; absent where the notation has already said it */
    accid?: string;
}

/**
 * Work out what every new note prints, and keep the notes around them meaning what they meant.
 *
 * An accidental holds to the end of its bar, on its line, for every voice of the staff. So what
 * a note prints depends on everything written on that line before it, and what it prints
 * changes everything after it. Three things can therefore go wrong when a reading changes the
 * notes of a bar, and one pass over each line settles all of them:
 *
 *   a new note needs an accidental the bar has not yet said, and gets it;
 *   a new note carries one that would change a written note after it, which the performer
 *     played as written, so that note has its own accidental restated;
 *   a written note with an accidental was not played, and the note after it that relied on
 *     that accidental has it restated too.
 *
 * A restated accidental is one the source does not print. It says nothing the source does not
 * mean, it is marked, and {@link revertTranscription} takes it off again.
 */
function planNotation(edits: Edits): Map<NewNote, NoteNotation> {
    const plan = new Map<NewNote, NoteNotation>();

    interface Arrival { note: NewNote; staff: StaffModel; onset: number; like?: WrittenNote }
    const arrivals: Arrival[] = [];
    const gone = new Set<WrittenNote>();

    for (const edit of edits.events) {
        const staff = edit.event.layer.staff;
        const like = edit.event.notes[0];
        edit.graces.flat().forEach((note, index) => arrivals.push({ note, staff, onset: edit.event.onset - 1e-6 * (edit.graces.flat().length - index), like }));
        for (const note of [...edit.add, ...edit.replace.values()]) arrivals.push({ note, staff, onset: edit.event.onset, like });
        for (const note of [...edit.remove, ...edit.replace.keys()]) gone.add(note);

        const near = like ?? staff.layers.flatMap((layer) => layer.events).find((event) => event.notes.length > 0)?.notes[0];
        for (const place of edit.inside) {
            const onset = staff.measure.onset + place.start / UNITS;
            place.graces.flat().forEach((note, index) => arrivals.push({ note, staff, onset: onset - 1e-6 * (place.graces.flat().length - index), like: near }));
            for (const note of place.notes) arrivals.push({ note, staff, onset, like: near });
        }
    }
    for (const addition of edits.staves) {
        const { staff } = addition;
        const like = staff.layers.flatMap((layer) => layer.events).find((event) => event.notes.length > 0)?.notes[0];
        for (const place of addition.places) {
            const onset = staff.measure.onset + place.start / UNITS;
            place.graces.flat().forEach((note, index) => arrivals.push({ note, staff, onset: onset - 1e-6 * (place.graces.flat().length - index), like }));
            for (const note of place.notes) arrivals.push({ note, staff, onset, like });
        }
    }

    // By bar and staff number, since an accidental holds across the voices of a staff
    const touched = new Map<string, { measure: MeasureModel; n: string }>();
    const keyOf = (measure: MeasureModel, n: string) => `${String(measure.index)}|${n}`;
    for (const arrival of arrivals) touched.set(keyOf(arrival.staff.measure, arrival.staff.n), { measure: arrival.staff.measure, n: arrival.staff.n });
    for (const note of gone) {
        const staff = note.event.layer.staff;
        touched.set(keyOf(staff.measure, staff.n), { measure: staff.measure, n: staff.n });
    }

    for (const [key, { measure, n }] of touched) {
        type Entry =
            | { onset: number; line: string; alter: number; written: WrittenNote }
            | { onset: number; line: string; alter: number; arrival: Arrival; oct: number };
        const entries: Entry[] = [];
        let signature: ReadonlyMap<string, string> = new Map();

        for (const staff of measure.staves) {
            if (staff.n !== n) continue;
            signature = staff.key;
            for (const layer of staff.layers) {
                for (const event of layer.events) {
                    for (const note of event.notes) {
                        if (gone.has(note)) continue;
                        entries.push({ onset: event.onset - (event.grace ? 1e-6 : 0), line: `${note.pname}${String(note.oct)}`, alter: note.alter, written: note });
                    }
                }
            }
        }
        for (const arrival of arrivals) {
            if (keyOf(arrival.staff.measure, arrival.staff.n) !== key) continue;
            // Under an ottava the page writes an octave away from the sound, and a note added
            // there is written the way its neighbours are
            const shift = arrival.like ? arrival.like.sounding - arrival.like.oct : 0;
            const oct = arrival.note.spelling.oct - shift;
            entries.push({ onset: arrival.onset, line: `${arrival.note.spelling.pname}${String(oct)}`, alter: arrival.note.spelling.alter, arrival, oct });
        }

        // In the order they sound; at one moment, what is written before what is new
        entries.sort((a, b) => a.onset - b.onset || ("written" in a ? 0 : 1) - ("written" in b ? 0 : 1));

        const standing = new Map<string, number>();
        for (const entry of entries) {
            const pname = entry.line[0];
            const fromKey = signature.get(pname);
            const state = standing.get(entry.line) ?? (fromKey === "s" ? 1 : fromKey === "f" ? -1 : 0);

            if ("written" in entry) {
                const element = entry.written.element;
                if (writtenAccidental(element) !== undefined) {
                    standing.set(entry.line, entry.alter);
                } else if (state !== entry.alter && ownAccidental(element) === undefined) {
                    // It relied on an accidental the reading has changed or taken away
                    element.setAttribute("accid", accidentalOf(entry.alter));
                    const type = element.getAttribute("type");
                    element.setAttribute("type", type ? `${type} ${PINNED}` : PINNED);
                    standing.set(entry.line, entry.alter);
                }
                continue;
            }

            if (state !== entry.alter) {
                plan.set(entry.arrival.note, { oct: entry.oct, accid: accidentalOf(entry.alter) });
                standing.set(entry.line, entry.alter);
            } else {
                plan.set(entry.arrival.note, { oct: entry.oct });
            }
        }
    }

    return plan;
}

/** The accidental a note has printed on it, which is the kind that holds for the bar. */
function writtenAccidental(note: Element): string | undefined {
    const attribute = note.getAttribute("accid");
    if (attribute !== null) return attribute;
    for (const child of note.children) {
        if (child.localName === "accid" && child.hasAttribute("accid")) return child.getAttribute("accid") ?? undefined;
    }
    return undefined;
}

/**
 * Take every reading written here out again, leaving the score as its source has it.
 *
 * The inverse of {@link applyEdits}, and what lets a reader change their mind: the document is
 * taken back to the source and transcribed again with the new decision, rather than patched.
 * Readings somebody made by hand carry no mark and are left alone.
 */
export function revertTranscription(doc: Document): void {
    for (const app of [...doc.querySelectorAll(`app[type="${TRANSCRIPTION}"]`)]) {
        const parent = app.parentNode;
        if (!parent) continue;
        const original = [...app.children].find(
            (child) => child.localName === "rdg" && child.getAttribute("source") === "original",
        );
        for (const child of original ? [...original.childNodes] : []) parent.insertBefore(child, app);
        parent.removeChild(app);
    }

    for (const note of [...doc.querySelectorAll(`[type~="${PINNED}"]`)]) {
        note.removeAttribute("accid");
        const rest = (note.getAttribute("type") ?? "").split(/\s+/).filter((token) => token && token !== PINNED);
        if (rest.length > 0) note.setAttribute("type", rest.join(" "));
        else note.removeAttribute("type");
    }
}
