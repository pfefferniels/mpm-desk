/**
 * Tick ⇄ millisecond conversion under a `<tempo>` instruction, at this application's resolution.
 *
 * **The arithmetic is espressivo's**, and it lives there: in its `src/mpm/timing.ts`, every
 * function that crosses between ticks and milliseconds takes the document's `@pulsesPerQuarter`
 * as an argument, the way `TempoMap.computeDiffTiming` does. What is here is that algebra bound
 * to {@link PULSES_PER_QUARTER} — 720 and only 720 is ever written, so every call site would
 * otherwise pass the same number — plus the two curve-fitting helpers the desks drive.
 *
 * The record of *why* the delegation exists is in the header of espressivo's `src/mpm/timing.ts`.
 * A local hand-copy of `resolveTempo`, `tempoAt` or `computeDiffTiming` — Simpson's rule included,
 * down to the sub-interval count — drifts from the renderer in four ways: `meanTempoAt` of exactly
 * 1 reading as ±Infinity, one above 1 overshooting both endpoints, a negative one giving `NaN`,
 * and a `|| 0.5` that turns an explicit `meanTempoAt="0"` into a linear ramp. Do not introduce one.
 *
 * One consequence belongs here rather than there: a document with a malformed `@meanTempoAt`
 * measures as `NaN` throughout its span, which `auditInstructions` refuses to let a transformer
 * leave standing. That is the intended outcome — it is what the
 * renderer produces, and the renderer's answer is the one that decides whether a fit is right.
 */
import { tempoAt, type Tempo as ResolvedTempo } from 'espressivo';
import {
  computeElapsedMs as computeElapsedMsAt,
  computeMillisecondsAt as computeMillisecondsAtPpq,
  dateAtMilliseconds as dateAtMillisecondsAtPpq,
  getTempoAt,
  millisecondsAt as millisecondsAtPpq,
  resolveSpan,
  ticksForConstantTempo as ticksForConstantTempoAtPpq,
  type TempoWithEndDate,
  type WithEndDate,
} from 'espressivo';
import type { InstructionOptions } from '../../instructions/index';
import { beatLengthInTicks, PULSES_PER_QUARTER } from '../../ppq';

/**
 * The two that answer without crossing between ticks and milliseconds — {@link resolveSpan}
 * reads attributes, {@link getTempoAt} evaluates a curve in bpm — so there is no resolution for
 * them to be bound to. Re-exported as they stand.
 */
export { getTempoAt, resolveSpan };
export type { TempoWithEndDate, WithEndDate };

/** Elapsed milliseconds from the start of an already-resolved span to `date`, at 720 ppq. */
export const millisecondsAt = (date: number, tempo: ResolvedTempo): number =>
  millisecondsAtPpq(date, tempo, PULSES_PER_QUARTER);

/** Elapsed milliseconds from the start of `tempo`'s span to `date`, at 720 ppq. */
export const computeMillisecondsAt = (date: number, tempo: TempoWithEndDate): number =>
  computeMillisecondsAtPpq(date, tempo, PULSES_PER_QUARTER);

/** The tick span a millisecond span covers at a constant tempo, at 720 ppq. */
export const ticksForConstantTempo = (
  milliseconds: number,
  tempo: Pick<InstructionOptions<'tempo'>, 'bpm' | 'beatLength'>,
): number => ticksForConstantTempoAtPpq(milliseconds, tempo, PULSES_PER_QUARTER);

/** The exact inverse of {@link millisecondsAt}, at 720 ppq. */
export const dateAtMilliseconds = (targetMilliseconds: number, tempo: ResolvedTempo): number =>
  dateAtMillisecondsAtPpq(targetMilliseconds, tempo, PULSES_PER_QUARTER);

// ── Curve shape fitting ───────────────────────────────────────────

/**
 * Fits the `meanTempoAt` parameter (0–1) for a power-function tempo
 * curve by minimising the squared error against a sampled trail of
 * (seconds, bpm) points drawn by the user.
 *
 * The curve is evaluated by {@link tempoAt} over a unit span, so the shape being fitted is
 * exactly the shape the renderer draws. `x` stays a fraction of *elapsed seconds* rather than of
 * ticks, which is the domain the trail is drawn in and is deliberate: the desk asks "what shape
 * did you draw", and turning that into a tick-domain instruction is the fitter's job downstream.
 */
