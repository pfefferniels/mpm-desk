import type { ScoreNote } from "../../score/scoreNotes";
import type { UnplayedGroup } from "./grouping";
import type { DivergenceInput, MissingDivergence, MissingReading } from "./types";

interface MissingContext {
    /** Score moments the recording answered to at all */
    matchedOnsets: Set<number>;
    /** Whether the recording covers a moment, judged from the notes around it */
    coveredFrom: number;
    coveredTo: number;
}

export function missingContextOf(
    input: DivergenceInput,
    scoreById: Map<string, ScoreNote>,
    covered: boolean
): MissingContext {
    const matchedOnsets = new Set<number>();
    let coveredFrom = Infinity;
    let coveredTo = -Infinity;

    for (const match of input.matches) {
        const note = scoreById.get(match.scoreId);
        if (!note) continue;
        matchedOnsets.add(note.onset);
        if (note.onset < coveredFrom) coveredFrom = note.onset;
        if (note.onset > coveredTo) coveredTo = note.onset;
    }

    return covered
        ? { matchedOnsets, coveredFrom, coveredTo }
        : { matchedOnsets, coveredFrom: Infinity, coveredTo: -Infinity };
}

export function readUnplayed(group: UnplayedGroup, ctx: MissingContext): MissingDivergence {
    const notes = group.entries.map((entry) => entry.note);
    const onset = notes[0].onset;

    let reading: MissingReading;
    let because: string;

    if (onset < ctx.coveredFrom || onset > ctx.coveredTo) {
        reading = "outside";
        because =
            "Beyond where the recording reaches - the performer did not leave this out, " +
            "the recording does not cover it.";
    } else if (ctx.matchedOnsets.has(onset)) {
        reading = "thinned-chord";
        because = `Other notes sounding at this moment were played; ${notes.length} ${
            notes.length === 1 ? "was" : "were"
        } not.`;
    } else if (notes.length > 1) {
        reading = "omitted-passage";
        because = `${notes.length} notes in a row that the recording passes over.`;
    } else {
        reading = "omitted-note";
        because = "One written note that nothing in the recording answers to.";
    }

    return {
        kind: "missing",
        id: group.id,
        scoreIds: notes.map((note) => note.note),
        reading,
        because,
        onset,
        confidence: Math.min(...group.entries.map((entry) => entry.deletion.confidence)),
    };
}
