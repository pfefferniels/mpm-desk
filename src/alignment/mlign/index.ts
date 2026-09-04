/**
 * MLign as the rest of the app sees it.
 *
 * The modules beside this one port the Python reference and speak its
 * vocabulary: note tables in PPQ ticks and milliseconds, windows, logit bundles,
 * triples over table indices. The UI has `ScoreNote`s and `NoteSpan`s and wants
 * pairs of ids. This is where the two vocabularies meet, and the only module of
 * `src/mlign/` the UI imports.
 *
 * onnxruntime-web is reached through a dynamic `import()`, so neither the
 * runtime nor the 3.1 MB of weights is fetched until someone aligns something.
 * Keep it that way: a static import would pull the runtime into the route's
 * first chunk.
 */

import { accumulateLogits } from "./accumulate";
import { attributionsOf } from "./attribution";
import { decode } from "./decode";
import { tablesToRow } from "./featurize";
import { modelUrl as urlOfModel } from "./models";
import { planWindows } from "./windows";
import { MARKER_PITCH, MAX_SINGLE_TOKENS } from "./types";
import type { PerfNote, ScoreNote as ModelNote, SimBundle } from "./types";
import type { MlignModelId } from "./models";
import type { MlignSession } from "./session";
import type { Match } from "../types";
import type { ScoreNote } from "../../score/scoreNotes";
import type { NoteSpan } from "../../performance/midiSpans";

/**
 * The largest window the WASM build can forward.
 *
 * The relative-position bias is a dense `(1, H, T, T)` tensor and ORT's heap is
 * 32-bit, so a long enough sequence dies as a `std::bad_alloc` somewhere above
 * T = 12000. `planWindows` cuts the score at 384 notes, so only a window whose
 * performance range ran away can reach this — but such a window is a hang
 * rather than an error unless it is caught first.
 */
export const MAX_WINDOW_TOKENS = 12000;

/**
 * The largest similarity matrix worth allocating, in cells.
 *
 * `sim` is one `Float32Array(n * m)` and the decode builds more of the same
 * shape, but do not read that as twelve bytes a cell: the peak at this guard was
 * *measured* at 284–636 MB depending on the input, worst case a table all on one
 * pitch (585 MB at 3464 x 3464). The most a desktop tab can be asked to survive,
 * not a comfortable ceiling, and still far above a movement against its
 * recording at a couple of million cells (the demo file is 0.22 M).
 */
export const MAX_CELLS = 12_000_000;

/** Pitches the model has an embedding for. `MARKER_PITCH` (128) is the marker's. */
const MIN_PITCH = 0;
const MAX_PITCH = MARKER_PITCH;

/**
 * Thrown when the performance does not look like a recording of the score.
 *
 * Not an ordinary failure: the alignment would run, slowly, and return
 * something meaningless. The caller is expected to offer the reader the choice
 * of running it anyway, which is `AlignOptions.allowMismatch`.
 */
export class MismatchedPairError extends Error {
    readonly code = "mlign/mismatched-pair";
    constructor(
        message: string,
        /** Windows the piece was cut into, and how many found nothing to line up on. */
        readonly windows: number,
        readonly unanchored: number
    ) {
        super(message);
        this.name = "MismatchedPairError";
    }
}

/** Which part of the alignment is running. */
export type AlignStage = "loading" | "featurizing" | "running" | "decoding";

/** Where the alignment has got to, for a progress display. */
export interface AlignProgress {
    stage: AlignStage;
    /** Windows finished and windows planned. Only the "running" stage has them. */
    done?: number;
    total?: number;
}

/** A score note and the performed note it was matched to. */
export interface MatchedNote {
    scoreId: string;
    performanceId: string;
    /** The model's confidence in this pair, in [0, 1]. */
    confidence: number;
}

/** A score note nothing in the performance was matched to — a deletion. */
export interface DeletedNote {
    scoreId: string;
    /** How sure the model is that this note went unplayed, in [0, 1]. */
    confidence: number;
}

/** A performed note nothing in the score was matched to — an insertion. */
export interface InsertedNote {
    performanceId: string;
    confidence: number;
    /**
     * The written note the model says this one ornaments, when it says so.
     *
     * A separate answer from the alignment: the match head is trained to send an
     * ornament note to the null column, so a note being an insertion and a note
     * decorating a written note are compatible facts.
     *
     * Three numbers meaning different things. `confidence` is that this is an
     * ornament and that it is that note's. `gate` is the first half with the
     * match head taken back out, the half that still means something once the
     * decode has called this note an insertion. `share` is the second half: if
     * it ornaments anything then it is that note.
     *
     * Absent only when the model has no attribution head, or when no window
     * covered this note. All three are reported rather than chosen between:
     * what counts as sure enough is `../divergences`'s judgement. See
     * `./attribution`.
     */
    ornamentOf?: { scoreId: string; confidence: number; share: number; gate: number };
}

