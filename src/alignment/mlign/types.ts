/**
 * Shared types for the MLign aligner port.
 *
 * The reference implementation is Python/NumPy (`MLign/src/mlign/infer.py`).
 * Where a type here looks over-specified — plain `number[]` rather than a typed
 * array, for instance — it is because the Python it mirrors is float64 there and
 * narrowing to float32 would change the arithmetic. Those spots are called out.
 */

/** A score note. Onset and duration are in quarter notes. */
export interface ScoreNote {
    id: string;
    onset: number;
    duration: number;
    pitch: number;
    voice: number;
}

/** A performed note. Onset and duration are in seconds. */
export interface PerfNote {
    id: string;
    onset: number;
    duration: number;
    pitch: number;
    velocity: number;
}

/** `[onset_ticks, duration_ticks, pitch, voice % 5]`, PPQ 720. */
export type ScoreRow = [number, number, number, number];

/** `[onset_ms, duration_ms, pitch, velocity]`. */
export type PerfRow = [number, number, number, number];

/**
 * Both note tables in the units the model was trained on: score time in PPQ-720
 * ticks, performance time in milliseconds.
 *
 * These stay float64 (`number[]`, not `Float32Array`) on purpose. The decode
 * recovers seconds by dividing back down — `s_onset = row.score[i][0] / 720`,
 * `p_onset = row.perf[j][0] / 1000` — and NumPy does that in float64. Rounding
 * the ticks to float32 first perturbs the onsets, and onset equality is what
 * decides cluster boundaries in the DTW.
 */
export interface MlignRow {
    score: ScoreRow[];
    perf: PerfRow[];
}

/** A model window over the two tables: score `[s0, s1)` against perf `[p0, p1)`. */
export type Window = readonly [s0: number, s1: number, p0: number, p1: number];

/**
 * How the attribution head's row is put together, which differs by checkpoint.
 *
 * `"none"` is the head as v1 and v2 export it: the row is `[attr | attr_none]`
 * raw, and reading it means softmaxing it.
 *
 * `"factored"` is v3. The row is rebuilt from three factors (is this played note
 * an insertion, does that insertion elaborate a written note, and which one) and
 * comes out *already normalized*, so it is exponentiated rather than softmaxed.
 * The first factor is the match head's, which is why the conditioning needs the
 * accumulated `sim` / `nullP` and cannot live in the graph. See
 * `attribution.ts`.
 *
 * Detected from the graph's own outputs (`attr_gate` present means factored),
 * never from the file name.
 */
export type AttrConditioned = "none" | "factored";

/**
 * The model's accumulated output for a whole piece.
 *
 * `sim` is row-major `(n, m)`. Cells no window covered hold `UNCOVERED_SIM`, and
 * the matching entries of `nullS` / `nullP` hold `UNCOVERED_NULL`, which is what
 * drives those notes to a deletion / insertion in the decode.
 *
 * `attr` is the ornament-attribution head, present only when it was asked for.
 * Row-major `(m, n)`, the other way round from `sim`, being a distribution over
 * written notes for each played one. `attrNone` is its "not an ornament" column,
 * kept beside it rather than as an `n + 1`th entry so the matrix stays a plain
 * transpose of the score/performance grid.
 *
 * `attrGate` is v3's third quantity, one logit per played note, and its presence
 * says the row must be built the `"factored"` way. It is the raw accumulated
 * gate: the conditioning is nonlinear in a whole row, so `attribution.ts`
 * applies it once, after the windows have been averaged.
 */
export interface SimBundle {
    n: number;
    m: number;
    sim: Float32Array;
    nullS: Float32Array;
    nullP: Float32Array;
    attr?: Float32Array;
    attrNone?: Float32Array;
    attrGate?: Float32Array;
}

/** An alignment triple over table indices, as `decode` emits them. */
export type IndexTriple =
    | { label: "match"; scoreIdx: number; perfIdx: number; confidence: number }
    | { label: "deletion"; scoreIdx: number; confidence: number }
    | { label: "insertion"; perfIdx: number; confidence: number };

/** An alignment triple over note ids, as the caller wants them. */
export type AlignmentTriple =
    | { label: "match"; scoreId: string; perfId: string; confidence: number }
    | { label: "deletion"; scoreId: string; confidence: number }
    | { label: "insertion"; perfId: string; confidence: number };

/**
 * Constants shared with the Python. Names match `meta.constants` in the golden
 * manifests, which is the contract these are checked against.
 */
export const PPQ = 720.0;
export const PERF_MS_PER_SEC = 1000.0;
export const MARKER_PITCH = 128;
export const MAX_SINGLE_TOKENS = 2000;
export const WIN_SCORE = 384;
/**
 * Derived, not independent: `coarse_windows` computes `stride = WIN_SCORE // 2`
 * in its own body, so this is that value at the default window size and nothing
 * more. The manifests record it because they record what a run used, not because
 * it is settable — a window plan with a stride that is not half its window size
 * is one no Python run could produce. Never expose it as an option; derive it.
 */
export const WIN_STRIDE = WIN_SCORE >> 1;
export const MARGIN_SEC = 3.0;
export const UNCOVERED_SIM = -1e9;
export const UNCOVERED_NULL = 1e9;
/**
 * The floor on the two match-head terms of a `"factored"` attribution row —
 * `NoteAligner.LOG_FLOOR` in the Python, and part of the model contract rather
 * than a taste of this port's.
 *
 * Without it a match head that is certain contributes an unbounded term: a
 * played note the alignment is sure it matched sends `log P(insertion)` to
 * minus infinity, and with it the whole ornament side of the row, so the
 * ranking underneath — which is the part worth having — would be lost to a
 * number the head was never asked about.
 */
export const LOG_FLOOR = -12.0;
export const ANCHOR_CONF = 0.35;
export const TOL_SEC = 1.0;
export const SKIP_FACTOR = 0.6;
export const ASSIGN_INF = 1e18;
export const CONF_BONUS_FACTOR = 0.5;
export const RESCUE_SEC = 0.35;
export const DTW_GAP_DECODE = 0.6;
export const DTW_GAP_BASELINE = 0.75;
export const DTW_CONF_GAIN = 20.0;
export const SCORE_CLUSTER_EPS = 1e-9;
export const PERF_CLUSTER_EPS = 0.05;
