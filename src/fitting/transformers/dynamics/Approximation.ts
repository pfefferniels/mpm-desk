import type { AddMovementOptions } from 'espressivo';
import {
  bezierPoint,
  innerControlPointsXPositions,
  tForDate,
} from 'espressivo';
import type { Normalized } from 'espressivo';
import { v4 } from 'uuid';
import type { DynamicsWithEndDate } from './InsertDynamicsInstructions';
import { hashSeed, type Random, seededRandom } from '../../random';
import { head, isNonEmpty, last } from 'espressivo';

export interface DynamicsPoints {
  date: number;
  velocity: number;
}

export interface InnerControlPoints {
  x1: number;
  x2: number;
}

/**
 * The two inner control points of the cubic Bézier a `<dynamics>` or `<movement>` transition is
 * shaped by, derived from `@curvature` and `@protraction`.
 *
 * espressivo's, not a second copy: the `protraction === 0` branch is not an optimisation — the
 * general formula divides by `protraction` — and getting that wrong is invisible until a curve
 * bends the wrong way. Callers default an absent `@curvature`/`@protraction` before calling,
 * because the two elements do not share a default: `<dynamics>` takes 0.0 for curvature and
 * `<movement>` takes 0.4.
 */
export const computeInnerControlPointsXPositions = (
  curvature: number,
  protraction: number,
): InnerControlPoints => {
  const [x1, x2] = innerControlPointsXPositions(curvature, protraction);
  return { x1, x2 };
};

/**
 * The value a transition holds at `date`, for the one shape `<dynamics>` and `<movement>` share.
 *
 * Both elements ramp from a start value to a `@transition.to` along a cubic Bézier whose
 * x-component is inverted to find the curve parameter. This is that shape once, for both, with
 * the inversion (`tForDate`) and the cubic (`bezierPoint`) taken from espressivo rather than
 * rewritten beside it.
 *
 * The absent-target test is `??` and not truthiness: a `@transition.to` of **0** — a dynamics
 * fading to silence, a pedal lifting fully — is a real target, which
 * `!instruction["transition.to"]` reads as no transition at all, holding the start value flat
 * across the whole span. See issue #46.
 */
const transitionValueAt = (
  span: { date: number; endDate: number } & InnerControlPoints,
  from: number,
  to: number,
  date: number,
): number => {
  if (date < span.date) return from;
  if (from === to) return from;
  if (date >= span.endDate) return to;

  // `tForDate` is a binary search that stops within one tick on the x-axis, so it only ever
  // *approximates* the two endpoints. espressivo answers them before calling it
  // (`tForDynamicsDate`, `tForMovementDate`, both of which say so), and a caller that skips
  // this reads 99.93 where the instruction plainly says 100. Not a shortcut.
  const t = date === span.date ? 0.0 : tForDate(span.x1, span.x2, span.date, span.endDate, date);
  return bezierPoint(span.x1, span.x2, span.date, span.endDate, from, to, t)[1];
};

/**
 * What the fitted `<dynamics>` sounds `date` at.
 *
 * `@volume` and `@transition.to` are `number | string` — espressivo writes a style-relative name
 * such as `"forte"` verbatim, so the wording a document used round-trips — and the `+` is what
 * this evaluator has always done with them. It is applied *after* the `??`, so a target of **0**
 * is still a target; see the header on issue #46.
 */
export const volumeAtDate = (
  instruction: DynamicsWithEndDate & InnerControlPoints,
  date: number,
): number =>
  transitionValueAt(
    instruction,
    +instruction.volume,
    +(instruction.transitionTo ?? instruction.volume),
    date,
  );

/**
 * Where the fitted `<movement>` puts its controller at `date`.
 *
 * `@position` is optional on the element — a `<movement>` with none inherits where the previous
 * one ended — but that is a question only the map can answer, so this asks for the resolved
 * position it is going to interpolate from.
 */
export const positionAtDate = (
  instruction: AddMovementOptions & { position: Normalized; endDate: number } & InnerControlPoints,
  date: number,
): number =>
  transitionValueAt(
    instruction,
    instruction.position,
    instruction.transitionTo ?? instruction.position,
    date,
  );

const computeError = (instruction: DynamicsWithEndDate, points: readonly DynamicsPoints[]) => {
  const computedInstruction = {
    ...instruction,
    // `<dynamics>` defaults both to 0.0, which is what `resolveDynamics` fills in — scoring
    // a candidate as if the attributes were merely missing would fit against a curve the
    // renderer never draws.
    ...computeInnerControlPointsXPositions(
      instruction.curvature ?? 0.0,
      instruction.protraction ?? 0.0,
    ),
  };

  let sum = 0;
  for (const point of points) {
    const assumed = volumeAtDate(computedInstruction, point.date);
    const real = point.velocity;
    const error = Math.abs(assumed - real);
    sum += error;
  }

  return sum;
};

const generateNeighbour = (prev: DynamicsWithEndDate, random: Random) => {
  // Define the magnitude of the maximum possible change
  const maxProtractionChange = 0.05;
  const maxCurvatureChange = 0.05;

  // Generate random changes within the defined range
  const newProtraction = (prev.protraction ?? 0.0) + (random() * 2 - 1) * maxProtractionChange;
  const newCurvature = (prev.curvature ?? 0.0) + (random() * 2 - 1) * maxCurvatureChange;

  // Ensure the new values are within valid bounds
  const validProtraction = Math.max(Math.min(newProtraction, 1.0), -1.0);
  const validCurvature = Math.max(Math.min(newCurvature, 1.0), 0.0);

  return {
    ...prev,
    protraction: validProtraction,
    curvature: validCurvature,
  };
};

export const approximateDynamics = (points: DynamicsPoints[]): DynamicsWithEndDate | undefined => {
  if (!isNonEmpty(points)) {
    console.error('approximateDynamics requires at least one point');
    return;
  }

  const first = head(points);
  const final = last(points);

  if (points.length === 1) {
    return {
      id: `dynamics_${v4()}`,
      date: first.date,
      endDate: first.date,
      volume: first.velocity,
    };
  }

  const equal = first.velocity === final.velocity;
  if (points.length === 2 || equal) {
    return {
      id: `dynamics_${v4()}`,
      date: first.date,
      endDate: final.date,
      volume: first.velocity,
      transitionTo: equal ? undefined : final.velocity,
      protraction: 0,
      curvature: 0.5,
    };
  }

  const initial: DynamicsWithEndDate = {
    id: `dynamics_${v4()}`,
    date: first.date,
    endDate: final.date,
    volume: first.velocity,
    transitionTo: final.velocity,
    protraction: 0,
    curvature: 0.5,
  };

  // Seeded from the points, not from a clock: the same curve is fitted the same way every
  // time the chain is re-run.
  const random = seededRandom(hashSeed(JSON.stringify(points)));

  const maxIterations = 5000;
  const maxError = 5;
  let error = computeError(initial, points);
  let attempt = initial;
  let bestAttempt = attempt;
  let bestError = error;
  let temperature = 1.0; // Initial temperature
  const coolingRate = 0.99; // Cooling rate

  for (let i = 0; i < maxIterations && error > maxError; i++) {
    const neighbor = generateNeighbour(attempt, random);
    const neighborError = computeError(neighbor, points);

    if (neighborError < bestError) {
      bestAttempt = neighbor;
      bestError = neighborError;
    }

    const acceptanceProbability = Math.exp((error - neighborError) / temperature);
    if (neighborError < error || random() < acceptanceProbability) {
      attempt = neighbor;
      error = neighborError;
    }

    // Cool down the temperature
    temperature *= coolingRate;
  }

  return bestAttempt;
};
