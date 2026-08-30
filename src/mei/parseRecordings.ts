import { NoteSpan } from "../performance/midiSpans";
import { midiPitch } from "../performance/pitch";

export interface PedalEvent {
    type: "sustain" | "soft";
    onsetMs: number;
    durationMs: number;
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
    pedalEvents: PedalEvent[];
    divergences: RecordedDivergence[];
}

/** The accidental of a note, whether written on it or on a child <accid> */
function accidentalOf(noteEl: Element, ns: string): string | null {
    const accid = noteEl.getAttribute("accid");
    if (accid) return accid;

    const accidEl = noteEl.getElementsByTagNameNS(ns, "accid")[0];
    return accidEl
        ? accidEl.getAttribute("accid.ges") ?? accidEl.getAttribute("accid")
        : null;
}

export function parseRecordings(mei: string): {
    recordings: RecordingInfo[];
    pitchMap: Map<string, number>;
} {
    const doc = new DOMParser().parseFromString(mei, "application/xml");
    const ns = "http://www.music-encoding.org/ns/mei";

    // Build pitch map from score <note> elements
    const pitchMap = new Map<string, number>();
    for (const noteEl of doc.getElementsByTagNameNS(ns, "note")) {
        const id = noteEl.getAttribute("xml:id");
        if (!id) continue;

        const pitch = midiPitch(
            noteEl.getAttribute("pname"),
            noteEl.getAttribute("oct"),
            accidentalOf(noteEl, ns)
        );
        if (pitch !== undefined) pitchMap.set(id, pitch);
    }

    // Parse recordings
    const recordings: RecordingInfo[] = [];
    const recordingEls = doc.getElementsByTagNameNS(ns, "recording");

    for (let ri = 0; ri < recordingEls.length; ri++) {
        const recEl = recordingEls[ri];
        const source = recEl.getAttribute("source") || "";
        const label = `Recording ${ri + 1}`;

        const noteSpans = new Map<string, NoteSpan>();
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

            for (let i = 0; i < extDatas.length; i++) {
                const ext = extDatas[i];
                const etype = ext.getAttribute("type");
                const text = ext.textContent || "";
                if (etype === "velocity") velocity = parseInt(text, 10);
                else if (etype === "duration") durationMs = parseInt(text, 10);
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
            } else if (type === "sustain" || type === "soft") {
                pedalEvents.push({ type, onsetMs, durationMs });
            }
        }

        recordings.push({ source, label, noteSpans, pedalEvents, divergences });
    }

    return { recordings, pitchMap };
}
