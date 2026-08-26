import type { AddMovementOptions } from 'espressivo';
import { fitTransitionCurve, innerControlPointsXPositions, transitionValueAt } from 'espressivo';
import type { TransitionShape } from 'espressivo';
import type { Normalized } from 'espressivo';
import { v4 } from 'uuid';
import type { DynamicsWithEndDate } from './InsertDynamicsInstructions';
import { hashSeed, seededRandom } from '../../random';
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
 * espressivo's `transitionValueAt`, adapted to the record shape the transformers carry. The
 * endpoint rule that used to be written out here — `tForDate` is a binary search stopping within
 * one tick on the x-axis, so a caller reading it at the boundaries gets 99.93 where the
 * instruction plainly says 100 — is stated there now, once, for every caller.
 *
 * The absent-target test is `??` and not truthiness: a `@transition.to` of **0** — a dynamics
 * fading to silence, a pedal lifting fully — is a real target, which
 * `!instruction["transition.to"]` reads as no transition at all, holding the start value flat
 * across the whole span. See issue #46.
 */
const transitionValueOf = (
  span: { date: number; endDate: number } & InnerControlPoints,
  from: number,
  to: number,
  date: number,
): number =>
  transitionValueAt(span.x1, span.x2, span.date, span.endDate, from, to, date);

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
  transitionValueOf(
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
  transitionValueOf(
    instruction,
    instruction.position,
    instruction.transitionTo ?? instruction.position,
    date,
  );

/**
 * The `<dynamics>` that best explains a run of measured velocities.
 *
 * The search itself is espressivo's `fitTransitionCurve` — it owns the curve, so it owns the
 * shape of the hunt through it, including the clamps that keep a candidate inside `@curvature`
 * and `@protraction`'s declared ranges. What stays here is everything the library has no
 * standing to decide.
 *
 * **What the endpoints are.** The first and last velocity are taken as the transition's `@volume`
 * and `@transition.to` rather than fitted. A reduction explains deviation; inventing endpoints
 * the recording does not show would be explaining the wrong thing.
 *
 * **When a series is too short to bend.** One point is a constant, and two — or any run that
 * begins and ends at the same velocity — is a straight ramp, written as `curvature: 0.5,
 * protraction: 0`. Two points determine a line and nothing more, so searching for a bend
 * between them would fit noise and write it into the document as though it were meant.
 *
 * **What counts as explained.** `MAX_ERROR` is five velocity steps summed over the whole run.
 * That is a claim about how precisely a piano roll or an aligned recording reports a velocity,
 * which is a question about this repertoire and these sources, not about a Bézier.
 *
 * **Why the seed is the points.** Re-running a chain must produce the same document, so the
 * generator is seeded from the very data being fitted rather than from a clock. A caller that
 * passed nothing would get `Math.random`, and the same work file would reconstruct differently
 * every time it was opened.
 */
const MAX_ERROR = 5;
const MAX_ITERATIONS = 5000;

/** The shape the search departs from: a straight ramp, which assumes nothing about the bend. */
const STRAIGHT: TransitionShape = { curvature: 0.5, protraction: 0 };

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
      ...STRAIGHT,
    };
  }

  const span = {
    startDate: first.date,
    endDate: final.date,
    from: first.velocity,
    to: final.velocity,
  };

  const { curvature, protraction } = fitTransitionCurve(
    span,
    points.map((point) => ({ date: point.date, value: point.velocity })),
    {
      initial: STRAIGHT,
      // Seeded from the points, not from a clock: the same curve is fitted the same way every
      // time the chain is re-run.
      random: seededRandom(hashSeed(JSON.stringify(points))),
      maxIterations: MAX_ITERATIONS,
      tolerance: MAX_ERROR,
    },
  );

  return {
    id: `dynamics_${v4()}`,
    date: first.date,
    endDate: final.date,
    volume: first.velocity,
    transitionTo: final.velocity,
    curvature,
    protraction,
  };
};
