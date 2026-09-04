/**
 * Which written note a played note ornaments, read out of the attribution head.
 *
 * The question the aligner cannot answer: every aligner in this field returns a
 * trill's eleven notes as one match and ten insertions belonging to nothing.
 *
 * Its own map rather than a reuse of the match similarity, which is trained to
 * send an ornament note to the null column. So an answer here is not evidence
 * about the alignment and must never be fed back into it.
 *
 * **How far to trust it.** Supervision is espressivo-rendered performances only;
 * no corpus of real playing annotates ornament attribution. On held-out
 * synthetic material it places 94% of ornament notes on the right principal and
 * gets 83% of whole figures right, falling to 89% and 70% under distribution
 * shift. Enough to propose with, not to decide with.
 *
 * Two row shapes. `"none"` (v1, v2) is the raw `[attr | attr_none]`, softmaxed.
 * `"factored"` (v3) rebuilds the ornament-or-not half from
 *
 *     P(anchor = i) = P(insertion) x P(elaborates something | insertion) x P(i | that)
 *
 * taking the first factor from the *match* head. It arrives already normalized,
 * so it is exponentiated and never softmaxed again, up to `LOG_FLOOR`, where the
 * clamp hands back mass and the row sums to a hair over one as the reference's
 * does.
 *
 * Two constraints: the match evidence must be the host's *own* accumulated `sim`
 * and `nullP`, a window's p→s softmax running over that window's score notes
 * only; and the factoring happens once, here, on rows already averaged over
 * windows, being nonlinear in a whole row.
 *
 * **Decide on `gate * share`, never on `confidence`**, which carries
 * `P(insertion)` and so lets the match head veto answers it was never asked for.
 * That veto silences 48.8% of ornament figures on real Batik; taking it out is
 * worth whole-figure accuracy .1919 → .3297 there, on the shipped checkpoint.
 * Batik is the only clean corpus, 209 of real ASAP's 225 rows being performances
 * the match head trained on. Read accuracy against the share of claimed
 * ornaments that were really matched notes, .0891 on Batik, since attributing
 * more can only raise accuracy by itself.
 *
 * Reference: MLign `src/mlign/infer.py`, `Ornaments` and `ORNAMENT_MIN_PROB`.
 */

import type { SimBundle } from "./types";
import { LOG_FLOOR, UNCOVERED_SIM } from "./types";

/**
 * What the head says about one played note.
 *
 * Three numbers, because the head answers two questions at once and the answers
 * can come apart.
 *
 * `confidence` is the whole row's mass on this answer, the match head's verdict
 * folded in. `gate` is its first half with the match head taken out: given that
 * this played note is an insertion, does it elaborate a written note at all.
 * `share` is the second half: of the mass on elaborating anything, how much sits
 * on this one written note.
 *
 * All three mean the same under every checkpoint. What differs by checkpoint is
 * how the first is arrived at.
 */
export interface Attributed {
    /** Index into the score table of the note it most likely ornaments. */
    scoreIdx: number;
    /** The row's mass on that note, "not an ornament" included in the total. */
    confidence: number;
    /** That note's share of the mass on ornamenting anything at all. */
    share: number;
    /**
     * P(this elaborates a written note at all | it is an insertion).
     *
     * The half of the answer the match head cannot veto. Multiplied by `share`,
     * which is the other half, it is what a decoder thresholds a decoded
     * insertion on. Kept apart from it here rather than multiplied in, because
     * the two are separately worth saying and only the caller knows which it
     * wants.
     *
     * Under v3 it is the head's own gate, read from the graph. Under v1 and v2
     * there is no such tensor and it is what the row itself says once the "not
     * an ornament" column is set aside, which is the same fallback the Python
     * takes for an unconditioned head.
     */
    gate: number;
}

/**
 * One played note's attribution row as a log-distribution over the `n` written
 * notes and the "not an ornament" column at index `n`.
 *
 * Both modes come out in the same units, `exp()` an entry for a probability, so
 * everything downstream is written once. A cell no window covered is `-Infinity`
 * rather than the `UNCOVERED_SIM` sentinel, which a normalization would leave
 * unrecognisable.
 *
 * `undefined` when there is no attribution to read: no head, or no window looked
 * at this note. Neither is the head declining to attribute it.
 *
 * `out` is an optional scratch buffer of length `n + 1`, which keeps a loop over
 * every played note from allocating per note.
 */
