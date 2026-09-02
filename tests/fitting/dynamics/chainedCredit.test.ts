/**
 * What a chain of dynamics fits is credited with, joint by joint.
 *
 * Each fit closes its curve with a `<dynamics>` at the end of its window, and the next fit lands
 * on that date and fills its curve into the same element — so the joint is credited to both
 * calls. The editor's selection relies on the shape of that credit: the later call *leads* with
 * the joint, and that is how `CallSelection` tells the curve drawn there from the closer it began
 * as.
 */
import { expect, test } from 'vitest';
import { Alignment } from '../../../src/fitting/alignment';
import { createMpm } from '../../../src/fitting/instructions/index';
import { InsertDynamicsInstructions } from '../../../src/fitting/transformers/index';

const note = (position: number, velocity: number) => ({
  'xml:id': `n_${position}`,
  date: position * 720,
  part: 1,
  staff: '1',
  layer: '1',
  pitchname: 'g',
  octave: 4,
  duration: 720,
  accidentals: 0,
  'midi.pitch': 67,
  'milliseconds.date': position * 1000,
  'milliseconds.date.end': position * 1000 + 900,
  velocity,
});

const msm = () =>
  new Alignment(
    [note(0, 40), note(1, 60), note(2, 80), note(3, 70), note(4, 50)],
    [{ date: 0, numerator: 4, denominator: 4 }],
  );

const fit = (from: number, to: number) =>
  new InsertDynamicsInstructions({ scope: 'global', from, to, phantomVelocities: new Map() });

test('chained fits: the second is credited with the closer it fills in, and leads with it', () => {
  const alignment = msm();
  const mpm = createMpm();
  const first = fit(0, 1440);
  const second = fit(1440, 2880);

  first.run(alignment, mpm);
  second.run(alignment, mpm);

  expect(first.created).toEqual(['dynamics_0', 'dynamics_1440']);
  expect(second.created).toEqual(['dynamics_1440', 'dynamics_2880']);
});

test('a fit whose window ends on an existing curve leaves that curve to its own call', () => {
  const alignment = msm();
  const mpm = createMpm();
  const later = fit(1440, 2880);
  const earlier = fit(0, 1440);

  later.run(alignment, mpm);
  earlier.run(alignment, mpm);

  expect(later.created).toEqual(['dynamics_1440', 'dynamics_2880']);
  expect(earlier.created).toEqual(['dynamics_0']);
});
