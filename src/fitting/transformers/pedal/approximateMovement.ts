import { fitTransitionCurve, type TransitionShape } from 'espressivo';
import { hashSeed, seededRandom } from '../../random';
import type { TickVertex } from '../tempo/tickTimes';

/** A movement as the fit states it: where it starts, what it holds or moves towards, and how it bends. */
export interface FittedMovement {
  readonly date: number;
  readonly position: number;
  readonly transitionTo?: number;
  readonly curvature?: number;
  readonly protraction?: number;
}

const STRAIGHT: TransitionShape = { curvature: 0.5, protraction: 0 };
const MAX_ITERATIONS = 5000;
/** What counts as explained: two hundredths of the stroke per vertex, summed over the traversal. */
const ERROR_PER_VERTEX = 0.02;
/**
 * Slower than this, a stretch of the line is a hold and not a traversal: a full stroke in ten
 * seconds. A red Welte's takes 190 ms, and a thinned record has no vertex where a plateau ends,
 * only a long gap before the first vertex of the next traversal.
 */
const HOLD_PER_MS = 0.1 / 1000;

const isTraversalStep = (from: TickVertex, to: TickVertex, direction: number): boolean =>
  Math.sign(to.position - from.position) === direction &&
  Math.abs(to.position - from.position) / (to.ms - from.ms) >= HOLD_PER_MS;

/** The last index of the traversal starting at `start`, which is `start` itself where none does. */
const traversalEnd = (line: readonly TickVertex[], start: number): number => {
  const next = line[start + 1];
  if (!next) return start;
  const direction = Math.sign(next.position - line[start].position);
  if (!isTraversalStep(line[start], next, direction)) return start;
  const broken = line.findIndex((vertex, i) => i > start + 1 && !isTraversalStep(line[i - 1], vertex, direction));
  return broken === -1 ? line.length - 1 : broken - 1;
};

/** The bend that passes closest through a traversal's vertices, its ends taken from the record. */
const bend = (traversal: readonly TickVertex[]): TransitionShape => {
  const first = traversal[0];
  const last = traversal[traversal.length - 1];
  const samples = traversal.map(({ date, position }) => ({ date, value: position }));
  const { curvature, protraction } = fitTransitionCurve(
    { startDate: first.date, endDate: last.date, from: first.position, to: last.position },
    samples,
    {
      initial: STRAIGHT,
      // Seeded from the samples, not from a clock, so the same line fits the same way twice.
      random: seededRandom(hashSeed(JSON.stringify(samples))),
      maxIterations: MAX_ITERATIONS,
      tolerance: ERROR_PER_VERTEX * samples.length,
    },
  );
  return { curvature, protraction };
};

/**
 * The movements a press's line comes to.
 *
 * The record holds each position until the next vertex, and a line thinned from a modelled
 * traversal is a staircase of small steps. Three vertices or more moving one way at a traversal's
 * pace are read as the traversal they sample and become one transition, bent to pass through
 * them; a single step stays a step, so a switch is written as the two constants it is. A constant
 * restating the position already held is no movement and is left out, except right after a
 * transition, where it is what ends the transition.
 */
export const approximateMovements = (line: readonly TickVertex[]): FittedMovement[] => {
  const movements: FittedMovement[] = [];
  const restates = (vertex: TickVertex) => {
    const last = movements.at(-1);
    return last !== undefined && last.transitionTo === undefined && last.position === vertex.position;
  };

  let at = 0;
  while (at < line.length) {
    const end = traversalEnd(line, at);
    if (end - at >= 2) {
      const traversal = line.slice(at, end + 1);
      movements.push({
        date: line[at].date,
        position: line[at].position,
        transitionTo: line[end].position,
        ...bend(traversal),
      });
      at = end;
      continue;
    }
    if (!restates(line[at])) movements.push({ date: line[at].date, position: line[at].position });
    at += 1;
  }
  return movements;
};

/** What a movement does to the pedal, read against the position held before it. */
const roleOf = (before: number, movement: FittedMovement): string => {
  if (movement.transitionTo === undefined && movement.position === 0) return 'rest';
  const reached = movement.transitionTo ?? movement.position;
  return reached > before ? 'down' : reached < before ? 'up' : 'held';
};

/**
 * An id per movement, named for what it does: `_down`, `_held`, `_up`, `_rest`, with an ordinal
 * where a press does the same thing twice, as a retake does.
 */
export const movementIds = (pressId: string, movements: readonly FittedMovement[]): string[] => {
  const seen = new Map<string, number>();
  let before = 0;
  return movements.map((movement) => {
    const role = roleOf(before, movement);
    before = movement.transitionTo ?? movement.position;
    const nth = (seen.get(role) ?? 0) + 1;
    seen.set(role, nth);
    return nth === 1 ? `${pressId}_${role}` : `${pressId}_${role}_${String(nth)}`;
  });
};