export function attributionRow(
    bundle: SimBundle,
    j: number,
    out?: Float64Array
): Float64Array | undefined {
    const { n, attr, attrNone, attrGate } = bundle;
    if (!attr || !attrNone) return undefined;

    // Coverage is asked of the quantity this mode actually reads. Both are
    // sentinelled off the same window count, so the two agree; reading the one
    // that belongs to the mode keeps the factored path from depending on a
    // number it does not use.
    const covered = attrGate ? attrGate[j] : attrNone[j];
    if (covered <= UNCOVERED_SIM) return undefined;

    const row = out ?? new Float64Array(n + 1);
    if (row.length !== n + 1) {
        throw new Error(`MLign: attribution scratch buffer is ${row.length}, expected ${n + 1}`);
    }

    const attrOff = j * n;
    if (!attrGate) {
        // v1/v2: the raw row, log-softmaxed. Exponentiating an entry gives the
        // same number a direct softmax would.
        for (let i = 0; i < n; i++) {
            const logit = attr[attrOff + i];
            row[i] = logit <= UNCOVERED_SIM ? -Infinity : logit;
        }
        row[n] = attrNone[j];

        const lse = logSumExp(row);
        for (let i = 0; i <= n; i++) row[i] -= lse;
        return row;
    }

    // v3. The match head's two terms first, from the accumulated p->s row this
    // played note already has in `sim` / `nullP`.
    const { logIns, logMatched } = matchEvidence(bundle, j);

    // Then the ranking, normalized over the written notes alone.
    for (let i = 0; i < n; i++) {
        const logit = attr[attrOff + i];
        row[i] = logit <= UNCOVERED_SIM ? -Infinity : logit;
    }
    const rankLse = logSumExp(row, n);

    const gate = attrGate[j];
    // The ornament side of the row: an insertion, that elaborates something,
    // and that this is the something.
    const ornament = logIns + logSigmoid(gate);
    for (let i = 0; i < n; i++) {
        row[i] = row[i] === -Infinity ? -Infinity : ornament + (row[i] - rankLse);
    }
    // The other column collects both ways of not being an ornament: the note was
    // matched after all, or it is an insertion that elaborates nothing written.
    row[n] = logAddExp(logIns + logSigmoid(-gate), logMatched);

    return row;
}

/**
 * The match head's word on one played note: how much of its p->s row sits on
 * "insertion", and how much on having been matched at all.
 *
 * Straight out of the host's own accumulated logits, `sim` column `j` with
 * `nullP[j]` appended, and out of nothing else. It has to be the windowed ones:
 * inside a window the p→s softmax runs over that window's score notes, so a
 * recomputation over the whole score is a different quantity from the one the
 * model was trained against.
 *
 * Both halves are floored, or a certain match head puts an unbounded term into
 * the row and takes the ranking underneath with it.
 */
function matchEvidence(bundle: SimBundle, j: number): { logIns: number; logMatched: number } {
    const { n, m, sim, nullP } = bundle;

    const nullLogit = nullP[j];
    let mx = nullLogit;
    for (let i = 0; i < n; i++) {
        const v = sim[i * m + j] / SIM_DIRECTIONS;
        if (v > mx) mx = v;
    }

    let matched = 0;
    for (let i = 0; i < n; i++) matched += Math.exp(sim[i * m + j] / SIM_DIRECTIONS - mx);
    const total = matched + Math.exp(nullLogit - mx);
    const lse = mx + Math.log(total);

    return {
        logIns: Math.max(nullLogit - lse, LOG_FLOOR),
        logMatched: Math.max(mx + Math.log(matched) - lse, LOG_FLOOR),
    };
}

