import { describe, expect, test } from 'vitest';
import {
  createMpm,
  exportMPM,
  getInstructions,
  requireMap,
  withoutMaps,
} from '../../../src/fitting/instructions/index';

const populated = () => {
  const mpm = createMpm();
  requireMap(mpm, 'tempo', 'global').addTempo({ id: 't1', date: 0, bpm: 120, beatLength: 0.25 });
  requireMap(mpm, 'dynamics', 'global').addDynamics({ id: 'd1', date: 0, volume: 64 });
  requireMap(mpm, 'dynamics', 1).addDynamics({ id: 'd2', date: 720, volume: 90 });
  return mpm;
};

describe('withoutMaps', () => {
  test('drops the named maps in every scope', () => {
    const probe = withoutMaps(populated(), ['dynamics']);

    expect(getInstructions(probe, 'dynamics')).toHaveLength(0);
    expect(getInstructions(probe, 'tempo')).toHaveLength(1);
    expect(exportMPM(probe)).not.toContain('dynamicsMap');
    expect(exportMPM(probe)).toContain('tempoMap');
  });

  test('leaves the document it was taken from untouched', () => {
    const mpm = populated();
    const before = exportMPM(mpm);

    withoutMaps(mpm, ['dynamics', 'tempo']);

    expect(exportMPM(mpm)).toEqual(before);
    expect(getInstructions(mpm, 'dynamics')).toHaveLength(2);
    expect(getInstructions(mpm, 'tempo')).toHaveLength(1);
  });

  test('an empty list is a faithful copy', () => {
    const mpm = populated();
    expect(exportMPM(withoutMaps(mpm, []))).toEqual(exportMPM(mpm));
  });
});