/** What the alignment cost, for a status line and for reporting. */
export interface AlignStats {
    scoreNotes: number;
    performedNotes: number;
    /** Notes left out because nothing readable could be made of them. */
    skippedScoreNotes: number;
    skippedPerformedNotes: number;
    /** Windows the piece was cut into; 1 means it went through whole. */
    windows: number;
    /** The largest `2 + n + m` any single window carried. */
    maxTokens: number;
    /** Wall clock per stage, in milliseconds. */
    timings: Record<AlignStage, number>;
}

export interface AlignResult {
    matches: MatchedNote[];
    deletions: DeletedNote[];
    insertions: InsertedNote[];
    stats: AlignStats;
}

export interface AlignOptions {
    /**
     * Which checkpoint to align with. `DEFAULT_MODEL` when unset, and ignored
     * when `modelUrl` names a file directly.
     *
     * The older models remain correct: they align identically, and the only
     * thing that changes with the choice is how much the ornament attribution
     * is worth. Nothing downstream needs to know which one ran — the three
     * numbers on `ornamentOf` mean the same thing under all of them.
     */
    model?: MlignModelId;
    /** Overrides where the weights are fetched from, `model` included. */
    modelUrl?: string;
    /** Called as the alignment moves from stage to stage. */
    onProgress?: (progress: AlignProgress) => void;
    /**
     * Run even though the two files do not look like the same music. Without
     * it such a pair raises `MismatchedPairError` instead of spending a long
     * time on an answer that means nothing.
     */
    allowMismatch?: boolean;
    /**
     * A session to run in, instead of loading one. For a host that keeps its
     * own — a worker, or a test that stands in for the model.
     */
    session?: MlignSession;
    /**
     * Ask the model which written note each played note ornaments. On by
     * default, and silently nothing on a model whose graph has no attribution
     * head. Turning it off saves the two extra per-token tensors a window
     * carries back, at the cost of the one thing no other aligner offers.
     */
    attribution?: boolean;
}

/**
 * Align a score against a performance.
 *
 * The two arguments are what the app already has: `getNotesFromMEI` output and
 * the note spans of a parsed MIDI file. Spans that are not notes are ignored, so
 * the whole `asSpans` result can be passed straight in.
 *
 * Both tables are put in the model's order, by onset then pitch, and anything
 * unreadable is dropped. See `orderScore` and `orderPerformance` for why both
 * matter.
 *
 * Throws, with a message meant for a person, when the input is empty, too large
 * for the runtime, or not the same music.
 */
