import type { MidiFile } from "midifile-ts";
import { asSpans } from "../performance/midiSpans";
import { insertMetadata, parseMetadata } from "../mei/insertMetadata";
import { insertPedals } from "../mei/insertPedals";
import {
    insertDeletionWhen,
    insertInsertionWhen,
    insertRecording,
    insertSubstitutionWhen,
    insertWhen,
} from "../mei/when";
import type { Match } from "./types";
import type { Divergence } from "./divergences";

/** What the reader decided about each divergence, keyed by its id. */
export type Resolutions = ReadonlyMap<
    string,
    { reading: string; action?: string; resp?: string; certainty?: string }
>;

export interface AlignmentExtras {
    /**
     * What this take is called: the `@source` of the `<recording>` written here.
     *
     * **Required, and required because a document holds more than one.** It is the name a
     * `MakeChoice` selects a reading by and the name verovio's `performanceRecording` lays out by,
     * so two takes that share it are one take and a take without it can be named by nobody.
     *
     * Not defaulted from the MIDI's own source, the second text meta event a piano-roll scanner
     * writes, because an ordinary `.mid` carries none. With none, {@link insertRecording} takes
     * `<recording>` to mean *the first one*, so aligning a second performance against a score
     * deletes the first. The caller knows the file it opened and what the document already holds.
     * `parseMetadata` is still where the roll's own answer comes from.
     */
    source: string;
    /** The disagreements, so that they survive the document rather than the page */
    divergences?: readonly Divergence[];
    /** Readings the reader has confirmed or overruled */
    resolutions?: Resolutions;
}

/**
 * Write a matching of the score against a MIDI recording into the MEI, as the
 * <recording> of its <performance>.
 *
 * This is what the score is laid out from, so the editor renders the result of
 * this while aligning and only writes the very same document back when the
 * alignment is finalized.
 *
 * Where divergences are given they are written into the same <recording>, as
 * <when>s with no `@data` (a played note with no note in the score) or no
 * `@absolute` (a written note that was never played). The fork ignores both -
 * checked against it before this was written - so the layout is unaffected and
 * the disagreements stop dying with the page.
 *
 * A substitution is the exception, and deliberately so: it carries both, because
 * the written note did sound, only at another pitch. The fork therefore lays it
 * out at the moment it was struck, which is where it belongs.
 */
export function applyAlignment(
    mei: string,
    midi: MidiFile,
    pairs: Match[],
    extras: AlignmentExtras
): string {
    const meiDoc = new DOMParser().parseFromString(mei, "application/xml");
    const { source } = extras;

    insertMetadata({ ...parseMetadata(midi), source }, meiDoc);

    const recording = insertRecording(meiDoc, source);
    if (!recording) {
        throw new Error("Could not create the <recording> element");
    }

    const spans = asSpans(midi, true);
    const spanById = new Map(spans.map((span) => [span.id, span]));
    const unknown: string[] = [];

    for (const pair of pairs) {
        const span = spanById.get(pair.performance_id);
        if (!span) continue;

        // A <when> may only point at an element the document holds. Verovio hands
        // out ids of its own for material it unfolds - a repeated section is read
        // from ids like "n1-rend2" that exist nowhere in the source - and writing
        // those through would leave the MEI referring to nothing
        if (!meiDoc.querySelector(`[*|id="${pair.score_id}"]`)) {
            unknown.push(pair.score_id);
            continue;
        }

        insertWhen(meiDoc, recording, span, pair.score_id);
    }

    if (unknown.length > 0) {
        console.warn(
            `Left out ${unknown.length} match(es) against elements the MEI does not contain, such as '${unknown[0]}'`
        );
    }

    for (const divergence of extras.divergences ?? []) {
        const resolution = extras.resolutions?.get(divergence.id);
        const reading = {
            reading: resolution?.reading ?? divergence.reading,
            resp: resolution?.resp,
            certainty: resolution?.certainty,
        };

        if (divergence.kind === "added") {
            divergence.perfIds.forEach((perfId, slot) => {
                const span = spanById.get(perfId);
                if (!span || span.type !== "note") return;

                insertInsertionWhen(meiDoc, recording, span, {
                    confidence: divergence.confidence,
                    ornamentAnchor: divergence.anchorId,
                    ornamentAnchorFrom: divergence.anchorCorroborated
                        ? "model-and-sign"
                        : divergence.anchorFrom,
                    ornamentAnchorConfidence: divergence.anchorConfidence,
                    ornamentSlot: slot,
                    reading,
                });
            });
        } else if (divergence.kind === "missing") {
            for (const scoreId of divergence.scoreIds) {
                if (!meiDoc.querySelector(`[*|id="${scoreId}"]`)) continue;
                insertDeletionWhen(meiDoc, recording, scoreId, {
                    confidence: divergence.confidence,
                    reading,
                });
            }
        } else {
            const span = spanById.get(divergence.perfId);
            if (!span || span.type !== "note") continue;
            if (!meiDoc.querySelector(`[*|id="${divergence.scoreId}"]`)) continue;

            // A pair the reader has confirmed the aligner should have made is
            // written as the plain match it is, so that nothing downstream has
            // to know a substitution shape to see that the note was played.
            if (resolution?.action === "count-as-played") {
                insertWhen(meiDoc, recording, span, divergence.scoreId);
                continue;
            }

            insertSubstitutionWhen(meiDoc, recording, divergence.scoreId, span, {
                writtenPitch: divergence.pitches[0],
                confidence: divergence.confidence,
                reading,
            });
        }
    }

    insertPedals(
        spans.filter((span) => span.type === "soft" || span.type === "sustain"),
        [],
        meiDoc,
        source
    );

    return new XMLSerializer().serializeToString(meiDoc);
}
