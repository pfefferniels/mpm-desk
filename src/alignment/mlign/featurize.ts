/**
 * Note tables → the four tensors the model is fed.
 *
 * Mirrors `MLign/src/mlign/dataset.py:featurize` for the B = 1, unpadded case,
 * and `infer.py:tables_to_row` for the step before it. The authoritative
 * statement of the layout is the `featurize` block of `models/mlign-v2.onnx.json`;
 * this file is that block turned into code, with the Python consulted only where
 * the sidecar leaves a detail implicit.
 *
 * One window of the two tables becomes one sequence of `T = 2 + n + m` tokens:
 *
 *     [MARKER] s_1 … s_n [MARKER] p_1 … p_m
 *
 * Everything is computed in float64 and rounded to float32 exactly once, by the
 * store into `cont` — which is what NumPy does too, since it builds the block in
 * float64 and calls `.astype(np.float32)` at the end. Rounding earlier (say, by
 * accumulating onsets in a Float32Array) would move values by more than the
 * 1e-6 the golden fixtures are checked against.
 */

import {
    MARKER_PITCH,
    PERF_MS_PER_SEC,
    PPQ,
    type MlignRow,
    type PerfNote,
    type ScoreNote,
    type Window,
} from "./types";

/** Continuous channels per token. `cont` is `(T, N_CONT)` row-major. */
export const N_CONT = 6;

/** Score `extra` is `(voice % 5) / VOICE_SCALE`; the row already holds `voice % 5`. */
const VOICE_SCALE = 4.0;

/** Perf `extra` is `velocity / VELOCITY_SCALE - 1`. */
const VELOCITY_SCALE = 64.0;

/** Both halves share `pitch / PITCH_SCALE - 1` for the absolute-pitch channel. */
const PITCH_SCALE = 64.0;

/** The model's input for one window, ready to hand to the ONNX session. */
export interface Featurized {
    /** Score notes in the window. */
    n: number;
    /** Performed notes in the window. */
    m: number;
    /** `2 + n + m`. */
    T: number;
    /** MIDI pitch per token, `MARKER_PITCH` at the two markers. */
    pitch: BigInt64Array;
    /** `(T, N_CONT)` row-major; both marker rows are all zeros. */
    cont: Float32Array;
    /** 0 across the score half (its marker included), 1 across the perf half. */
    segment: BigInt64Array;
    /** Index within the segment; restarts at 0 at the perf marker. */
    position: BigInt64Array;
}

/**
 * Both note tables in the units the model was trained on.
 *
 * The multiplication by 720 / 1000 here and the division by the same constants
 * in `featurizeWindow` do NOT cancel in general float64: for ~14% of random
 * doubles `(x * 720) / 720 !== x`, and for ~2% `(x * 1000) / 1000 !== x`. They
 * do cancel for every onset this code will ever see, because a value carrying at
 * most 24 mantissa bits (anything that came through a float32, which is where
 * MIDI onsets come from) needs at most 30 bits once multiplied by 720 = 45 · 2^4,
 * so both steps are exact. The round trip is kept rather than folded away
 * because it is the model's contract, not an accident: the windowing recovers
 * seconds from the row the same way, and dropping it here would silently
 * diverge from the Python for any input that did not come through a float32.
 */
export function tablesToRow(score: readonly ScoreNote[], perf: readonly PerfNote[]): MlignRow {
    return {
        score: score.map((note) => [
            note.onset * PPQ,
            note.duration * PPQ,
            Math.trunc(note.pitch),
            // Python's `%` on a negative left operand returns a non-negative
            // result; JavaScript's returns a negative one. Voices are positive in
            // practice, but the two disagree if one ever is not.
            ((Math.trunc(note.voice) % 5) + 5) % 5,
        ]),
        perf: perf.map((note) => [
            note.onset * PERF_MS_PER_SEC,
            note.duration * PERF_MS_PER_SEC,
            Math.trunc(note.pitch),
            Math.trunc(note.velocity),
        ]),
    };
}

/** Featurizes the whole row as a single sequence. */
export function featurizeRow(row: MlignRow): Featurized {
    return featurizeWindow(row, [0, row.score.length, 0, row.perf.length]);
}

/** Featurizes score `[s0, s1)` against perf `[p0, p1)`. */
export function featurizeWindow(row: MlignRow, window: Window): Featurized {
    const [s0, s1, p0, p1] = window;
    const n = s1 - s0;
    const m = p1 - p0;
    const T = 2 + n + m;

    const pitch = new BigInt64Array(T);
    const cont = new Float32Array(T * N_CONT);
    const segment = new BigInt64Array(T);
    const position = new BigInt64Array(T);

    const marker = BigInt(MARKER_PITCH);
    pitch[0] = marker;
    pitch[1 + n] = marker;
    // Both marker rows of `cont` stay at the zeros they were allocated with.

    let prev = 0.0;
    for (let i = 0; i < n; i++) {
        const note = row.score[s0 + i];
        const onset = note[0] / PPQ;
        // `np.diff(onset, prepend=onset[0])` subtracts the first onset from
        // itself, so the first delta is exactly 0 — not the onset, and not a
        // gap inherited from the note before the window.
        const delta = i === 0 ? 0.0 : onset - prev;
        prev = onset;
        writeCont(cont, 1 + i, delta, note[1] / PPQ, note[2], note[3] / VOICE_SCALE, 0.0);
        // `.astype(np.int64)` truncates towards zero; `BigInt` of a non-integer
        // would throw, so truncate rather than trust the caller.
        pitch[1 + i] = BigInt(Math.trunc(note[2]));
    }

    prev = 0.0;
    for (let j = 0; j < m; j++) {
        const note = row.perf[p0 + j];
        const onset = note[0] / PERF_MS_PER_SEC;
        const delta = j === 0 ? 0.0 : onset - prev;
        prev = onset;
        const extra = note[3] / VELOCITY_SCALE - 1.0;
        writeCont(cont, 2 + n + j, delta, note[1] / PERF_MS_PER_SEC, note[2], extra, 1.0);
        pitch[2 + n + j] = BigInt(Math.trunc(note[2]));
    }

    for (let t = 0; t <= n; t++) position[t] = BigInt(t);
    for (let t = 0; t <= m; t++) {
        segment[1 + n + t] = 1n;
        position[1 + n + t] = BigInt(t);
    }

    return { n, m, T, pitch, cont, segment, position };
}

/**
 * One token's six continuous channels.
 *
 * `delta` and `duration` are clamped at zero before the log, so an unsorted table
 * or a negative duration gives 0 rather than a NaN. `extra` differs between the
 * halves and is passed in already computed; `segFlag` duplicates `segment` as a
 * float the encoder can see alongside the rest.
 */
function writeCont(
    cont: Float32Array,
    token: number,
    delta: number,
    duration: number,
    pitch: number,
    extra: number,
    segFlag: number
): void {
    const o = token * N_CONT;
    cont[o] = Math.log1p(Math.max(delta, 0.0) * 2.0);
    cont[o + 1] = Math.log1p(Math.max(duration, 0.0) * 2.0);
    cont[o + 2] = pitch / PITCH_SCALE - 1.0;
    cont[o + 3] = ((pitch % 12) / 11.0) * 2.0 - 1.0;
    cont[o + 4] = extra;
    cont[o + 5] = segFlag;
}