export function fitMeanTempoAt(
  from: { seconds: number; bpm: number },
  to: { seconds: number; bpm: number },
  trail: { seconds: number; bpm: number }[],
): number {
  const duration = to.seconds - from.seconds;
  const bpmRange = to.bpm - from.bpm;

  if (Math.abs(duration) < 1e-9 || Math.abs(bpmRange) < 1e-9 || trail.length < 2) return 0.5;

  const normalized = trail
    .map((pt) => ({
      x: (pt.seconds - from.seconds) / duration,
      bpm: pt.bpm,
    }))
    .filter((pt) => pt.x > 0.01 && pt.x < 0.99);

  if (normalized.length === 0) return 0.5;

  let bestIm = 0.5;
  let bestError = Infinity;

  for (let i = 2; i <= 98; i++) {
    const im = i / 100;
    // A unit span, so `tempoAt`'s progress term is `x` itself and nothing is lost to the
    // division. `beatLength` does not enter the tempo curve at all.
    const curve = resolveSpan({
      date: 0,
      endDate: 1,
      beatLength: 0.25,
      bpm: from.bpm,
      transitionTo: to.bpm,
      meanTempoAt: im,
    });
    let error = 0;
    for (const pt of normalized) {
      const predicted = tempoAt(curve, pt.x);
      error += (predicted - pt.bpm) ** 2;
    }
    if (error < bestError) {
      bestError = error;
      bestIm = im;
    }
  }

  return bestIm;
}

// ── Elapsed-time calculation ──────────────────────────────────────

/**
 * Computes elapsed milliseconds for a tempo segment of `segLengthBeats`
 * beats, transitioning from `startBpm` to `endBpm` with the given
 * `meanTempoAt` curve shape.
 *
 * Measured with the renderer's quadrature. A 200-step trapezoid rule of its own disagrees with
 * what the piece would actually sound like by **up to 31 ms (4.25%)** on short, steeply curved
 * segments — while {@link optimizeForElapsedTime}, its only caller of consequence, bisects
 * against it to a tolerance of 0.1 ms. Converging precisely on the wrong number is not an
 * improvement over converging loosely on the right one.
 *
 * `beatLength` cancels: elapsed time per beat is `60000 / T` whatever the beat is, so the span is
 * expressed in quarters here regardless of what the real instruction counts in.
 */
export function computeElapsedMs(
  startBpm: number,
  endBpm: number,
  meanTempoAt: number,
  segLengthBeats: number,
): number {
  return computeElapsedMsAt(startBpm, endBpm, meanTempoAt, segLengthBeats, PULSES_PER_QUARTER);
}

// ── Elapsed-time optimiser ────────────────────────────────────────

/**
 * Adjusts `startBpm`, `endBpm`, and `meanTempoAt` so the segment
 * spanning `[startTick, endTick)` matches `targetMs` milliseconds.
 *
 * Phase 1 – bisect `meanTempoAt` (shape only, BPMs unchanged).
 * Phase 2 – scale BPMs uniformly if phase 1 cannot reach the target.
 */
export function optimizeForElapsedTime(
  startBpm: number,
  endBpm: number,
  meanTempoAt: number,
  beatLength: number,
  startTick: number,
  endTick: number,
  targetMs: number,
): { startBpm: number; endBpm: number; meanTempoAt: number; bpmScaled: boolean } {
  const segLengthBeats = Math.abs(endTick - startTick) / beatLengthInTicks(beatLength);
  if (segLengthBeats <= 0 || targetMs <= 0) {
    return { startBpm, endBpm, meanTempoAt, bpmScaled: false };
  }

  if (Math.abs(startBpm - endBpm) < 0.5) {
    const neededBpm = (segLengthBeats * 60000) / targetMs;
    const avgBpm = (startBpm + endBpm) / 2;
    const scaled = Math.abs(neededBpm - avgBpm) > 0.5;
    return { startBpm: neededBpm, endBpm: neededBpm, meanTempoAt: 0.5, bpmScaled: scaled };
  }

  const msAt02 = computeElapsedMs(startBpm, endBpm, 0.02, segLengthBeats);
  const msAt98 = computeElapsedMs(startBpm, endBpm, 0.98, segLengthBeats);
  const msMin = Math.min(msAt02, msAt98);
  const msMax = Math.max(msAt02, msAt98);

  if (targetMs >= msMin && targetMs <= msMax) {
    const increasing = msAt98 > msAt02;
    let lo = 0.02,
      hi = 0.98;

    for (let iter = 0; iter < 50; iter++) {
      const mid = (lo + hi) / 2;
      const msMid = computeElapsedMs(startBpm, endBpm, mid, segLengthBeats);
      if (Math.abs(msMid - targetMs) < 0.1) {
        return { startBpm, endBpm, meanTempoAt: mid, bpmScaled: false };
      }
      if (msMid < targetMs === increasing) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    return { startBpm, endBpm, meanTempoAt: (lo + hi) / 2, bpmScaled: false };
  }

  const currentMs = computeElapsedMs(startBpm, endBpm, meanTempoAt, segLengthBeats);
  const scale = currentMs / targetMs;
  return {
    startBpm: startBpm * scale,
    endBpm: endBpm * scale,
    meanTempoAt,
    bpmScaled: true,
  };
}