export async function alignScoreToPerformance(
    scoreNotes: readonly ScoreNote[],
    perfSpans: readonly NoteSpan[],
    options: AlignOptions = {}
): Promise<AlignResult> {
    const score = orderScore(scoreNotes);
    const perf = orderPerformance(perfSpans);
    const skippedScoreNotes = scoreNotes.length - score.length;
    const skippedPerformedNotes =
        perfSpans.filter((span) => span.type === "note").length - perf.length;

    if (score.length === 0) {
        throw new Error(
            skippedScoreNotes > 0
                ? `None of the ${skippedScoreNotes} notes in the score have a pitch and a time ` +
                  `that could be read.`
                : "No notes could be read from the score."
        );
    }
    if (perf.length === 0) {
        throw new Error(
            skippedPerformedNotes > 0
                ? `None of the ${skippedPerformedNotes} notes in the MIDI file have a pitch and ` +
                  `a time that could be read.`
                : "No notes could be read from the MIDI file."
        );
    }
    if (score.length * perf.length > MAX_CELLS) {
        throw new Error(
            `This pair is too large to align in the browser: ${score.length} score notes ` +
                `against ${perf.length} performed notes. Try a movement at a time.`
        );
    }

    const timings: Record<AlignStage, number> = {
        loading: 0,
        featurizing: 0,
        running: 0,
        decoding: 0,
    };
    const since = (start: number) => performance.now() - start;

    let started = performance.now();
    await announce(options, { stage: "featurizing" });
    const row = tablesToRow(score, perf);
    const windows = planWindows(row);

    let maxTokens = 0;
    for (const [s0, s1, p0, p1] of windows) {
        maxTokens = Math.max(maxTokens, 2 + (s1 - s0) + (p1 - p0));
    }
    if (maxTokens > MAX_WINDOW_TOKENS) {
        throw new Error(
            `A window of this alignment would be ${maxTokens} notes long, past what the ` +
                `browser runtime can hold (${MAX_WINDOW_TOKENS}). This usually means the ` +
                `MIDI file and the score are not the same piece.`
        );
    }

    // A window the baseline found fewer than two anchors for is paired with the
    // whole performance (`coarse_windows`' `sel.sum() < 2` branch). One such
    // window is ordinary; most of them means the baseline could not line the two
    // files up anywhere, which is what a MIDI that is not a recording of this
    // score looks like. Running on is the worst case there is: the head's
    // arithmetic is quadratic in a window's width, and every window would then
    // be as wide as it can get.
    const unanchored = windows.filter(([, , p0, p1]) => p0 === 0 && p1 === perf.length).length;
    const wasWindowed = 2 + score.length + perf.length > MAX_SINGLE_TOKENS;
    if (!options.allowMismatch && wasWindowed && unanchored * 2 > windows.length) {
        throw new MismatchedPairError(
            "This performance does not look like a recording of this score: most of the score " +
                "has nothing in it that lines up. Check the MIDI file belongs to this score — " +
                "if it is a recording of one passage only, aligning anyway will work, but it " +
                "will be slow.",
            windows.length,
            unanchored
        );
    }
    timings.featurizing = since(started);

    started = performance.now();
    await announce(options, { stage: "loading" });
    const session =
        options.session ?? (await loadSession(options.modelUrl ?? urlOfModel(options.model)));
    timings.loading = since(started);

    started = performance.now();
    await announce(options, { stage: "running", done: 0, total: windows.length });
    let bundle: SimBundle;
    try {
        bundle = await accumulateLogits(
            session,
            row,
            windows,
            (done, total) => options.onProgress?.({ stage: "running", done, total }),
            { attribution: options.attribution ?? true }
        );
    } catch (cause) {
        // Running out of the WASM heap is a normal JS exception and the session
        // survives it, so the only thing lost is this alignment. The size is not
        // named here — `session.ts` names it when size is what went wrong, and
        // blaming it for anything else sends the reader after the wrong thing.
        throw new Error(`The model could not run this alignment. ${messageOf(cause)}`, {
            cause,
        });
    }
    timings.running = since(started);

    started = performance.now();
    await announce(options, { stage: "decoding" });
    const triples = decode(row, bundle);
    const attributions = attributionsOf(bundle);
    timings.decoding = since(started);

    const matches: MatchedNote[] = [];
    const deletions: DeletedNote[] = [];
    const insertions: InsertedNote[] = [];
    for (const triple of triples) {
        if (triple.label === "match") {
            matches.push({
                scoreId: score[triple.scoreIdx].id,
                performanceId: perf[triple.perfIdx].id,
                confidence: triple.confidence,
            });
        } else if (triple.label === "deletion") {
            deletions.push({
                scoreId: score[triple.scoreIdx].id,
                confidence: triple.confidence,
            });
        } else {
            const attributed = attributions.get(triple.perfIdx);
            insertions.push({
                performanceId: perf[triple.perfIdx].id,
                confidence: triple.confidence,
                ...(attributed
                    ? {
                          ornamentOf: {
                              scoreId: score[attributed.scoreIdx].id,
                              confidence: attributed.confidence,
                              share: attributed.share,
                              gate: attributed.gate,
                          },
                      }
                    : {}),
            });
        }
    }

    return {
        matches,
        deletions,
        insertions,
        stats: {
            scoreNotes: score.length,
            performedNotes: perf.length,
            skippedScoreNotes,
            skippedPerformedNotes,
            windows: windows.length,
            maxTokens,
            timings,
        },
    };
}