/**
 * Why `sim` is halved above, and why `nullP` is not.
 *
 * `accumulate.ts` adds the match head in both directions per window, so every
 * covered cell of the accumulated `sim` holds *twice* the raw similarity, a
 * quirk of the reference reproduced there because the decode is calibrated
 * against it. `logits_p2s` is not that matrix: the sidecar defines it as
 * `concat([sim.T, null_row])` over the plain `dot(s, p) * scale`, and that
 * undoubled row is what the model saw in training.
 *
 * `nullP` is already single and must be left alone. It appears in only one of
 * the two accumulated directions, `logits_s2p` contributing the *deletion*
 * column, so it is averaged over windows and never doubled. Halving the whole
 * concatenated row would be its own quiet bug.
 *
 * A doubled sim half is a *sharper* p→s softmax, driving `log_ins` toward 0 or
 * toward the floor. Measured on a real flourish it moved per-note attribution
 * confidence from .987 to .112, a dropped ornament under any sane threshold.
 * The sidecar spells this out under
 * `head.attribution.conditioned.match_evidence`.
 */
const SIM_DIRECTIONS = 2;

/**
 * Read the head for every played note it was asked about.
 *
 * Nothing is filtered here. What counts as sure enough is an editorial question,
 * answered in `../divergences` where the rest of the evidence about a note is,
 * not least whether the score writes an ornament sign on the note the head
 * named.
 *
 * A played note no window covered is absent: the head was never asked about it,
 * which is not the same as declining to attribute it.
 */
export function attributionsOf(bundle: SimBundle): Map<number, Attributed> {
    const { n, m, attr, attrNone, attrGate } = bundle;
    const found = new Map<number, Attributed>();
    if (!attr || !attrNone) return found;

    const scratch = new Float64Array(n + 1);
    for (let j = 0; j < m; j++) {
        const row = attributionRow(bundle, j, scratch);
        if (!row) continue;

        let best = -1;
        let bestLogp = -Infinity;
        for (let i = 0; i < n; i++) {
            if (row[i] > bestLogp) {
                bestLogp = row[i];
                best = i;
            }
        }
        if (best < 0 || bestLogp === -Infinity) continue;

        // The row is a log-distribution, so the whole-row number is one `exp`
        // and the share is that same mass measured against the ornament half of
        // the row rather than against all of it.
        const ornament = logSumExp(row, n);
        found.set(j, {
            scoreIdx: best,
            confidence: Math.exp(bestLogp),
            share: Math.exp(bestLogp - ornament),
            // Straight from the graph where there is one, because rebuilding it
            // from the row is exactly the mistake: the row's ornament half has
            // been through the match head and the gate has not. Without the
            // tensor the row is all there is, and its two halves are then the
            // only answer available.
            gate: attrGate
                ? sigmoid(attrGate[j])
                : Math.exp(ornament - logSumExp(row)),
        });
    }

    return found;
}

/**
 * `log(sum(exp(row)))` over the first `len` entries, shifted by the largest of
 * them so that a long piece cannot overflow the sum.
 *
 * `-Infinity` entries drop out on their own, and an all-`-Infinity` range
 * returns `-Infinity` rather than `NaN`.
 */
function logSumExp(row: Float64Array, len = row.length): number {
    let mx = -Infinity;
    for (let i = 0; i < len; i++) if (row[i] > mx) mx = row[i];
    if (mx === -Infinity) return -Infinity;

    let sum = 0;
    for (let i = 0; i < len; i++) sum += Math.exp(row[i] - mx);
    return mx + Math.log(sum);
}

/** `log(exp(a) + exp(b))`, without ever forming either exponential. */
function logAddExp(a: number, b: number): number {
    if (a === -Infinity) return b;
    if (b === -Infinity) return a;
    const mx = a > b ? a : b;
    return mx + Math.log1p(Math.exp(-Math.abs(a - b)));
}

/** `log(sigmoid(x))`, taking the branch that keeps `exp` below 1 either way. */
function logSigmoid(x: number): number {
    return x >= 0 ? -Math.log1p(Math.exp(-x)) : x - Math.log1p(Math.exp(x));
}

/** `sigmoid(x)`, by the same two branches, so neither tail overflows. */
function sigmoid(x: number): number {
    if (x >= 0) return 1 / (1 + Math.exp(-x));
    const e = Math.exp(x);
    return e / (1 + e);
}
