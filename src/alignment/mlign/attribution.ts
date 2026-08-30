/**
 * Which written note a played note ornaments, read out of the attribution head.
 *
 * The question the aligner cannot answer. A trill's eleven notes come back from
 * every aligner in this field - Nakamura, TheGlueNote, parangonar - as one match
 * and ten insertions belonging to nothing, and the notes themselves say nothing
 * about which written note they decorate. MLign carries a second bilinear head
 * trained to answer exactly that, and this is the whole of reading it.
 *
 * It is deliberately its own map rather than a reuse of the match similarity:
 * the match head is trained to send an ornament note to the null column, so the
 * same score note cannot rank highly in both. Which is also why an answer here
 * is not evidence about the alignment and must never be fed back into it.
 *
 * What it was trained on bears saying plainly, because it bounds how far the
 * answer should be trusted. Supervision comes only from espressivo-rendered
 * performances, where every ornament note's provenance is known. No corpus of
 * real playing annotates ornament attribution at all - not ASAP, not Vienna
 * 4x22, not Batik - so the head has never been asked about a real trill with a
 * known answer. On held-out synthetic material it places 94% of ornament notes
 * on the right principal, and gets the whole figure exactly right 83% of the
 * time; under a distribution shift beyond its training settings that falls to
 * 89% and 70%. Good enough to propose with, nowhere near good enough to decide
 * with, which is why nothing here writes anything into a score.
 *
 * ## Two ways the row is built
 *
 * v1 and v2 hand back a raw row, `[attr | attr_none]`, and reading it means
 * softmaxing it. That is `"none"` below, and it is what made the head's two
 * numbers come apart so badly on real playing: measured against the two trills
 * Chopin's op. 9 no. 1 actually notates, on a recording of it, the v2 head ranks
 * the right written note first for six of the twelve played notes those figures
 * come to, and on all but one of those still puts most of its mass on the note
 * not being an ornament at all.
 *
 * v3 is trained `"factored"`, and it is the "is this an ornament at all" half -
 * the half that was wrong - that it rebuilds. The row is three factors:
 *
 *     P(anchor = i) = P(insertion) x P(elaborates something | insertion) x P(i | that)
 *
 * The first comes from the *match* head, not the attribution head, which is the
 * whole point: whether a played note is an insertion is a question the alignment
 * already answers well, so the attribution head is left to answer only the two
 * it is good at. The row that comes out is already a distribution over the
 * `n + 1` options, and exponentiating it - never softmaxing it again - is what
 * reads it. Softmaxing it a second time would throw away precisely the
 * calibration this buys.
 *
 * "Already a distribution" up to `LOG_FLOOR`, which is the one exception: where
 * the clamp bites it hands back mass the match head had taken away, and the row
 * sums to a hair over one. That is the reference's behaviour too, and it errs in
 * the safe direction - a ranking survives a match head that was too sure.
 *
 * Two things about that are easy to get wrong and are worth stating:
 *
 * The match evidence must be the host's *own* accumulated `sim` and `nullP`,
 * the same matrix it feeds the decode. The graph cannot supply it, because
 * inside a window the p->s softmax runs over that window's score notes only.
 *
 * And the factoring happens once, here, on rows that have already been averaged
 * over windows. It is a nonlinear function of a whole row, so conditioning each
 * window and averaging the results is a different quantity - which is why
 * `accumulate.ts` keeps `attr`, `attrNone` and `attrGate` raw.
 *
 * ## The row's own argmax is not the answer, once the decode has spoken
 *
 * Reading the row and taking its largest entry is the head's answer, and it is
 * dominated by the match head. The "not an ornament" column carries
 * `log_matched` and the ornament side carries `log_ins`, so either way a played
 * note the match head believes it has matched is silenced whatever the
 * attribution head thinks. Measured on real Batik that silences 48.8% of all
 * ornament figures, and on those the head scores .0000 - not because it does not
 * know the answer but because it is never allowed to give it. Take the match
 * head's contribution back out and it names the right written note for 85% of
 * exactly those notes.
 *
 * The decode does not need the match head's opinion here, because it has already
 * formed its own and disagreed. A played note reaches `../divergences` as an
 * insertion precisely when the per-pitch monotone assignment paired it with
 * nothing, so for that note `P(matched)` is not an estimate left to weigh, it is
 * settled at zero. What survives is the two questions the attribution head was
 * trained to answer:
 *
 *     P(anchor = i | insertion) = P(elaborates something | insertion) x P(i | that)
 *
 * which are `gate` and `share` below, and their product is what a decoder
 * thresholds. Both were already here: `share` has always been the ranking alone,
 * and the gate is a tensor the graph emits. What was missing is that the
 * acceptance test ran on `confidence`, which carries `P(insertion)` and so
 * carries the veto with it. On the checkpoint this app ships that costs
 * whole-figure accuracy .1919 against .3297 on real Batik, with no change to
 * the model.
 *
 * Batik is the number, and the only one. 209 of real ASAP's 225 rows are
 * performances the match head was trained on, so every pooled ASAP figure in
 * MLign's record overstates; the clean remainder is 36 figures, indicative at
 * best. And whole-figure accuracy alone cannot tell better from louder, since
 * attributing more can only raise it - read it against how much of what was
 * called an ornament was really a matched note, which on Batik is .0891.
 *
 * `confidence` stays, because it is what the head itself says and because a v1
 * or v2 row has nothing else to give. It is no longer the number to decide on.
 * The reference is MLign `src/mlign/infer.py`: `Ornaments`, and the threshold
 * `ORNAMENT_MIN_PROB`.
 */

