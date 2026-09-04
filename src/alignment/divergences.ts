/**
 * What the score and the performance disagree about, grouped into things a
 * reader can act on.
 *
 * The aligner's flat lists are unusable as they stand: a trill alone contributes
 * a dozen unmatched played notes, with nothing to show they are one event.
 *
 * Substitutions are the aligner's blind spot. It labels every note matched or
 * unmatched, so a written note played as a different note arrives as a missing
 * note here and an added note there. They are paired back up before anything is
 * read.
 *
 * Every divergence carries a proposed reading and its reason; the reader
 * confirms or overrules.
 */

import type { NoteSpan } from "../performance/midiSpans";
import type { ScoreNote } from "../score/scoreNotes";
import type { OrnamentSign } from "../mei/ornamentSigns";
import type { DeletedNote, InsertedNote, MatchedNote } from "./mlign";

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

const DEFAULTS = {
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

export interface DivergenceInput {
    matches: readonly MatchedNote[];
    deletions: readonly DeletedNote[];
    insertions: readonly InsertedNote[];
    scoreNotes: readonly ScoreNote[];
    spans: readonly NoteSpan[];
    signs: ReadonlyMap<string, OrnamentSign[]>;
}

/** A matched note, as both a moment in the score and a moment in the recording. */
interface Anchor {
    scoreId: string;
    /** Where the score puts it, in quarter notes */
    onset: number;
    /** When it was played */
    onsetMs: number;
    pitch: number;
}

interface PlayedGroup {
    /** {@link divergenceId} of the first note in it. */
    id: string;
    entries: { insertion: InsertedNote; span: NoteSpan }[];
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

/** The head's answer about one played note, once it has been believed. */
interface AcceptedAnchor {
    scoreId: string;
    /** P(it elaborates a written note at all), the decode having called it an insertion */
    gate: number;
    /** Of the mass on elaborating anything, the part on this one written note */
    share: number;
    /**
     * `gate * share`: P(it elaborates THAT written note | it is an insertion).
     * The only one of the three that moves with the anchor, so the one both
     * decided on and written down.
     */
    posterior: number;
    /** Whether an ornament sign the score already writes is what let it in */
    corroborated: boolean;
}

/**
 * Which of the head's answers to take, and on what evidence.
 *
 * Two routes, because the head's two numbers can come apart. The posterior is
 * enough on its own; short of it, a clear ranking is enough when the score
 * already writes an ornament sign on the note the head named, the sign having
 * answered the question the head was unsure of. The route is chosen per note by
 * what the numbers are, never by which checkpoint produced them.
 *
 * The posterior is the head's own two factors, not the whole row's mass. Every
 * note here is one the decode tried to pair and could not, so `P(insertion)` is
 * settled and not evidence to weigh again. Carrying it lets the match head veto
 * answers it was never asked for, silencing 48.8% of ornament figures on real
 * Batik; taking it out is worth whole-figure accuracy .1919 → .3297 there, on
 * the shipped checkpoint and with no new model.
 *
 * Batik is the only clean corpus to read this on: 209 of real ASAP's 225 rows
 * are performances the match head trained on, leaving 36 clean figures.
 *
 * Both factors rather than the gate alone, since a confident gate over a flat
 * ranking is how a played note that ornaments nothing acquires an anchor.
 */
function acceptAttribution(
    insertion: InsertedNote,
    signs: ReadonlyMap<string, OrnamentSign[]>,
    minPosterior: number,
    minShare: number
): AcceptedAnchor | undefined {
    const named = insertion.ornamentOf;
    if (!named) return undefined;

    const answer = {
        scoreId: named.scoreId,
        gate: named.gate,
        share: named.share,
        posterior: named.gate * named.share,
    };

    if (answer.posterior >= minPosterior) return { ...answer, corroborated: false };
    if (named.share >= minShare && (signs.get(named.scoreId)?.length ?? 0) > 0) {
        return { ...answer, corroborated: true };
    }
    return undefined;
}

interface UnplayedGroup {
    /** {@link divergenceId} of the first note in it. */
    id: string;
    entries: { deletion: DeletedNote; note: ScoreNote }[];
}

/**
 * Group, pair, anchor and read every disagreement.
 *
 * The order is load-bearing. Both sides are grouped into events first, because
 * only whole events can be compared. Substitutions are then paired off and taken
 * out of both lists, so the same moment is not reported twice. Only what is left
 * is anchored and read: three notes a semitone apart are a trill only once you
 * know which written note they surround.
 */
export function divergencesOf(
    input: DivergenceInput,
    options: DivergenceOptions = {}
): Divergence[] {
    const settings = { ...DEFAULTS, ...options };

    const spanById = new Map(input.spans.map((span) => [span.id, span]));
    const scoreById = new Map(input.scoreNotes.map((note) => [note.note, note]));

    // The time map: what each matched score note turned into when it was played.
    const anchors: Anchor[] = [];
    for (const match of input.matches) {
        const span = spanById.get(match.performanceId);
        const note = scoreById.get(match.scoreId);
        if (span && note) {
            anchors.push({
                scoreId: match.scoreId,
                onset: note.onset,
                onsetMs: span.onsetMs,
                pitch: note.pitch,
            });
        }
    }
    anchors.sort((a, b) => a.onsetMs - b.onsetMs);

    // Where the recording reaches. A score note outside it was not left out by
    // the performer, and reporting it as such invents a musical fact.
    const firstMs = anchors.length > 0 ? anchors[0].onsetMs : Infinity;
    const lastMs = anchors.length > 0 ? anchors[anchors.length - 1].onsetMs : -Infinity;

    // Once: the grouping, the pairing and the reading all need the same answer
    // and must not be able to disagree about it.
    const accepted = new Map<string, AcceptedAnchor>();
    for (const insertion of input.insertions) {
        const answer = acceptAttribution(
            insertion,
            input.signs,
            settings.attributionPosterior,
            settings.attributionShare
        );
        if (answer) accepted.set(insertion.performanceId, answer);
    }

    const played = groupPlayed(
        input,
        spanById,
        anchors,
        accepted,
        settings.gapMs,
        settings.attributedGapMs
    );
    const unplayed = groupUnplayed(input, scoreById);

    const { replaced, playedLeft, unplayedLeft } = pairReplacements(
        played,
        unplayed,
        timeMapOf(anchors),
        accepted,
        settings
    );

    const ctx: AddedContext = {
        anchors,
        anchorByScoreId: new Map(anchors.map((anchor) => [anchor.scoreId, anchor])),
        scoreById,
        accepted,
        firstMs,
        lastMs,
        simultaneousMs: settings.simultaneousMs,
        figureNotes: settings.figureNotes,
        hasRepeats: settings.hasRepeats,
    };

    const missingCtx = missingContextOf(input, scoreById, anchors.length > 0);

    return [
        ...replaced,
        ...playedLeft.map((group) => readPlayed(group, input, ctx)),
        ...unplayedLeft.map((group) => readUnplayed(group, missingCtx)),
    ];
}


/**
 * Played notes with no score note, gathered into events.
 *
 * A run with no real silence between its notes, all leaning on the same written
 * note, is one event however many notes it holds.
 */
function groupPlayed(
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
function groupUnplayed(
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


/** Matched notes as (score time, performed time), for reading between them. */
function timeMapOf(anchors: Anchor[]): { onset: number; ms: number }[] {
    return anchors
        .map((anchor) => ({ onset: anchor.onset, ms: anchor.onsetMs }))
        .sort((a, b) => a.onset - b.onset);
}

/**
 * When a written note was due, in the recording's own time.
 *
 * Read off the matched notes on either side of it. A moment the matched notes do
 * not bracket has no answer: the recording says nothing about it, and a guess
 * extrapolated past the last note it does cover would be an invention.
 */
function expectedMs(
    onset: number,
    map: readonly { onset: number; ms: number }[]
): number | undefined {
    if (map.length === 0) return undefined;
    if (onset < map[0].onset || onset > map[map.length - 1].onset) return undefined;

    let low = 0;
    let high = map.length - 1;
    while (low < high - 1) {
        const mid = (low + high) >> 1;
        if (map[mid].onset <= onset) low = mid;
        else high = mid;
    }

    const before = map[low];
    const after = map[high];
    if (after.onset === before.onset) return before.ms;

    const t = (onset - before.onset) / (after.onset - before.onset);
    return before.ms + t * (after.ms - before.ms);
}

/**
 * Match up the halves of a substitution.
 *
 * A written note that went unplayed and a played note that answered to nothing
 * are one event when the second falls where the first was due. Only single notes
 * are paired: a run of played notes against a run of written ones is a passage
 * played differently, which is a larger claim than this should make on its own.
 *
 * Pairs are taken cheapest first, and each half may be used once, so the closest
 * reading wins and nothing is counted twice.
 */
function pairReplacements(
    played: PlayedGroup[],
    unplayed: UnplayedGroup[],
    map: { onset: number; ms: number }[],
    accepted: ReadonlyMap<string, AcceptedAnchor>,
    settings: typeof DEFAULTS
): { replaced: ReplacedDivergence[]; playedLeft: PlayedGroup[]; unplayedLeft: UnplayedGroup[] } {
    const candidates: {
        playedIndex: number;
        unplayedIndex: number;
        lateMs: number;
        semitones: number;
        cost: number;
    }[] = [];

    // A played note the model has already accounted for is not a loose half
    // looking for a partner. Falling at the moment a written note was due is a
    // coincidence; being named as that note's ornament is an answer, and the
    // reader can still overrule it at the note itself.
    const singles = played
        .map((group, index) => ({ group, index }))
        .filter(
            (entry) =>
                entry.group.entries.length === 1 &&
                !accepted.has(entry.group.entries[0].span.id)
        );

    unplayed.forEach((group, unplayedIndex) => {
        if (group.entries.length !== 1) return;

        const written = group.entries[0].note;
        const due = expectedMs(written.onset, map);
        if (due === undefined) return;

        for (const { group: candidate, index: playedIndex } of singles) {
            const span = candidate.entries[0].span;
            const lateMs = span.onsetMs - due;
            const semitones = span.pitch - written.pitch;

            if (Math.abs(lateMs) > settings.replacementMs) continue;
            if (Math.abs(semitones) > settings.replacementSemitones) continue;

            candidates.push({
                playedIndex,
                unplayedIndex,
                lateMs,
                semitones,
                cost:
                    Math.abs(lateMs) / settings.replacementMs +
                    Math.abs(semitones) / (settings.replacementSemitones + 1),
            });
        }
    });

    candidates.sort((a, b) => a.cost - b.cost);

    const usedPlayed = new Set<number>();
    const usedUnplayed = new Set<number>();
    const replaced: ReplacedDivergence[] = [];

    for (const candidate of candidates) {
        if (usedPlayed.has(candidate.playedIndex)) continue;
        if (usedUnplayed.has(candidate.unplayedIndex)) continue;
        usedPlayed.add(candidate.playedIndex);
        usedUnplayed.add(candidate.unplayedIndex);

        const { insertion, span } = played[candidate.playedIndex].entries[0];
        const { deletion, note } = unplayed[candidate.unplayedIndex].entries[0];
        const { reading, because } = readReplaced(candidate.semitones, candidate.lateMs);

        replaced.push({
            kind: "replaced",
            id: `replaced-${unplayed[candidate.unplayedIndex].id}`,
            scoreId: note.note,
            perfId: span.id,
            pitches: [note.pitch, span.pitch],
            reading,
            because,
            onset: note.onset,
            onsetMs: span.onsetMs,
            lateMs: candidate.lateMs,
            confidence: Math.min(insertion.confidence, deletion.confidence),
        });
    }

    replaced.sort((a, b) => a.onsetMs - b.onsetMs);

    return {
        replaced,
        playedLeft: played.filter((_, index) => !usedPlayed.has(index)),
        unplayedLeft: unplayed.filter((_, index) => !usedUnplayed.has(index)),
    };
}

function readReplaced(
    semitones: number,
    lateMs: number
): { reading: ReplacedReading; because: string } {
    const where = `where the score writes it${
        Math.abs(lateMs) < 20 ? "" : `, ${Math.abs(lateMs).toFixed(0)} ms ${lateMs > 0 ? "late" : "early"}`
    }`;

    if (semitones === 0) {
        return {
            reading: "unmatched-pair",
            because:
                `The written note itself, played ${where}, which the aligner did not ` +
                `pair with it. Nothing was added and nothing left out; the alignment ` +
                `simply has a hole here.`,
        };
    }

    if (semitones % 12 === 0) {
        const octaves = Math.abs(semitones) / 12;
        return {
            reading: "octave-displaced",
            because:
                `The written note taken ${octaves === 1 ? "an octave" : `${octaves} octaves`} ` +
                `${semitones > 0 ? "higher" : "lower"}, played ${where}.`,
        };
    }

    if (Math.abs(semitones) <= 2) {
        return {
            reading: "neighbour-slip",
            because:
                `${intervalWords(semitones)} the written note, played ${where}. ` +
                `A neighbour struck instead of the note itself is the commonest slip there is.`,
        };
    }

    return {
        reading: "different-note",
        because: `${intervalWords(semitones)} the written note, played ${where}.`,
    };
}

/** How far off a substitute was, said in words rather than in semitones. */
function intervalWords(semitones: number): string {
    const distance = Math.abs(semitones);
    const size =
        distance === 1
            ? "A semitone"
            : distance === 2
              ? "A tone"
              : `${distance} semitones`;
    return `${size} ${semitones > 0 ? "above" : "below"}`;
}


interface AddedContext {
    anchors: Anchor[];
    /** The matched notes again, by id, for looking an attributed anchor up */
    anchorByScoreId: Map<string, Anchor>;
    scoreById: Map<string, ScoreNote>;
    /** The head's answers, already judged sure enough to act on */
    accepted: ReadonlyMap<string, AcceptedAnchor>;
    firstMs: number;
    lastMs: number;
    simultaneousMs: number;
    figureNotes: number;
    hasRepeats: boolean;
}

/**
 * The written note a figure belongs to, and where that answer came from.
 *
 * The model's answer wins wherever there is one: it answers which written note
 * this decorates, where the timing can only answer which was struck last.
 *
 * An anchor that itself went unplayed has no performed moment, so `onsetMs` is
 * NaN and every comparison against it is false. Which is right: nothing can be
 * said about two notes being struck together when one never was.
 */
function anchorOf(
    group: PlayedGroup,
    ctx: AddedContext
): {
    anchor: Anchor | undefined;
    from: "model" | "timing" | null;
    gate?: number;
    posterior?: number;
    corroborated?: boolean;
} {
    const named = ctx.accepted.get(group.entries[0].span.id);
    if (named) {
        const said = {
            from: "model",
            gate: named.gate,
            posterior: named.posterior,
            corroborated: named.corroborated,
        } as const;

        const matched = ctx.anchorByScoreId.get(named.scoreId);
        if (matched) return { anchor: matched, ...said };

        const note = ctx.scoreById.get(named.scoreId);
        if (note) {
            return {
                anchor: {
                    scoreId: note.note,
                    onset: note.onset,
                    onsetMs: Number.NaN,
                    pitch: note.pitch,
                },
                ...said,
            };
        }
    }

    const guessed = anchorFor(group.entries[0].span.onsetMs, ctx.anchors);
    return { anchor: guessed, from: guessed ? "timing" : null };
}

function readPlayed(
    group: PlayedGroup,
    input: DivergenceInput,
    ctx: AddedContext
): AddedDivergence {
    const spans = group.entries.map((entry) => entry.span);
    const onsetMs = spans[0].onsetMs;
    const { anchor, from, gate, posterior, corroborated } = anchorOf(group, ctx);
    const signs = anchor ? input.signs.get(anchor.scoreId) ?? [] : [];

    const { reading, because } = readAdded(
        spans,
        anchor,
        signs,
        ctx,
        from === "model"
            ? { gate: gate ?? 0, posterior: posterior ?? 0, corroborated: !!corroborated }
            : undefined
    );

    return {
        kind: "added",
        id: group.id,
        perfIds: spans.map((span) => span.id),
        pitches: spans.map((span) => span.pitch),
        anchorId: anchor?.scoreId ?? null,
        anchorFrom: anchor ? from : null,
        ...(from === "model" && posterior !== undefined
            ? { anchorConfidence: posterior, anchorCorroborated: !!corroborated }
            : {}),
        signs,
        reading,
        because,
        onsetMs,
        confidence: Math.min(...group.entries.map((entry) => entry.insertion.confidence)),
    };
}

/**
 * The written note a played note leans on: the last one struck at or before it.
 *
 * A figure that leans on the *following* note, a turn played just before the
 * beat it decorates, is left anchored to the note before it. Guessing between
 * the two on timing alone would be less honest than showing where the sound
 * sits, and the reader can move it.
 */
function anchorFor(onsetMs: number, anchors: Anchor[]): Anchor | undefined {
    let low = 0;
    let high = anchors.length - 1;
    let found: Anchor | undefined;

    while (low <= high) {
        const mid = (low + high) >> 1;
        if (anchors[mid].onsetMs <= onsetMs) {
            found = anchors[mid];
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return found;
}

function readAdded(
    spans: NoteSpan[],
    anchor: Anchor | undefined,
    signs: OrnamentSign[],
    ctx: AddedContext,
    attributed?: { gate: number; posterior: number; corroborated: boolean }
): { reading: AddedReading; because: string } {
    const onsetMs = spans[0].onsetMs;

    if (onsetMs < ctx.firstMs || onsetMs > ctx.lastMs) {
        return {
            reading: "outside",
            because: "Played before the first or after the last note the score accounts for.",
        };
    }

    if (anchor && signs.length > 0) {
        const names = [...new Set(signs.map((sign) => sign.name))].join(" and ");
        return {
            reading: "written-ornament",
            because:
                `The score writes a ${names} on this note. Verovio reads an ornament sign as ` +
                `the single note it is written on, so the rest of what was played has no note ` +
                `to match - these are that ornament, performed.` +
                (attributed === undefined
                    ? ""
                    : attributed.corroborated
                      ? ` The model puts ${
                            spans.length === 1 ? "this note" : `all ${spans.length} notes`
                        } on that written note too - it ranks it clearly ahead of every other, ` +
                        `though it is only ${Math.round(attributed.gate * 100)}% sure they ` +
                        `are ornaments at all. The sign is what settles that.`
                      : ` The model puts ${
                            spans.length === 1 ? "this note" : `all ${spans.length} notes`
                        } on that written note as well, ${Math.round(
                            attributed.posterior * 100
                        )}% sure.`),
        };
    }

    // The model was asked which written note this decorates, and answered. That
    // is a different question from the alignment's, and the only evidence here
    // that is about ornamentation rather than about counting and proximity.
    if (anchor && attributed !== undefined) {
        return {
            reading: "ornamentation",
            because:
                `The model reads ${
                    spans.length === 1 ? "this note" : `these ${spans.length} notes`
                } as ornamenting a written note, ${Math.round(attributed.posterior * 100)}% ` +
                `sure, and the score writes no ornament there. It has only ever been taught ` +
                `this on rendered performances, so it is worth looking at.`,
        };
    }

    if (spans.length >= ctx.figureNotes && anchor && nearAnchor(spans, anchor)) {
        return {
            reading: "ornamentation",
            because:
                `${spans.length} notes played quickly around a written note, none more than a ` +
                `few semitones from it, and the score writes no ornament here.`,
        };
    }

    if (anchor && Math.abs(onsetMs - anchor.onsetMs) <= ctx.simultaneousMs) {
        const interval = spans[0].pitch - anchor.pitch;
        if (Math.abs(interval) % 12 === 0 && interval !== 0) {
            const octaves = Math.abs(interval) / 12;
            return {
                reading: "added-octave",
                because:
                    `Struck with a written note, ` +
                    `${octaves === 1 ? "an octave" : `${octaves} octaves`} ` +
                    `${interval > 0 ? "above" : "below"} it.`,
            };
        }
        return {
            reading: "fuller-chord",
            because: "Struck with a written note, at another tone of the chord.",
        };
    }

    if (ctx.hasRepeats) {
        return {
            reading: "repeat-pass",
            because:
                "The score writes its repeats with repeat signs rather than writing them out, " +
                "so everything played on a second pass has no note of its own to match.",
        };
    }

    return {
        reading: "added-note",
        because: "A note of its own, between written ones.",
    };
}

/** Whether a figure stays within a few semitones of the note it surrounds. */
function nearAnchor(spans: NoteSpan[], anchor: Anchor): boolean {
    return spans.every((span) => Math.abs(span.pitch - anchor.pitch) <= 4);
}

interface MissingContext {
    /** Score moments the recording answered to at all */
    matchedOnsets: Set<number>;
    /** Whether the recording covers a moment, judged from the notes around it */
    coveredFrom: number;
    coveredTo: number;
}

function missingContextOf(
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

function readUnplayed(group: UnplayedGroup, ctx: MissingContext): MissingDivergence {
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
