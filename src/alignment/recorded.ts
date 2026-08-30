import type { RecordingInfo } from "../mei/parseRecordings";
import type { NoteSpan } from "../performance/midiSpans";
import type { DeletedNote, InsertedNote, MatchedNote } from "./mlign";

/**
 * An alignment read back out of the `<recording>` it was written into.
 *
 * The inverse of `applyAlignment`, and what makes a review survive being saved: reopening a
 * project restores the disagreements — and so the ids the reader's decisions are filed under —
 * without downloading three megabytes of model and running it again over a matching that has
 * already been settled.
 *
 * It answers in the three flat lists {@link divergencesOf} takes, because those are what the
 * grouping is a function of. Reconstructing the *grouping* here instead would be a second
 * implementation of it, free to disagree with the one a fresh run goes through.
 */
export interface RecordedAlignment {
    matches: MatchedNote[];
    deletions: DeletedNote[];
    insertions: InsertedNote[];
    /** Every note the recording sounded, matched or not, which the grouping measures against. */
    spans: NoteSpan[];
}

/**
 * How sure the model was that a note it matched is that note.
 *
 * Not recorded: `insertWhen` writes the moment, the velocity and the lengths, and a plain match
 * carries no confidence. Nor is one needed — `divergencesOf` reads a match for its *timing* only,
 * to anchor the passage, and the one thing confidence decided (which matches were written at all)
 * was decided before this document was saved. Stating it as certainty rather than as zero is what
 * keeps a re-read alignment from looking like an unusually doubtful fresh one.
 */
const MATCHED = 1;

/**
 * What the attribution head must have said, for an anchor the document records.
 *
 * `ornamentAnchorConfidence` is the posterior — the gate times the ranking, which
 * `acceptAttribution` is what thresholds — so putting it back as the gate against a ranking of 1
 * reproduces that product exactly, and with it both ways an anchor can be accepted: outright
 * where the posterior clears `attributionPosterior`, and on the strength of an engraved sign
 * where it does not. The sign is read from the same document, so that branch answers as it did.
 *
 * An anchor the *timing* guessed carries no attribution at all and is given none: the guess is
 * `divergencesOf`'s own fallback, and it makes it again from the same notes.
 */
const attributionOf = (
    divergence: RecordingInfo["divergences"][number],
): InsertedNote["ornamentOf"] => {
    const scoreId = divergence.ornamentAnchor;
    if (!scoreId) return undefined;
    if (divergence.ornamentAnchorFrom === "timing") return undefined;

    const posterior = divergence.ornamentAnchorConfidence ?? 1;
    return { scoreId, confidence: posterior, gate: posterior, share: 1 };
};

export const recordedAlignment = (recording: RecordingInfo): RecordedAlignment => {
    const matches: MatchedNote[] = [...recording.noteSpans].map(([scoreId, span]) => ({
        scoreId,
        performanceId: span.id,
        confidence: MATCHED,
    }));

    const deletions: DeletedNote[] = [];
    const insertions: InsertedNote[] = [];
    const spans: NoteSpan[] = [...recording.noteSpans.values()];

    for (const divergence of recording.divergences) {
        const confidence = divergence.confidence ?? 0;

        if (divergence.span) spans.push(divergence.span);

        // A substitution is written as one `<when>` carrying both halves, because the written
        // note did sound — but it *reached* the document as a deletion and an insertion at one
        // moment, which is what `divergencesOf` pairs back into it. Handing it over whole would
        // ask the pairing to recognise its own output, which it has no rule for.
        if (divergence.kind !== "insertion" && divergence.scoreId) {
            deletions.push({ scoreId: divergence.scoreId, confidence });
        }
        if (divergence.kind !== "deletion" && divergence.span) {
            insertions.push({
                performanceId: divergence.span.id,
                confidence,
                ...(() => {
                    const ornamentOf = attributionOf(divergence);
                    return ornamentOf ? { ornamentOf } : {};
                })(),
            });
        }
    }

    return { matches, deletions, insertions, spans };
};
