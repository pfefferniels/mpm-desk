import { describe, expect, test } from 'vitest';
import { innerControlPointsXPositions, transitionValueAt } from 'espressivo';
import {
  approximateMovements,
  movementIds,
  type FittedMovement,
} from '../../../src/fitting/transformers/pedal/approximateMovement';
import { switchTravel, type Travel } from '../../../src/performance/pedalTravel';
import { defaultPress } from '../../../src/desks/corrections/lineDraft';
import { MODELLED_PRESS, onGrid } from './pressLine';

/** 120 bpm at 720 ppq: 1.44 ticks to the millisecond. */
const TICKS_PER_MS = 1.44;

const kinds = (movements: readonly FittedMovement[]) =>
  movements.map((m) => (m.transitionTo === undefined ? 'constant' : 'transition'));

/** Where a fitted transition stands at `date`, as the renderer would put it. */
const fittedAt = (movement: FittedMovement, endDate: number, date: number): number => {
  const [x1, x2] = innerControlPointsXPositions(movement.curvature ?? 0.4, movement.protraction ?? 0);
  return transitionValueAt(x1, x2, movement.date, endDate, movement.position, movement.transitionTo ?? movement.position, date);
};

describe('what a line comes to', () => {
  test('a switch is the two constants it is', () => {
    const movements = approximateMovements(onGrid(switchTravel(1000), TICKS_PER_MS));

    expect(movements).toEqual([
      { date: 0, position: 1 },
      { date: 1440, position: 0 },
    ]);
  });

  test('a modelled press is a traversal, the hold, a traversal and the rest', () => {
    const movements = approximateMovements(onGrid(MODELLED_PRESS, TICKS_PER_MS));

    expect(kinds(movements)).toEqual(['transition', 'constant', 'transition', 'constant']);
    const [down, held, up, rest] = movements;
    expect(down).toMatchObject({ date: 0, position: 0.04, transitionTo: 1 });
    expect(held).toEqual({ date: 191 * TICKS_PER_MS, position: 1 });
    expect(up).toMatchObject({ date: 2846 * TICKS_PER_MS, position: 0.99, transitionTo: 0 });
    expect(rest).toEqual({ date: 3039 * TICKS_PER_MS, position: 0 });
  });

  test('the bend of a traversal passes close to the vertices it was read from', () => {
    const line = onGrid(MODELLED_PRESS, TICKS_PER_MS);
    const [down, held] = approximateMovements(line);
    const rise = line.slice(0, 18);

    expect(down.curvature).toBeGreaterThanOrEqual(0);
    expect(down.curvature).toBeLessThanOrEqual(1);
    expect(Math.abs(down.protraction ?? 0)).toBeLessThanOrEqual(1);
    for (const vertex of rise) {
      expect(Math.abs(fittedAt(down, held.date, vertex.date) - vertex.position)).toBeLessThan(0.08);
    }
  });

  test('a line drawn by hand, four vertices up and four down, is fitted the same way', () => {
    const movements = approximateMovements(onGrid(defaultPress(), TICKS_PER_MS));

    expect(kinds(movements)).toEqual(['transition', 'constant', 'transition', 'constant']);
    expect(movements[1]).toEqual({ date: 190 * TICKS_PER_MS, position: 1 });
    expect(movements[2]).toMatchObject({ date: 810 * TICKS_PER_MS, position: 1, transitionTo: 0 });
  });

  test('a stretch slower than any traversal is a hold, whatever way it leans', () => {
    // Down at once, then drifting from 1 to 0.9 over four seconds, then up at once.
    const drifting: Travel = [
      { ms: 0, position: 1 },
      { ms: 4000, position: 0.9 },
      { ms: 4100, position: 0.6 },
      { ms: 4200, position: 0.3 },
      { ms: 4300, position: 0 },
    ];
    const movements = approximateMovements(onGrid(drifting, TICKS_PER_MS));

    expect(kinds(movements)).toEqual(['constant', 'transition', 'constant']);
    expect(movements[1]).toMatchObject({ date: 4000 * TICKS_PER_MS, position: 0.9, transitionTo: 0 });
  });

  test('a retake is two of everything', () => {
    const retake: Travel = [
      { ms: 0, position: 0.3 }, { ms: 50, position: 0.7 }, { ms: 100, position: 1 },
      { ms: 600, position: 0.7 }, { ms: 650, position: 0.4 }, { ms: 700, position: 0.2 },
      { ms: 750, position: 0.6 }, { ms: 800, position: 1 },
      { ms: 1500, position: 0.6 }, { ms: 1550, position: 0.3 }, { ms: 1600, position: 0 },
    ];
    const movements = approximateMovements(onGrid(retake, TICKS_PER_MS));

    expect(kinds(movements)).toEqual(['transition', 'transition', 'transition', 'transition', 'constant']);
    expect(movementIds('p', movements)).toEqual(['p_down', 'p_up', 'p_down_2', 'p_up_2', 'p_rest']);
  });

  test('a constant restating the position held is no movement', () => {
    const plateau: Travel = [
      { ms: 0, position: 1 },
      { ms: 500, position: 1 },
      { ms: 1000, position: 1 },
      { ms: 1500, position: 0 },
    ];

    expect(approximateMovements(onGrid(plateau, TICKS_PER_MS))).toEqual([
      { date: 0, position: 1 },
      { date: 1500 * TICKS_PER_MS, position: 0 },
    ]);
  });

  test('fits the same line the same way twice', () => {
    const line = onGrid(MODELLED_PRESS, TICKS_PER_MS);

    expect(approximateMovements(line)).toEqual(approximateMovements(line));
  });
});

describe('what a movement is called', () => {
  test('names each for what it does to the pedal', () => {
    const movements = approximateMovements(onGrid(MODELLED_PRESS, TICKS_PER_MS));

    expect(movementIds('sustain-720', movements)).toEqual([
      'sustain-720_down',
      'sustain-720_held',
      'sustain-720_up',
      'sustain-720_rest',
    ]);
  });

  test('names a switch as down and rest', () => {
    expect(movementIds('p', approximateMovements(onGrid(switchTravel(400), TICKS_PER_MS)))).toEqual(['p_down', 'p_rest']);
  });
});