/**
 * The score table in the model's order, without the notes it cannot read.
 *
 * Two separate jobs, both easy to get wrong:
 *
 * **The order is `(onset, pitch)`**, `np.lexsort((pitch, onset))` in
 * `tables.py::_sorted`. The table order is the token order into the encoder, so
 * it fixes the position ids, the relative-position bias, and which of two notes
 * at one onset the per-pitch assignment considers first. Sorting by onset alone
 * leaves a chord in an order the model never saw in training, which cost one
 * label out of 463 on the demo file, on a written unison whose two rows differ
 * only in their id.
 *
 * **A note whose numbers are not finite is dropped rather than repaired.**
 * `getMIDIValuesForElement` returns nothing for a note verovio cannot sound, so
 * its pitch arrives as `NaN`, `featurize` throws out of
 * `BigInt(Math.trunc(NaN))`, and one non-finite cell in `sim` takes the decode
 * somewhere the Python does not go: `Math.min(1, NaN)` is `NaN` here and `1.0`
 * there, so a DTW cost that stays finite in Python turns to NaN. The pitch range
 * is the embedding's 129 rows, outside which ORT throws on the gather.
 */
export function orderScore(scoreNotes: readonly ScoreNote[]): ModelNote[] {
    return scoreNotes
        .filter(
            (note) =>
                Number.isFinite(note.onset) &&
                Number.isFinite(note.duration) &&
                isModelPitch(note.pitch)
        )
        .map((note) => ({
            id: note.note,
            onset: note.onset,
            duration: note.duration,
            pitch: note.pitch,
            // Verovio's timemap does not report a voice and `ScoreNote` has no
            // room for one, so this is the one feature of the six the browser
            // cannot supply. A constant teaches the encoder nothing, which is
            // the harmless way to be missing it.
            voice: 0,
        }))
        .sort((a, b) => a.onset - b.onset || a.pitch - b.pitch);
}

/** The performance table in the same order, in seconds, minus what it cannot read. */
export function orderPerformance(perfSpans: readonly NoteSpan[]): PerfNote[] {
    return perfSpans
        .filter(
            (span) =>
                span.type === "note" &&
                Number.isFinite(span.onsetMs) &&
                Number.isFinite(span.offsetMs) &&
                Number.isFinite(span.velocity) &&
                isModelPitch(span.pitch)
        )
        .map((span) => ({
            id: span.id,
            onset: span.onsetMs / 1000,
            duration: Math.max(0, span.offsetMs - span.onsetMs) / 1000,
            pitch: span.pitch,
            velocity: span.velocity,
        }))
        .sort((a, b) => a.onset - b.onset || a.pitch - b.pitch);
}

function isModelPitch(pitch: number): boolean {
    return Number.isInteger(pitch) && pitch >= MIN_PITCH && pitch <= MAX_PITCH;
}

/**
 * What is wrong with this file as a score, in words for the person who chose
 * it, or nothing if it can be read.
 *
 * Worth doing before anything else touches it: verovio is a WebAssembly module,
 * and asking it to read something that is not an MEI can abort it in a way no
 * `catch` here ever sees — the promise simply never settles and the page waits
 * for ever. Parsing the XML first costs a millisecond and takes that away.
 */
export function checkScore(mei: string): string | undefined {
    if (mei.trim().length === 0) {
        return "That score file is empty — no notes could be read from it. Choose an MEI file with music in it.";
    }

    const doc = new DOMParser().parseFromString(mei, "application/xml");
    if (doc.querySelector("parsererror")) {
        return "That score file could not be read as MEI: it is not valid XML.";
    }
    if (doc.documentElement.localName !== "mei") {
        return (
            `That score file is XML, but its outermost element is <${doc.documentElement.localName}> ` +
            `rather than <mei>. Choose an MEI file and try again.`
        );
    }
    if (!doc.querySelector("note")) {
        return "That score has no notes in it. Choose an MEI file with music in it.";
    }
    return undefined;
}

/**
 * Whether this score writes grace notes but records nothing about where they
 * fall in the notation.
 *
 * MEI converted from MusicXML carries `@dur.ppq` on every timed event, zero on a
 * grace, which is what lets `notatedOnsets` put a grace back where it is
 * written. MEI written as MEI usually carries none, and a grace then keeps the
 * place verovio would play it at, a little before the beat it leans on. That
 * changes which performed note it can be matched to, so it belongs on the page
 * rather than only in the console where `notatedOnsets` leaves it.
 */
export function hasUntimedGraceNotes(mei: string): boolean {
    const doc = new DOMParser().parseFromString(mei, "application/xml");
    return doc.querySelector("[grace]") !== null && doc.querySelector("[dur\\.ppq]") === null;
}

/**
 * What is wrong with these bytes as a performance, or nothing if they can be
 * read.
 *
 * Both checks are of the first fourteen bytes of a standard MIDI file: the
 * `MThd` magic, and the division word, whose top bit means the file is timed in
 * SMPTE frames rather than in ticks per beat. `MidiSpans` divides by the ticks
 * per beat, which such a file reports as zero, and every onset it produces is
 * `Infinity`.
 */
