/**
 * Writing a decision about a divergence back into the notation.
 *
 * Recording that a note was played is one thing, and ../alignment/applyAlignment
 * does it; saying that the score should have had it is another, and it is an
 * editorial act. So everything here keeps the original reading intact and adds
 * the performance's as an alternative, in the terms the project already uses:
 * an <app> holding the score's own <rdg source="original"> beside an
 * <rdg source="performance"> whose <supplied> carries who decided and how sure
 * they were. That is the same vocabulary ../ui/CreateReading offers by hand -
 * this only builds it from an alignment instead of from a text selection.
 *
 * Two of the readings deliberately write nothing at all. A `written-ornament` is
 * the score being played as it stands, and an `outside` note is not about the
 * music; treating either as an emendation would put something in the edition
 * that nobody meant.
 */

import type { NoteSpan } from "../performance/midiSpans";
import { spellMidi } from "../performance/spellPitch";

const MEI_NS = "http://www.music-encoding.org/ns/mei";

export interface Attribution {
    /** Who made the decision, for @resp */
    resp?: string;
    /** How sure they are: high, medium, low, unknown */
    certainty?: string;
    /** A sentence about the decision, kept as an <annot> */
    note?: string;
}

/** The reasons an <rdg source="performance"> may give, as CreateReading names them. */
export type ReadingReason =
    | "added-octave"
    | "fuller-chord"
    | "ornamentation"
    | "simplification"
    | "rythmic-alteration"
    | "substitution"
    | "unknown";

/**
 * Add notes the performer played to the score, as a performance reading.
 *
 * The new notes take the played notes' own ids, which is what lets the next
 * alignment match them: the id in the MEI and the id of the MIDI span are the
 * same string. `../ui/CodeEditor` does this by hand for a selection; the same
 * convention holds here.
 *
 * The notes are put beside the note they were played against rather than in
 * place of it - an added octave doubles a written note, it does not replace it -
 * so the anchor is wrapped in an <app> and the reading holds anchor and
 * additions together.
 */
export function addPlayedNotes(
    doc: Document,
    anchorId: string,
    spans: readonly NoteSpan[],
    reason: ReadingReason,
    tonic: string,
    attribution: Attribution = {}
): boolean {
    const anchor = doc.querySelector(`[*|id="${cssEscape(anchorId)}"]`);
    if (!anchor?.parentElement) return false;

    const app = doc.createElementNS(MEI_NS, "app");
    anchor.parentElement.insertBefore(app, anchor);

    const original = doc.createElementNS(MEI_NS, "rdg");
    original.setAttribute("source", "original");
    app.appendChild(original);
    original.appendChild(anchor);

    const performance = doc.createElementNS(MEI_NS, "rdg");
    performance.setAttribute("source", "performance");
    performance.setAttribute("reason", reason);
    app.appendChild(performance);

    const supplied = suppliedFor(doc, attribution);
    performance.appendChild(supplied);

    // The written note is played too, so the reading holds it as well as the rest
    supplied.appendChild(anchor.cloneNode(true));
    for (const span of spans) supplied.appendChild(noteFor(doc, span, tonic, anchor));

    return true;
}

/**
 * Record that notes the score writes were not played, as a simplification.
 *
 * The notes stay where they are, inside an <rdg source="original">; the
 * performance reading is the passage without them. Nothing is deleted - an
 * edition that quietly dropped what a performer skipped would no longer be an
 * edition of the piece.
 */
export function markUnplayed(
    doc: Document,
    scoreIds: readonly string[],
    attribution: Attribution = {}
): boolean {
    const notes = scoreIds
        .map((id) => doc.querySelector(`[*|id="${cssEscape(id)}"]`))
        .filter((note): note is Element => note !== null);
    if (notes.length === 0) return false;

    const parent = notes[0].parentElement;
    if (!parent || notes.some((note) => note.parentElement !== parent)) {
        // Notes from different places are not one passage, so they are marked
        // one at a time instead
        return notes.every((note) => markUnplayed(doc, [idOf(note)], attribution));
    }

    const app = doc.createElementNS(MEI_NS, "app");
    parent.insertBefore(app, notes[0]);

    const original = doc.createElementNS(MEI_NS, "rdg");
    original.setAttribute("source", "original");
    app.appendChild(original);
    for (const note of notes) original.appendChild(note);

    const performance = doc.createElementNS(MEI_NS, "rdg");
    performance.setAttribute("source", "performance");
    performance.setAttribute("reason", "simplification");
    app.appendChild(performance);
    performance.appendChild(suppliedFor(doc, attribution));

    return true;
}

