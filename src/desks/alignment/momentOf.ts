/**
 * When, in the recording, the place of an alteration is.
 *
 * How a figure is to be written is a question about how it sounded, and the answer is on the
 * roll. For a note that was played, the place is the moment it was struck. For one that was not,
 * there is no such moment: it is the moment the note was *due*, read off the notes around it that
 * were played, in proportion to where it stands between them in the score.
 */

import type { Divergence } from "../../alignment/divergences";

interface Played {
    id: string;
    onsetMs: number;
}

interface Written {
    note: string;
    /** Where the note stands in the score, in quarter notes from its start */
    onset: number;
}

interface Match {
    scoreId: string;
    performanceId: string;
}

export function momentOf(
    divergence: Divergence,
    matches: readonly Match[],
    spans: readonly Played[],
    scoreNotes: readonly Written[]
): number | undefined {
    if (divergence.kind !== "missing") return divergence.onsetMs;

    const struck = new Map(spans.map((span) => [span.id, span.onsetMs]));
    const stands = new Map(scoreNotes.map((note) => [note.note, note.onset]));

    // The played notes on either side of where it stands in the score
    let before: { onset: number; ms: number } | undefined;
    let after: { onset: number; ms: number } | undefined;
    for (const match of matches) {
        const onset = stands.get(match.scoreId);
        const ms = struck.get(match.performanceId);
        if (onset === undefined || ms === undefined) continue;
        if (onset <= divergence.onset && (!before || onset > before.onset)) before = { onset, ms };
        if (onset >= divergence.onset && (!after || onset < after.onset)) after = { onset, ms };
    }

    if (before && after && after.onset > before.onset) {
        const along = (divergence.onset - before.onset) / (after.onset - before.onset);
        return before.ms + along * (after.ms - before.ms);
    }
    return (before ?? after)?.ms;
}
