import type { NoteSpan } from "../../performance/midiSpans";
import type { ScoreNote } from "../../score/scoreNotes";
import type { DeletedNote, InsertedNote } from "../mlign";
import type { AcceptedAnchor } from "./attribution";
import { anchorFor, type Anchor } from "./timeMap";
import type { DivergenceInput } from "./types";

export interface PlayedGroup {
    /** {@link divergenceId} of the first note in it. */
    id: string;
    entries: { insertion: InsertedNote; span: NoteSpan }[];
}

export interface UnplayedGroup {
    /** {@link divergenceId} of the first note in it. */
    id: string;
    entries: { deletion: DeletedNote; note: ScoreNote }[];
}

/**
 * A played note's name in a divergence id: when it was struck, and at what pitch.
 *
 * Divergence ids are what a reader's decisions are filed under, and those are
 * saved in the work file and read back against a fresh grouping. So they must
 * name material rather than position: a counter would silently re-point every
 * decision after an added insertion at the wrong disagreement. A group that
 * gains or loses its first note gets a different id, leaving the decision
 * unattached rather than misattached.
 *
 * A played note's own id is not one thing — `asSpans` mints one from the MIDI,
 * `parseRecordings` takes `@corresp` — so the two readers of one alignment would
 * disagree about it. Onset and pitch they agree about, to the millisecond
 * `@absolute` is written at.
 */
const playedId = (span: NoteSpan) => `${String(Math.round(span.onsetMs))}ms-${String(span.pitch)}`;

const divergenceId = (kind: "added" | "missing", first: string) => `${kind}-${first}`;

/**
 * Played notes with no score note, gathered into events.
 *
 * A run with no real silence between its notes, all leaning on the same written
 * note, is one event however many notes it holds.
 */
export function groupPlayed(
    input: DivergenceInput,
    spanById: Map<string, NoteSpan>,
    anchors: Anchor[],
    accepted: ReadonlyMap<string, AcceptedAnchor>,
    gapMs: number,
    attributedGapMs: number
): PlayedGroup[] {
    const played = input.insertions
        .map((insertion) => ({ insertion, span: spanById.get(insertion.performanceId) }))
        .filter((entry): entry is { insertion: InsertedNote; span: NoteSpan } => !!entry.span)
        .sort((a, b) => a.span.onsetMs - b.span.onsetMs);

    const groups: PlayedGroup[] = [];
    for (const entry of played) {
        const current = groups[groups.length - 1];
        const previous = current?.entries[current.entries.length - 1];
        if (previous === undefined) {
            groups.push({ id: divergenceId("added", playedId(entry.span)), entries: [entry] });
            continue;
        }

        const silence = entry.span.onsetMs - previous.span.onsetMs;
        const named = accepted.get(entry.span.id)?.scoreId;
        const namedBefore = accepted.get(previous.span.id)?.scoreId;

        // Two notes the model puts on the same written note are one figure, and
        // the timing only has to agree that they are in the same passage. Where
        // it has not spoken, the figure is whatever ran on without a silence
        // against the same note - which is the older guess, kept for the notes
        // the head declined and for a model that has no head at all.
        const sameEvent =
            named !== undefined && namedBefore !== undefined
                ? named === namedBefore && silence <= attributedGapMs
                : named === undefined &&
                  namedBefore === undefined &&
                  silence <= gapMs &&
                  anchorFor(previous.span.onsetMs, anchors)?.scoreId ===
                      anchorFor(entry.span.onsetMs, anchors)?.scoreId;

        if (sameEvent) current.entries.push(entry);
        else groups.push({ id: divergenceId("added", playedId(entry.span)), entries: [entry] });
    }

    return groups;
}

/**
 * Written notes nothing answered to, gathered into events.
 *
 * A note whose own moment was otherwise played thinned a chord; one whose moment
 * went unplayed altogether belongs with its neighbours in a passage.
 */
export function groupUnplayed(
    input: DivergenceInput,
    scoreById: Map<string, ScoreNote>
): UnplayedGroup[] {
    const matchedOnsets = new Set<number>();
    for (const match of input.matches) {
        const note = scoreById.get(match.scoreId);
        if (note) matchedOnsets.add(note.onset);
    }

    const unplayed = input.deletions
        .map((deletion) => ({ deletion, note: scoreById.get(deletion.scoreId) }))
        .filter((entry): entry is { deletion: DeletedNote; note: ScoreNote } => !!entry.note)
        .sort((a, b) => a.note.onset - b.note.onset || a.note.pitch - b.note.pitch);

    const groups: UnplayedGroup[] = [];
    for (const entry of unplayed) {
        const current = groups[groups.length - 1];
        const previous = current?.entries[current.entries.length - 1];
        const thinning = matchedOnsets.has(entry.note.onset);
        const previousThinning = previous ? matchedOnsets.has(previous.note.onset) : false;

        const sameEvent =
            previous !== undefined &&
            thinning === previousThinning &&
            (thinning ? previous.note.onset === entry.note.onset : true);

        if (sameEvent) current.entries.push(entry);
        else groups.push({ id: divergenceId("missing", entry.note.note), entries: [entry] });
    }

    return groups;
}
