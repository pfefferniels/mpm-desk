/**
 * What each kind of disagreement is called, and what may be done about it.
 *
 * Kept apart from any component because the score is now the only place these
 * are decided: the popover that opens on a notehead needs them, and so does the
 * pass that carries the decisions into the document.
 */

import type {
    AddedReading,
    Divergence,
    MissingReading,
    ReplacedReading,
} from "../../alignment/divergences";

/** What the reader wants done about a divergence. */
export type Action =
    /** Keep it in the recording and leave the notation alone */
    | "record"
    /** Write the played notes into the score, as a performance reading */
    | "write-notes"
    /** Write the note that was played instead, as a performance reading */
    | "write-variant"
    /** Put an ornament sign on the note that was decorated */
    | "add-sign"
    /** Mark the unplayed notes as a simplification */
    | "mark-simplification"
    /** Take the played note for the written one: the aligner missed the match */
    | "count-as-played"
    /** Not about the music at all */
    | "ignore";

export interface Resolution {
    reading: string;
    action: Action;
}

export interface Attribution {
    resp: string;
    certainty: string;
}

export const CERTAINTIES = ["high", "medium", "low", "unknown"];

/** The name each family goes by, in the score and in the popover. */
export const ADDED_LABELS: Record<AddedReading, string> = {
    "written-ornament": "An ornament the score already writes",
    ornamentation: "Ornamentation the score does not write",
    "added-octave": "An octave doubled",
    "fuller-chord": "The chord filled out",
    "added-note": "A note added",
    "repeat-pass": "Played on a repeat the engraving shows once",
    outside: "Outside the music",
};

export const MISSING_LABELS: Record<MissingReading, string> = {
    "thinned-chord": "The chord thinned",
    "omitted-passage": "A passage passed over",
    "omitted-note": "A note not played",
    outside: "Beyond where the recording reaches",
};

export const REPLACED_LABELS: Record<ReplacedReading, string> = {
    "unmatched-pair": "Played as written, and matched to nothing",
    "neighbour-slip": "A neighbouring note played instead",
    "octave-displaced": "Played in another octave",
    "different-note": "A different note played instead",
};

export const labelOf = (divergence: Divergence): string =>
    divergence.kind === "added"
        ? ADDED_LABELS[divergence.reading]
        : divergence.kind === "missing"
          ? MISSING_LABELS[divergence.reading]
          : REPLACED_LABELS[divergence.reading];

/**
 * What may be done about each family, first entry first.
 *
 * A written ornament offers nothing but `record`: the score already says the
 * note is ornamented, and the only new fact is how it was played this time,
 * which belongs in the recording. Offering to "add" those notes would invite
 * writing a trill out as notation, which is not what the sign means.
 *
 * A pair the aligner failed to make is the one family whose first offer is not
 * `record`, because there is nothing musical to record: the note was played as
 * written and only the alignment says otherwise, so the useful thing to do is
 * mend the alignment.
 */
export const ACTIONS: Record<string, Action[]> = {
    "written-ornament": ["record"],
    ornamentation: ["record", "add-sign", "write-notes"],
    "added-octave": ["record", "write-notes"],
    "fuller-chord": ["record", "write-notes"],
    "added-note": ["record", "write-notes"],
    "repeat-pass": ["record", "ignore"],
    "thinned-chord": ["record", "mark-simplification"],
    "omitted-note": ["record", "mark-simplification"],
    "omitted-passage": ["record", "mark-simplification"],
    "unmatched-pair": ["count-as-played", "record"],
    "neighbour-slip": ["record", "write-variant", "count-as-played"],
    "octave-displaced": ["record", "write-variant"],
    "different-note": ["record", "write-variant"],
    outside: ["ignore", "record"],
};

export const ACTION_LABELS: Record<Action, string> = {
    record: "Record only",
    "write-notes": "Write into the score",
    "write-variant": "Write the played note as a variant",
    "add-sign": "Add an ornament sign",
    "mark-simplification": "Mark as a simplification",
    "count-as-played": "Count as played",
    ignore: "Ignore",
};

/**
 * What a divergence does if nobody says otherwise: whatever its family offers
 * first.
 *
 * Which is `record` almost everywhere - everything is recorded and nothing is
 * written, because an edition is not changed because an aligner proposed
 * something. The exceptions are the two families that are not about the music:
 * what falls outside the recording is ignored, and a pair the aligner failed to
 * make is simply made.
 */
export const defaultAction = (divergence: Divergence): Action =>
    ACTIONS[divergence.reading]?.[0] ?? "record";

/**
 * Whether a decision would change the notation, rather than only the recording.
 *
 * `count-as-played` does not: it says two things the aligner kept apart are one
 * note, which is a fact about the matching and belongs in the <recording> like
 * every other match.
 */
const NOTATION_ACTIONS = new Set<Action>([
    "write-notes",
    "write-variant",
    "add-sign",
    "mark-simplification",
]);

export const changesNotation = (action: Action): boolean => NOTATION_ACTIONS.has(action);

/** How many notes in a row the recording must pass over before it is a passage. */
export const PASSAGE_NOTES = 3;

/**
 * Whether a divergence is a stretch of music the performer went past, rather
 * than a note or two missing from something that did sound.
 *
 * This is what earns a bracket in the score, and the two exclusions are the
 * point of it. A thinned chord is not a passage however many notes it loses:
 * they stand one above another at a moment that *was* played, so they are
 * perfectly legible where they are and bracketing them would say the music
 * stopped. And what falls beyond where the recording reaches is not something
 * the performer did at all.
 */
export const isOmittedPassage = (divergence: Divergence): boolean =>
    divergence.kind === "missing" &&
    divergence.reading === "omitted-passage" &&
    divergence.scoreIds.length >= PASSAGE_NOTES;

export function timestamp(ms: number): string {
    const seconds = ms / 1000;
    return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}
