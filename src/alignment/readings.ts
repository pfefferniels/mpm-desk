/**
 * What each kind of disagreement is called, and what may be done about it.
 *
 * Kept apart from any component because the score is only where these are *decided*: the popover
 * that opens on a notehead needs them, and so does the pass that carries the decisions into the
 * MEI.
 *
 * And so does the work file. An {@link Action} is the one part of a reader's decision the MEI
 * cannot hold — `applyAlignment` writes the reading, the responsibility and the certainty into the
 * `<when>`, and nothing there says what was to be *done* — so the work file records it, and this
 * is the vocabulary it records it in. That is why this sits beside `divergences.ts` rather than
 * beside the desk: `src/model` reads it, and the document may not depend on a desk.
 */

import type {
    AddedReading,
    Divergence,
    MissingReading,
    ReplacedReading,
} from "./divergences";
import type { Notation } from "./transcription";

/**
 * What the reader wants done about a divergence, where they have said.
 *
 * Saying nothing is the ordinary case and means: transcribe it. Every divergence is written into
 * the score as soon as the alignment has been made, read rhythmically and by pitch by
 * `./transcription`, and an action is only ever a correction of that reading.
 */
export type Action =
    /** Keep it in the recording and leave the notation alone */
    | "record"
    /** Write the played notes into the score as measured notes */
    | "write-notes"
    /** Write them as grace notes, leaning on whatever sounds next */
    | "write-graces"
    /** Write the note that was played instead, as a performance reading */
    | "write-variant"
    /** Put an ornament sign on the note that was decorated */
    | "add-sign"
    /** Take the unplayed notes out of the performance reading */
    | "mark-simplification"
    /** Take the played note for the written one: the aligner missed the match */
    | "count-as-played"
    /** Not about the music at all */
    | "ignore";

export interface Resolution {
    reading: string;
    action: Action;
}

/**
 * The notation an action asks the transcriber for.
 *
 * `auto` for everything that is not a correction: no decision at all, and the two actions that
 * name what the transcriber does anyway.
 */
export const notationOf = (action: Action | undefined): Notation =>
    action === "write-notes"
        ? "measured"
        : action === "write-graces"
          ? "grace"
          : action === "add-sign"
            ? "sign"
            : action === "count-as-played"
              ? "as-written"
              : action === "record" || action === "ignore"
                ? "none"
                : "auto";

/** The action that asks for a notation, which is what the work file keeps. */
export const actionFor = (divergence: Divergence, notation: Notation): Action => {
    if (notation === "none") return "record";
    if (divergence.kind === "missing") return "mark-simplification";
    if (divergence.kind === "replaced") {
        return notation === "as-written" ? "count-as-played" : "write-variant";
    }
    return notation === "grace" ? "write-graces" : notation === "sign" ? "add-sign" : "write-notes";
};

/**
 * What each way of writing a divergence is called, on the button that asks for it.
 *
 * By kind. A note that was played has three ways of being in the score and no way of not being
 * in it; a written note that was not played is taken out or, where the reader knows better than
 * the alignment, kept.
 */
export const choiceLabel = (divergence: Divergence, notation: Notation): string => {
    if (divergence.kind === "missing") return notation === "none" ? "Kept" : "Taken out";
    if (divergence.kind === "replaced") return "Played";
    return notation === "grace" ? "Grace" : notation === "sign" ? "Sign" : "Notes";
};

/** What the row of choices is headed, which for a note left out is not a way of writing it. */
export const choiceHeading = (divergence: Divergence): string =>
    divergence.kind === "missing" ? "In the score as played" : "Written as";

/** The name each family goes by, in the score and in the popover. */
const ADDED_LABELS: Record<AddedReading, string> = {
    "written-ornament": "An ornament the score already writes",
    ornamentation: "Ornamentation the score does not write",
    "added-octave": "An octave doubled",
    "fuller-chord": "The chord filled out",
    "added-note": "A note added",
    "repeat-pass": "Played on a repeat the engraving shows once",
    outside: "Outside the music",
};

const MISSING_LABELS: Record<MissingReading, string> = {
    "thinned-chord": "The chord thinned",
    "omitted-passage": "A passage passed over",
    "omitted-note": "A note not played",
    outside: "Beyond where the recording reaches",
};

const REPLACED_LABELS: Record<ReplacedReading, string> = {
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

/** How many notes in a row the recording must pass over before it is a passage. */
const PASSAGE_NOTES = 3;

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
