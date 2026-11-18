import { readScore } from "../alignment/transcription/scoreModel";
import { NoteSpan } from "../performance/midiSpans";
import { parseTravel, type Travel } from "../performance/pedalTravel";
import { midiPitch } from "../performance/pitch";
import { ALTERATION, impliedAlterations, ownAccidental } from "../score/accidentals";

export interface PedalEvent {
    type: "sustain" | "soft";
    onsetMs: number;
    durationMs: number;
    /** The line the pedal drew, where the record holds one; a switch held for `durationMs` otherwise. */
    travel?: Travel;
}

/**
 * A disagreement read back out of a <recording>.
 *
 * The counterpart of what ../alignment/applyAlignment writes: an insertion has a
 * moment and no note, a deletion a note and no moment. Reading them back is what
 * makes a review survive being saved and reopened.
 */
export interface RecordedDivergence {
    kind: "insertion" | "deletion" | "substitution";
    /** The played note, for an insertion or a substitution */
    span?: NoteSpan;
    /** The written note, for a deletion or a substitution */
    scoreId?: string;
    /** What the score writes, where the recording played something else */
    writtenPitch?: number;
    confidence?: number;
    reading?: string;
    resp?: string;
    certainty?: string;
    ornamentAnchor?: string;
    /** Whether the model named that anchor or the timing was guessed from */
    ornamentAnchorFrom?: string;
    ornamentAnchorConfidence?: number;
    /**
     * Which quantity `ornamentAnchorConfidence` holds, where the file says.
     *
     * Absent is not "unknown", it is the reading: a file written before this
     * token existed holds the older quantity, the attribution head's whole-row
     * mass, which also carries the match head's P(insertion) and is therefore
     * the smaller of the two. See `ORNAMENT_ANCHOR_CONFIDENCE_OF` in `./when`.
     */
    ornamentAnchorConfidenceOf?: string;
    ornamentSlot?: number;
}

export interface RecordingInfo {
    source: string;
    label: string;
    noteSpans: Map<string, NoteSpan>;
    /**
     * How sure the aligner was of each match, by the written note, where the `<when>` says.
     * Only the working form says: a saved document keeps the match and not the doubt.
     */
    matchConfidence: Map<string, number>;
    pedalEvents: PedalEvent[];
    divergences: RecordedDivergence[];
}

/**
 * What every written note sounds as, by `@xml:id`.
 *
 * A `<when>` says when a note sounded and points at the note; what it sounded *as* is the
 * score's to say. And the score says it the way scores do: an e in three flats is an e flat
 * with nothing written on it, a sharp holds to the end of its bar, a note under an ottava
 * sounds an octave from where it stands. Reading the pitch off the note alone - its letter,
 * its octave and the accidental it happens to carry - hears none of that, and a recording
 * read back out of such a score is played in C major whatever key it was played in. Over
 * thirty rolls of Chopin against the first editions that was every second matched note.
 *
 * So the pitch is the one the transcriber's reading of the score has, which reads key
 * signature, bar and ottava, and agrees with what was played for every one of those notes.
 * It reads one reading of an `<app>`. A note in the other is read for itself, with what key
 * and bar imply for it.
 */
function soundingPitches(doc: Document, ns: string): Map<string, number> {
    const pitches = new Map<string, number>();
    for (const note of readScore(doc).notes.values()) pitches.set(note.id, note.pitch);

    const implied = impliedAlterations(doc);
    for (const noteEl of doc.getElementsByTagNameNS(ns, "note")) {
        const id = noteEl.getAttribute("xml:id");
        if (!id || pitches.has(id)) continue;

        const natural = midiPitch(noteEl.getAttribute("pname"), noteEl.getAttribute("oct"));
        if (natural === undefined) continue;

        const own = ownAccidental(noteEl);
        const alter = own !== undefined ? (ALTERATION[own] ?? 0) : (implied.get(id) ?? 0);
        pitches.set(id, natural + alter);
    }
    return pitches;
}

