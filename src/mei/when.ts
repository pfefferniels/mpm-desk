import { AnySpan, NoteSpan } from "../performance/midiSpans";

const MEI_NS = "http://www.music-encoding.org/ns/mei";

export const insertRecording = (newMEI: Document, source?: string) => {
    let recording = source
        ? newMEI.querySelector(`recording[source="${source}"]`)
        : newMEI.querySelector('recording');

    if (recording) {
        // remove the existing recording
        recording.remove()
    }

    recording = newMEI.createElementNS('http://www.music-encoding.org/ns/mei', 'recording');
    let performance = newMEI.querySelector('performance');
    if (!performance) {
        performance = newMEI.createElementNS('http://www.music-encoding.org/ns/mei', 'performance');

        const music = newMEI.querySelector('music');
        if (!music) {
            console.log('No <music> element found. Aborting.');
            return;
        }
        music.appendChild(performance);
    }
    performance.appendChild(recording);

    if (source && !recording.hasAttribute('source')) {
        recording.setAttribute('source', source);
    }

    return recording
}

export const insertWhen = (newMEI: Document, recording: Element, midiSpan: AnySpan, scoreNote: string) => {
    const when = newMEI.createElementNS('http://www.music-encoding.org/ns/mei', 'when');
    recording.appendChild(when);

    when.setAttribute('absolute', midiSpan.onsetMs.toFixed(0) + 'ms');
    when.setAttribute('abstype', 'smil');
    when.setAttribute('corresp', midiSpan.link || midiSpan.id);
    when.setAttribute('data', '#' + scoreNote);

    if (midiSpan.type === 'note') {
        const velocity = newMEI.createElementNS('http://www.music-encoding.org/ns/mei', 'extData');
        velocity.setAttribute('type', 'velocity');
        velocity.textContent = midiSpan.velocity.toString();
        when.appendChild(velocity);
    }

    const durationMs = newMEI.createElementNS('http://www.music-encoding.org/ns/mei', 'extData');
    durationMs.setAttribute('type', 'duration');
    durationMs.textContent = (midiSpan.offsetMs - midiSpan.onsetMs).toFixed(0) + 'ms';

    const onsetTicks = newMEI.createElementNS('http://www.music-encoding.org/ns/mei', 'extData');
    onsetTicks.setAttribute('type', 'onsetTicks');
    onsetTicks.textContent = midiSpan.onset.toString();

    const durationTicks = newMEI.createElementNS('http://www.music-encoding.org/ns/mei', 'extData');
    durationTicks.setAttribute('type', 'durationTicks');
    durationTicks.textContent = (midiSpan.offset - midiSpan.onset).toString();

    when.appendChild(durationMs);
    when.appendChild(onsetTicks);
    when.appendChild(durationTicks);
};

/** One <extData type="..."> child, which is how a <when> carries anything extra. */
const extData = (doc: Document, when: Element, type: string, value: string) => {
    const element = doc.createElementNS(MEI_NS, "extData");
    element.setAttribute("type", type);
    element.textContent = value;
    when.appendChild(element);
};

/**
 * What the reader made of a divergence, written alongside it.
 *
 * Kept apart from the measured facts - a reading is a judgement, and it carries
 * who made it and how sure they were, in the same terms the rest of the project
 * uses for editorial decisions (see ../ui/CreateReading).
 */
export interface WhenReading {
    reading: string;
    resp?: string;
    certainty?: string;
}

/**
 * Which quantity `ornamentAnchorConfidence` holds, written beside it.
 *
 * An edition outlives the code that wrote it, and this number has already
 * changed meaning once. It used to be the attribution head's whole-row mass,
 * which also carried the match head's P(insertion); it is now the head's own two
 * factors, asked of a played note the alignment had already given up on pairing.
 * Both are probabilities in [0, 1] and the second is always the larger, so a
 * reader comparing two files has nothing to tell them apart by.
 *
 * Hence a token naming the quantity rather than a version. A version number
 * needs a changelog to mean anything; this says what was measured, and stays
 * legible on its own.
 *
 * **Absent means the older quantity.** A file written before this token existed
 * must keep parsing exactly as it did, and there is no way to add the token to
 * one retrospectively without knowing which code wrote it. So absence is not
 * "unknown", it is the reading, and nothing should ever write the old value's
 * name - it exists only as the default.
 */
export const ORNAMENT_ANCHOR_CONFIDENCE_OF = "anchor-given-insertion";

/**
 * A played note with no note in the score.
 *
 * It has no `@data`, because there is nothing in the score for it to point at -
 * that absence is the whole content of the record. Everything needed to find the
 * note again, or to draw it, is carried in `<extData>`.
 *
 * The ornament fields are espressivo's own names for the same facts
 * (`ornament.anchor`, `ornament.slot`, `ornament.pass`; see its PARITY.md §6.4).
 * espressivo writes them when it *generates* an ornament's notes from a score;
 * this writes them when we have *recognised* those notes in a recording. Using
 * one vocabulary for both directions is what will let an MPM v3 ornament be
 * fitted from these records later without reshaping anything.
 */
