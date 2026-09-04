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
 * endpoint rule is stated there, once, for every caller.
 *
 * The absent-target test is `??` rather than truthiness: a `@transition.to` of **0**, a dynamics
 * fading to silence or a pedal lifting fully, is a real target, which
 * `!instruction["transition.to"]` reads as no transition at all and holds the start value flat
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

const MAX_ERROR = 5;
const MAX_ITERATIONS = 5000;

/** The shape the search departs from: a straight ramp, which assumes nothing about the bend. */
const STRAIGHT: TransitionShape = { curvature: 0.5, protraction: 0 };

/**
 * The `<dynamics>` that best explains a run of measured velocities.
 *
 * The search is espressivo's `fitTransitionCurve`, which owns the curve and so owns the hunt
 * through it, clamps included. What stays here is what the library has no standing to decide.
 *
 * **The endpoints are taken, not fitted.** The first and last velocity become `@volume` and
 * `@transition.to`: a reduction explains deviation, and inventing endpoints the recording does
 * not show would explain the wrong thing.
 *
 * **A series too short to bend.** One point is a constant, and two, or any run beginning and
 * ending at the same velocity, is a straight ramp (`curvature: 0.5, protraction: 0`). Two points
 * determine a line, so searching for a bend between them fits noise.
 *
 * **What counts as explained.** `MAX_ERROR` is five velocity steps over the whole run, which is a
 * claim about how precisely a piano roll reports a velocity rather than about a Bézier.
 *
 * **The seed is the points.** Re-running a chain must produce the same document, so the generator
 * is seeded from the data being fitted rather than from a clock. Passing nothing would get
 * `Math.random`, and the same work file would reconstruct differently every time.
 */
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