import type { SimBundle } from "./types";
import { LOG_FLOOR, UNCOVERED_SIM } from "./types";

/**
 * What the head says about one played note.
 *
 * Three numbers, because the head is answering two questions at once and the
 * answers can come apart, and because how much of the first question the match
 * head is allowed to answer is itself a choice.
 *
 * `confidence` is the whole row's mass on this answer, so it is "this is an
 * ornament, and it is that note's", with the match head's verdict folded in.
 * `gate` asks the same first half of that with the match head taken out: given
 * that this played note is an insertion, does it elaborate a written note at
 * all. `share` is the second half: of the mass on elaborating anything, how much
 * sits on this one written note.
 *
 * All three mean the same thing under every checkpoint, which is what lets the
 * rest of the app stay as it was. What v3 changed is how the first is arrived
 * at; what the decode changes is which of them is worth deciding on.
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
 * Both modes come out of here in the same units - `exp()` an entry for a
 * probability - so everything downstream is written once. A cell no window
 * covered is `-Infinity` rather than the `UNCOVERED_SIM` sentinel, because after
 * a normalization the sentinel is no longer recognisable as one.
 *
 * `undefined` when this note has no attribution to read: no head, or no window
 * ever looked at it. Those are different from the head declining to attribute
 * it, and must not be confused with it.
 *
 * `out` is an optional scratch buffer of length `n + 1`; passing one across a
 * loop over every played note is what keeps this from allocating per note.
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
        // v1/v2: the raw row, log-softmaxed. Exponentiating that is the softmax
        // this used to take directly, so the numbers are the ones it gave.
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
 * Straight out of the host's own accumulated logits - `sim` column `j` with
 * `nullP[j]` appended - and out of nothing else. It has to be the windowed
 * ones: inside a window the p->s softmax runs over that window's score notes,
 * and a recomputation over the whole score would be a different quantity from
 * the one the model was trained against.
 *
 * Both halves are floored, because a match head that is certain would otherwise
 * put an unbounded term into the row and take the ranking underneath with it.
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
 * covered cell of the accumulated `sim` holds *twice* the raw similarity - a
 * quirk of the reference's accumulation, faithfully reproduced there because
 * the decode is calibrated against it. `logits_p2s` is not that matrix: the
 * sidecar defines it as `concat([sim.T, null_row])` with `sim` the plain
 * `dot(s, p) * scale`, and that undoubled row is what the model saw in
 * training.
 *
 * `nullP` is already single and must be left alone. It appears in only one of
 * the two accumulated directions - `logits_s2p` contributes the *deletion*
 * column, not this one - so it is averaged over windows and never doubled.
 * Halving the whole concatenated row would be its own bug, and a quiet one.
 *
 * The distinction is not cosmetic: a doubled sim half is a *sharper* p->s
 * softmax, which drives `log_ins` toward 0 or toward the floor. Measured on a
 * real flourish it moved per-note attribution confidence from .987 to .112,
 * which under any sane acceptance threshold is a dropped ornament. The sidecar
 * spells this out under `head.attribution.conditioned.match_evidence`.
 */
const SIM_DIRECTIONS = 2;

/**
 * Read the head for every played note it was asked about.
 *
 * Nothing is filtered here, deliberately. What counts as sure enough is an
 * editorial question, not a model one, and it is answered in
 * `../divergences` where the rest of the evidence about a note is - not least
 * whether the score writes an ornament sign on the very note the head named.
 *
 * A played note no window covered is absent: no window looked at it, so the head
 * did not decline to attribute it, it was never asked.
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