export const insertInsertionWhen = (
    doc: Document,
    recording: Element,
    span: NoteSpan,
    extra: {
        confidence?: number;
        ornamentAnchor?: string | null;
        ornamentAnchorFrom?: "model" | "model-and-sign" | "timing" | null;
        ornamentAnchorConfidence?: number;
        ornamentSlot?: number;
        reading?: WhenReading;
    } = {}
) => {
    const when = doc.createElementNS(MEI_NS, "when");
    recording.appendChild(when);

    when.setAttribute("absolute", span.onsetMs.toFixed(0) + "ms");
    when.setAttribute("abstype", "smil");
    when.setAttribute("corresp", span.link || span.id);
    when.setAttribute("type", "insertion");

    extData(doc, when, "pitch", span.pitch.toString());
    extData(doc, when, "velocity", span.velocity.toString());
    extData(doc, when, "duration", (span.offsetMs - span.onsetMs).toFixed(0) + "ms");
    extData(doc, when, "onsetTicks", span.onset.toString());
    extData(doc, when, "durationTicks", (span.offset - span.onset).toString());

    if (extra.confidence !== undefined) {
        extData(doc, when, "confidence", extra.confidence.toFixed(3));
    }
    if (extra.ornamentAnchor) {
        extData(doc, when, "ornamentAnchor", "#" + extra.ornamentAnchor);
    }
    // Where the anchor came from, because these are not the same claim. The
    // model was asked which written note this decorates; the timing only knows
    // which one was struck last; `model-and-sign` means the model ranked that
    // note clearly but was unsure it was an ornament at all, and an ornament
    // sign the score already writes on that very note is what settled it. A
    // reader coming back to this file can tell the three apart.
    if (extra.ornamentAnchor && extra.ornamentAnchorFrom) {
        extData(doc, when, "ornamentAnchorFrom", extra.ornamentAnchorFrom);
    }
    // The two go together or not at all: an unlabelled number is the thing this
    // token exists to stop, so there is no path that writes one without it.
    if (extra.ornamentAnchorConfidence !== undefined) {
        extData(doc, when, "ornamentAnchorConfidence", extra.ornamentAnchorConfidence.toFixed(3));
        extData(doc, when, "ornamentAnchorConfidenceOf", ORNAMENT_ANCHOR_CONFIDENCE_OF);
    }
    if (extra.ornamentSlot !== undefined) {
        extData(doc, when, "ornamentSlot", extra.ornamentSlot.toString());
    }

    applyReading(doc, when, extra.reading);
};

/**
 * A written note the recording never played.
 *
 * The mirror of an insertion: it has `@data` and no `@absolute`, because there is
 * a note but no moment. Both shapes were checked against the vendored fork before
 * being written into the recording it lays a score out from - it ignores a <when>
 * it cannot resolve, and every notehead stays exactly where it was.
 */
export const insertDeletionWhen = (
    doc: Document,
    recording: Element,
    scoreId: string,
    extra: { confidence?: number; reading?: WhenReading } = {}
) => {
    const when = doc.createElementNS(MEI_NS, "when");
    recording.appendChild(when);

    when.setAttribute("data", "#" + scoreId);
    when.setAttribute("type", "deletion");

    if (extra.confidence !== undefined) {
        extData(doc, when, "confidence", extra.confidence.toFixed(3));
    }

    applyReading(doc, when, extra.reading);
};

/**
 * A written note the recording played as a different note.
 *
 * The only shape that carries `@data` and `@absolute` at once and still is not a
 * match: there is a note *and* a moment, and what differs is the pitch, which is
 * why the pitch actually sounded is written into `<extData type="pitch">` the way
 * an insertion's is. Read without that, it is exactly a match - which is what it
 * musically is, a written note that sounded - so the fork lays the note out at
 * the moment it was struck rather than leaving it behind as unplayed. That is the
 * right picture: the note was not skipped, it came out differently.
 */
export const insertSubstitutionWhen = (
    doc: Document,
    recording: Element,
    scoreId: string,
    span: NoteSpan,
    extra: { writtenPitch?: number; confidence?: number; reading?: WhenReading } = {}
) => {
    const when = doc.createElementNS(MEI_NS, "when");
    recording.appendChild(when);

    when.setAttribute("absolute", span.onsetMs.toFixed(0) + "ms");
    when.setAttribute("abstype", "smil");
    when.setAttribute("corresp", span.link || span.id);
    when.setAttribute("data", "#" + scoreId);
    when.setAttribute("type", "substitution");

    extData(doc, when, "pitch", span.pitch.toString());
    if (extra.writtenPitch !== undefined) {
        extData(doc, when, "writtenPitch", extra.writtenPitch.toString());
    }
    extData(doc, when, "velocity", span.velocity.toString());
    extData(doc, when, "duration", (span.offsetMs - span.onsetMs).toFixed(0) + "ms");
    extData(doc, when, "onsetTicks", span.onset.toString());
    extData(doc, when, "durationTicks", (span.offset - span.onset).toString());

    if (extra.confidence !== undefined) {
        extData(doc, when, "confidence", extra.confidence.toFixed(3));
    }

    applyReading(doc, when, extra.reading);
};

function applyReading(doc: Document, when: Element, reading?: WhenReading) {
    if (!reading) return;

    extData(doc, when, "reading", reading.reading);
    if (reading.resp) extData(doc, when, "resp", reading.resp);
    if (reading.certainty) extData(doc, when, "certainty", reading.certainty);
}