export function parseRecordings(mei: string): {
    recordings: RecordingInfo[];
    pitchMap: Map<string, number>;
} {
    const doc = new DOMParser().parseFromString(mei, "application/xml");
    const ns = "http://www.music-encoding.org/ns/mei";

    const pitchMap = soundingPitches(doc, ns);

    // Parse recordings
    const recordings: RecordingInfo[] = [];
    const recordingEls = doc.getElementsByTagNameNS(ns, "recording");

    for (let ri = 0; ri < recordingEls.length; ri++) {
        const recEl = recordingEls[ri];
        const source = recEl.getAttribute("source") || "";
        const label = `Recording ${ri + 1}`;

        const noteSpans = new Map<string, NoteSpan>();
        const matchConfidence = new Map<string, number>();
        const pedalEvents: PedalEvent[] = [];
        const divergences: RecordedDivergence[] = [];

        for (const when of recEl.getElementsByTagNameNS(ns, "when")) {
            const absoluteAttr = when.getAttribute("absolute");
            const dataAttr = when.getAttribute("data");
            const type = when.getAttribute("type");

            const extDatas = when.getElementsByTagNameNS(ns, "extData");
            let velocity = 64;
            let durationMs = 0;
            let onsetTicks = 0;
            let durationTicks = 0;
            let pitch: number | undefined;
            let confidence: number | undefined;
            let reading: string | undefined;
            let resp: string | undefined;
            let certainty: string | undefined;
            let ornamentAnchor: string | undefined;
            let ornamentSlot: number | undefined;
            let writtenPitch: number | undefined;
            let ornamentAnchorFrom: string | undefined;
            let ornamentAnchorConfidence: number | undefined;
            let ornamentAnchorConfidenceOf: string | undefined;
            let travel: Travel | undefined;

            for (let i = 0; i < extDatas.length; i++) {
                const ext = extDatas[i];
                const etype = ext.getAttribute("type");
                const text = ext.textContent || "";
                if (etype === "velocity") velocity = parseInt(text, 10);
                else if (etype === "duration") durationMs = parseInt(text, 10);
                else if (etype === "travel") travel = parseTravel(text);
                else if (etype === "onsetTicks") onsetTicks = parseInt(text, 10);
                else if (etype === "durationTicks") durationTicks = parseInt(text, 10);
                else if (etype === "pitch") pitch = parseInt(text, 10);
                else if (etype === "confidence") confidence = parseFloat(text);
                else if (etype === "reading") reading = text;
                else if (etype === "resp") resp = text;
                else if (etype === "certainty") certainty = text;
                else if (etype === "ornamentAnchor") ornamentAnchor = text.replace(/^#/, "");
                else if (etype === "ornamentSlot") ornamentSlot = parseInt(text, 10);
                else if (etype === "writtenPitch") writtenPitch = parseInt(text, 10);
                else if (etype === "ornamentAnchorFrom") ornamentAnchorFrom = text;
                else if (etype === "ornamentAnchorConfidence")
                    ornamentAnchorConfidence = parseFloat(text);
                else if (etype === "ornamentAnchorConfidenceOf")
                    ornamentAnchorConfidenceOf = text;
            }

            // A written note that was never played: a note and no moment.
            if (type === "deletion" && dataAttr) {
                divergences.push({
                    kind: "deletion",
                    scoreId: dataAttr.replace(/^#/, ""),
                    confidence,
                    reading,
                    resp,
                    certainty,
                });
                continue;
            }

            if (!absoluteAttr) continue;
            const onsetMs = parseInt(absoluteAttr, 10);

            // A played note with no note in the score: a moment and no note.
            if (type === "insertion") {
                const id = when.getAttribute("corresp") || "";
                divergences.push({
                    kind: "insertion",
                    span: {
                        type: "note",
                        id,
                        onset: onsetTicks,
                        offset: onsetTicks + durationTicks,
                        onsetMs,
                        offsetMs: onsetMs + durationMs,
                        pitch: pitch ?? 0,
                        velocity,
                        channel: 0,
                    },
                    confidence,
                    reading,
                    resp,
                    certainty,
                    ornamentAnchor,
                    ornamentAnchorFrom,
                    ornamentAnchorConfidence,
                    ornamentAnchorConfidenceOf,
                    ornamentSlot,
                });
                continue;
            }

            // A written note played as a different note: a note and a moment, and
            // a pitch that is not the one written. It counts as sounding, so it
            // goes into the spans as well - at the pitch actually heard, which is
            // what a recording is a record of.
            if (type === "substitution" && dataAttr) {
                const noteId = dataAttr.replace(/^#/, "");
                const span: NoteSpan = {
                    type: "note",
                    id: when.getAttribute("corresp") || noteId,
                    onset: onsetTicks,
                    offset: onsetTicks + durationTicks,
                    onsetMs,
                    offsetMs: onsetMs + durationMs,
                    pitch: pitch ?? pitchMap.get(noteId) ?? 0,
                    velocity,
                    channel: 0,
                };

                noteSpans.set(noteId, span);
                divergences.push({
                    kind: "substitution",
                    scoreId: noteId,
                    span,
                    writtenPitch: writtenPitch ?? pitchMap.get(noteId),
                    confidence,
                    reading,
                    resp,
                    certainty,
                });
                continue;
            }

            if (dataAttr) {
                const noteId = dataAttr.replace(/^#/, "");
                const corresp = when.getAttribute("corresp") || noteId;

                noteSpans.set(noteId, {
                    type: "note",
                    id: corresp,
                    onset: onsetTicks,
                    offset: onsetTicks + durationTicks,
                    onsetMs,
                    offsetMs: onsetMs + durationMs,
                    pitch: pitchMap.get(noteId) || 0,
                    velocity,
                    channel: 0,
                });
                if (confidence !== undefined) matchConfidence.set(noteId, confidence);
            } else if (type === "sustain" || type === "soft") {
                pedalEvents.push({ type, onsetMs, durationMs, ...(travel && { travel }) });
            }
        }

        recordings.push({ source, label, noteSpans, matchConfidence, pedalEvents, divergences });
    }

    return { recordings, pitchMap };
}
