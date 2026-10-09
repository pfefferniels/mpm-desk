/** What a divergence is, as the rest of the app reads it, and how the reading is tuned. */

import type { NoteSpan } from "../../performance/midiSpans";
import type { ScoreNote } from "../../score/scoreNotes";
import type { OrnamentSign } from "../../mei/ornamentSigns";
import type { DeletedNote, InsertedNote, MatchedNote } from "../mlign";

/** Why a played note has no note in the score. */
export type AddedReading =
    /** The score writes the ornament as a sign; this is the performer playing it */
    | "written-ornament"
    /** An ornamental figure the score does not write */
    | "ornamentation"
    /** Doubling a written note at the octave */
    | "added-octave"
    /** Another tone of the chord that is sounding */
    | "fuller-chord"
    /** A single note of its own, between written ones */
    | "added-note"
    /** A repeat the engraving shows once and the performer played twice */
    | "repeat-pass"
    /** Outside the music: lead-in, a tail, applause, a stray key */
    | "outside";

/** Why a written note was never played. */
export type MissingReading =
    /** Other notes of the same chord were played; this one thinned it */
    | "thinned-chord"
    /** A stretch of the score the recording passes over */
    | "omitted-passage"
    /** One note, on its own */
    | "omitted-note"
    /** Beyond where the recording reaches - not something the performer did */
    | "outside";

/** What was played in place of a written note. */
export type ReplacedReading =
    /** The written note itself, which the aligner failed to pair with it */
    | "unmatched-pair"
    /** A neighbour: the slip of a semitone or a tone that every pianist makes */
    | "neighbour-slip"
    /** The written note, taken in another octave */
    | "octave-displaced"
    /** Some other note in its place */
    | "different-note";

export interface AddedDivergence {
    kind: "added";
    id: string;
    /** The played notes making up this one event, in the order they sound */
    perfIds: string[];
    /** Their pitches, so the figure can be shown without looking the spans up again */
    pitches: number[];
    /** The score note this event decorates or belongs to, where there is one */
    anchorId: string | null;
    /**
     * Where the anchor came from. `timing` is the fallback guess, the last
     * written note struck before the figure, and a poor one for anything that
     * leans on the note it precedes.
     */
    anchorFrom: "model" | "timing" | null;
    /**
     * P(this figure ornaments *that* written note | the alignment paired it with
     * nothing): the head's gate times its ranking. The only form of the head's
     * answer that moves with the anchor, and what goes into the MEI beside
     * `ornamentAnchor`.
     *
     * Stays low where `anchorCorroborated` is set: there an engraved sign, not
     * this number, is why the answer was taken.
     */
    anchorConfidence?: number;
    /** Whether an engraved ornament sign let a ranking the head doubted stand. */
    anchorCorroborated?: boolean;
    /** The sign already on the anchor, which is what `written-ornament` rests on */
    signs: OrnamentSign[];
    reading: AddedReading;
    /** The sentence shown to the reader saying how the reading was arrived at */
    because: string;
    onsetMs: number;
    /** Lowest confidence the model gave any note of the group */
    confidence: number;
}

export interface MissingDivergence {
    kind: "missing";
    id: string;
    /** The score notes, in sounding order */
    scoreIds: string[];
    reading: MissingReading;
    because: string;
    /** Where in the score it falls, in quarter notes */
    onset: number;
    confidence: number;
}

/**
 * One written note and the played note that stood in for it.
 *
 * Both halves are kept, because the edition needs both. In the MEI it becomes a
 * single `<when>` carrying `@data` and `@absolute` at once: the written note,
 * sounding, at a pitch of its own.
 */
export interface ReplacedDivergence {
    kind: "replaced";
    id: string;
    /** The written note, which the recording did not play as written */
    scoreId: string;
    /** What was played in its place */
    perfId: string;
    /** The written pitch and the played one, in that order */
    pitches: [written: number, played: number];
    reading: ReplacedReading;
    because: string;
    /** Where in the score it falls, in quarter notes */
    onset: number;
    /** When the substitute was struck */
    onsetMs: number;
    /** How far the played note fell from where the written one was due */
    lateMs: number;
    confidence: number;
}

export type Divergence = AddedDivergence | MissingDivergence | ReplacedDivergence;

export interface DivergenceOptions {
    /**
     * How long a silence ends a figure, in milliseconds. Notes of one ornament
     * follow each other far faster than this; separate events do not.
     */
    gapMs?: number;
    /** How close two notes must be to count as struck together */
    simultaneousMs?: number;
    /** How many notes a figure needs before it reads as ornamentation */
    figureNotes?: number;
    /** Whether the score writes a repeat with signs rather than writing it out */
    hasRepeats?: boolean;
    /**
     * How long a silence ends a figure whose notes the model has all put on the
     * same written note. Far wider than `gapMs`: the model saying so is better
     * evidence than the timing, and a broad ornament on an early recording runs
     * to half a second and more.
     */
    attributedGapMs?: number;
    /**
     * How sure the head must be before its answer is taken: gate times ranking,
     * i.e. P(this elaborates *that* written note | the decode called it an
     * insertion). Mirrors MLign's `ORNAMENT_MIN_PROB`; the two move together.
     *
     * Deliberately not the whole row's mass, which carries P(insertion) and with
     * it the match head's opinion. Every note asked about here is one the decode
     * tried to pair and could not, so that opinion is not evidence. Letting it in
     * silences 48.8% of ornament figures on real Batik, where the head would have
     * named the right written note for 85% of them.
     *
     * .2 measured best of eight rules swept on both real corpora. Against a gate
     * thresholded at .5 it wins on whole-figure accuracy (.3730 → .3757 on Batik)
     * and on false positives (.0902 → .0891) at once, with ASAP moving the same
     * way and nothing worse anywhere.
     */
    attributionPosterior?: number;
    /**
     * The bar when the score corroborates the head, the anchor carrying an
     * ornament sign already. Lower, and measured on the ranking alone: the sign
     * has answered whether there is an ornament, so the gate is left out.
     */
    attributionShare?: number;
    /**
     * How far from where a written note was due a played note may fall and still
     * read as standing in for it. Wider than `simultaneousMs` because the moment
     * is interpolated from the notes around it rather than measured, and narrow
     * enough to stay inside the beat at any reasonable tempo.
     */
    replacementMs?: number;
    /**
     * How far a substitute may lie from the note it replaced. An octave: beyond
     * that the two read as two things that happened rather than one thing that
     * went differently.
     */
    replacementSemitones?: number;
}

export const DEFAULTS = {
    gapMs: 250,
    simultaneousMs: 50,
    figureNotes: 3,
    hasRepeats: false,
    attributedGapMs: 1000,
    attributionPosterior: 0.2,
    attributionShare: 0.5,
    replacementMs: 200,
    replacementSemitones: 12,
};

/** Every option, filled in. */
export type DivergenceSettings = typeof DEFAULTS;

export interface DivergenceInput {
    matches: readonly MatchedNote[];
    deletions: readonly DeletedNote[];
    insertions: readonly InsertedNote[];
    scoreNotes: readonly ScoreNote[];
    spans: readonly NoteSpan[];
    signs: ReadonlyMap<string, OrnamentSign[]>;
}