/**
 * Record that a written note was played as a different note.
 *
 * The classic use of an <app>, and the only edit here where the performance
 * reading genuinely *replaces* the original rather than adding to it: the score
 * says one note, the recording another, at the same moment. Both stay, each in
 * its own <rdg>, and nothing chooses between them - which of the two an edition
 * prints is not something an alignment gets to decide.
 *
 * The new note keeps the played span's id, so that aligning the edited score
 * again matches it instead of turning it up as an addition all over again.
 */
export function replaceWithPlayed(
    doc: Document,
    scoreId: string,
    span: NoteSpan,
    tonic: string,
    attribution: Attribution = {}
): boolean {
    const written = doc.querySelector(`[*|id="${cssEscape(scoreId)}"]`);
    if (!written?.parentElement) return false;

    const app = doc.createElementNS(MEI_NS, "app");
    written.parentElement.insertBefore(app, written);

    const original = doc.createElementNS(MEI_NS, "rdg");
    original.setAttribute("source", "original");
    app.appendChild(original);
    original.appendChild(written);

    const performance = doc.createElementNS(MEI_NS, "rdg");
    performance.setAttribute("source", "performance");
    performance.setAttribute("reason", "substitution");
    app.appendChild(performance);

    const supplied = suppliedFor(doc, attribution);
    performance.appendChild(supplied);
    supplied.appendChild(noteFor(doc, span, tonic, written));

    return true;
}

/**
 * Put an ornament sign on a note the performer decorated but the score does not.
 *
 * This is the one edit that adds notation rather than an alternative reading, so
 * it is kept to the sign itself: what the performer actually played stays in the
 * <recording> as the realisation, which is where a performance belongs. The sign
 * says the note is ornamented; the recording says how it was, that time.
 */
export function addOrnamentSign(
    doc: Document,
    anchorId: string,
    name: "trill" | "mordent" | "turn",
    attribution: Attribution = {}
): boolean {
    const anchor = doc.querySelector(`[*|id="${cssEscape(anchorId)}"]`);
    const measure = anchor?.closest("measure");
    if (!anchor || !measure) return false;

    const sign = doc.createElementNS(MEI_NS, name);
    sign.setAttribute("startid", "#" + anchorId);
    if (attribution.resp) sign.setAttribute("resp", attribution.resp);
    if (attribution.certainty) sign.setAttribute("cert", attribution.certainty);
    measure.appendChild(sign);

    return true;
}

/** The <supplied> that carries who decided and how sure they were. */
function suppliedFor(doc: Document, attribution: Attribution): Element {
    const supplied = doc.createElementNS(MEI_NS, "supplied");
    if (attribution.resp) supplied.setAttribute("resp", attribution.resp);
    if (attribution.certainty) supplied.setAttribute("certainty", attribution.certainty);

    if (attribution.note) {
        const annot = doc.createElementNS(MEI_NS, "annot");
        annot.textContent = attribution.note;
        supplied.appendChild(annot);
    }

    return supplied;
}

/**
 * One played note as MEI.
 *
 * It keeps the span's own id so the next alignment can match it, and it is
 * spelled in the key rather than written with a fixed accidental, so that an
 * added note in D flat is not drawn as a C sharp.
 *
 * Its rhythm is taken from the written note it stands with, because that is the
 * only thing that can supply one: a MIDI span knows how long a key was held,
 * which is not what `@dur` means. A note with no duration at all would leave the
 * measure it lands in unengravable.
 */
function noteFor(doc: Document, span: NoteSpan, tonic: string, like?: Element): Element {
    const note = doc.createElementNS(MEI_NS, "note");
    const parsed = spellMidi(span.pitch, tonic).name.match(/^([A-G])([#b]*)(-?\d+)$/);

    if (parsed) {
        note.setAttribute("pname", parsed[1].toLowerCase());
        note.setAttribute("oct", parsed[3]);
        if (parsed[2]) note.setAttribute("accid", parsed[2] === "#" ? "s" : parsed[2] === "b" ? "f" : parsed[2]);
    }

    for (const attribute of ["dur", "dots", "staff", "layer"]) {
        const value = like?.getAttribute(attribute);
        if (value) note.setAttribute(attribute, value);
    }

    note.setAttribute("xml:id", span.id);
    return note;
}

function idOf(element: Element): string {
    return element.getAttribute("xml:id") ?? "";
}

function cssEscape(value: string): string {
    return typeof CSS?.escape === "function" ? CSS.escape(value) : value;
}