export function checkPerformance(bytes: ArrayBuffer): string | undefined {
    if (bytes.byteLength < 14) {
        return "That performance file is too short to be a MIDI file. Choose a .mid file and try again.";
    }

    const view = new DataView(bytes);
    const magic = String.fromCharCode(
        view.getUint8(0),
        view.getUint8(1),
        view.getUint8(2),
        view.getUint8(3)
    );
    if (magic !== "MThd") {
        return "That performance file could not be read as MIDI. Check it is a .mid file and try again.";
    }
    if (view.getInt16(12) <= 0) {
        return (
            "That MIDI file is timed in SMPTE frames rather than in beats, which this " +
            "aligner cannot read. Export it again with a tempo-based (PPQ) division."
        );
    }
    return undefined;
}

/**
 * The matches as `applyAlignment` wants them, dropping anything the model was
 * less than `minConfidence` sure of.
 */
export function toMatches(
    matches: readonly MatchedNote[],
    minConfidence = 0
): Match[] {
    return matches
        .filter((match) => match.confidence >= minConfidence)
        .map((match) => ({
            score_id: match.scoreId,
            performance_id: match.performanceId,
        }));
}

/**
 * The score ids of matches the engraving cannot show.
 *
 * Verovio reads a repeat written with repeat signs as two passes and mints an id
 * of its own for the second (`n1-rend2` from `n1`), which the source document
 * does not hold. The performer really played those notes, so they are worth
 * aligning, but a `<when>` may only point at an element the document holds.
 *
 * The same test `applyAlignment` makes before writing a `<when>`, run ahead of
 * it so the count can be shown rather than only logged. It asks the document,
 * never the shape of the id: a score whose repeat is written out carries
 * `-rend2` ids of its own, and every one resolves.
 */
export function unshowableScoreIds(
    mei: string,
    matches: readonly MatchedNote[]
): Set<string> {
    const doc = new DOMParser().parseFromString(mei, "application/xml");
    const known = new Set<string>();
    for (const element of doc.querySelectorAll("[*|id]")) {
        const id = element.getAttribute("xml:id");
        if (id) known.add(id);
    }

    return new Set(
        matches.map((match) => match.scoreId).filter((id) => !known.has(id))
    );
}

/**
 * Whether the score writes a repeat with repeat signs rather than writing it
 * out.
 *
 * Only worth telling the reader about when verovio did not unfold the repeat
 * itself — it refuses to on a score of more than one section — because then
 * nothing in the score answers to the second pass and the whole of it comes
 * back as insertions.
 */
export function hasRepeatSigns(mei: string): boolean {
    const doc = new DOMParser().parseFromString(mei, "application/xml");
    return (
        doc.querySelector(
            'measure[left*="rpt"], measure[right*="rpt"], barLine[form*="rpt"]'
        ) !== null
    );
}

/**
 * The one session, kept across alignments.
 *
 * Building it costs a 3.1 MB fetch and a couple of hundred milliseconds of
 * graph work, and none of that depends on the piece. A rejected attempt is
 * dropped rather than cached, so a failed fetch can be retried by aligning
 * again.
 */
let loaded: { url: string | undefined; session: Promise<MlignSession> } | undefined;

function loadSession(modelUrl?: string): Promise<MlignSession> {
    if (loaded && loaded.url === modelUrl) return loaded.session;

    const session = import("./session")
        .then(({ createMlignSession }) => createMlignSession({ modelUrl }))
        .catch((cause: unknown) => {
            if (loaded?.session === session) loaded = undefined;
            throw new Error(
                `The alignment model could not be loaded. ${messageOf(cause)}`,
                { cause }
            );
        });

    loaded = { url: modelUrl, session };
    return session;
}

/**
 * Report a stage and let the caller draw it.
 *
 * Every stage below runs to the end without touching the event loop — the
 * featurization and the decode are plain arithmetic, and ORT's WASM forward is
 * synchronous once it starts. Handing the loop back for one turn is what lets a
 * progress line rendered from these calls reach the screen before the stage it
 * names blocks the thread.
 */
function announce(options: AlignOptions, progress: AlignProgress): Promise<void> {
    if (!options.onProgress) return Promise.resolve();

    options.onProgress(progress);
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function messageOf(reason: unknown): string {
    return reason instanceof Error ? reason.message : String(reason);
}
