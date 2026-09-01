import { describe, expect, test } from 'vitest';
import {
  AccentuationPatternDef,
  createMpm,
  type InstructionOptions,
  insertDefinition,
  instructionsEffectiveAtDate,
  requireMap,
  unwrap,
} from '../../../src/fitting/instructions/index';
import { PULSES_PER_WHOLE } from '../../../src/fitting/ppq';
import { only } from '../../support/at';

const withTempo = (...tempos: InstructionOptions<'tempo'>[]) => {
  const mpm = createMpm();
  const map = requireMap(mpm, 'tempo', 'global');
  for (const tempo of tempos) map.addTempo(tempo);
  return mpm;
};

const tempo = (date: number, bpm: number): InstructionOptions<'tempo'> => ({
  id: `tempo_${date}`,
  date,
  bpm,
  beatLength: 0.25,
});

const withRubato = (over: Partial<InstructionOptions<'rubato'>> = {}) => {
  const mpm = createMpm();
  requireMap(mpm, 'rubato', 'global').addRubato({
    id: 'rubato_0',
    date: 0,
    frameLength: 720,
    intensity: 1.2,
    ...over,
  });
  return mpm;
};

/**
 * "The instructions in force at a date" is a set, and the function now answers with one.
 *
 * It used to answer with a list that could name the same instruction two or three times: one at
 * the requested date was pushed by the exact-date filter and again as the last one still
 * running, and a *looping* rubato covering the date matched two separate `if`s rather than one
 * condition. Every caller takes `[0]`, so nothing was broken — which is exactly why it is worth
 * pinning before someone reads the name and believes it (issue #47).
 */
describe('instructionsEffectiveAtDate', () => {
  test('names an instruction at the requested date once, not twice', () => {
    const mpm = withTempo(tempo(0, 60));

    expect(instructionsEffectiveAtDate(mpm, 0, 'tempo', 'global')).toHaveLength(1);
  });

  test('a looping rubato covering the date is named once, not three times', () => {
    const mpm = withRubato({ loop: true });

    expect(instructionsEffectiveAtDate(mpm, 0, 'rubato', 'global')).toHaveLength(1);
    expect(instructionsEffectiveAtDate(mpm, 360, 'rubato', 'global')).toHaveLength(1);
  });

  test('a loop still counts as in force past its own frame', () => {
    const mpm = withRubato({ loop: true });

    expect(instructionsEffectiveAtDate(mpm, 2000, 'rubato', 'global')).toHaveLength(1);
  });

  test('a rubato that does not loop stops at the end of its frame', () => {
    const mpm = withRubato();

    expect(instructionsEffectiveAtDate(mpm, 719, 'rubato', 'global')).toHaveLength(1);
    expect(instructionsEffectiveAtDate(mpm, 720, 'rubato', 'global')).toHaveLength(0);
  });

  test('the earlier tempo still running is named, and the later one is not yet', () => {
    const mpm = withTempo(tempo(0, 60), tempo(2880, 90));

    const effective = instructionsEffectiveAtDate(mpm, 1440, 'tempo', 'global');
    expect(effective).toHaveLength(1);
    expect(only(effective, 'tempo').bpm).toBe(60);
  });
});

/**
 * How long an `<accentuationPattern>` covers depends on the metre, which an MPM document does
 * not carry — `@length` is in beats and a beat is `4 * ppq / denominator` ticks, the conversion
 * espressivo's `MetricalAccentuationMap` makes when it renders one. The span used to be spelled
 * `def.length * 720 * 4 / 4`, which is the 4/4 assumption with the denominator's place left in
 * the arithmetic as a cancelling `4 / 4` (issue #42). The caller says which metre it means now,
 * and 4 remains the default.
 */
describe("an accentuation pattern's span", () => {
  const withPattern = (length: number) => {
    const mpm = createMpm();
    const def = unwrap(AccentuationPatternDef.fromNameLength('downbeat', length));
    def.addAccentuation(1, 1, 1, 0);
    insertDefinition(mpm, 'accentuationPatternDef', def, 'global');
    requireMap(mpm, 'accentuationPattern', 'global').addAccentuationPattern({
      id: 'accentuationPattern_0',
      date: 0,
      accentuationPatternDefName: 'downbeat',
      scale: 1,
    });
    return mpm;
  };

  test('four quarter-note beats reach one whole note', () => {
    const mpm = withPattern(4);
    const justInside = PULSES_PER_WHOLE - 1;

    expect(
      instructionsEffectiveAtDate(mpm, justInside, 'accentuationPattern', 'global'),
    ).toHaveLength(1);
    expect(
      instructionsEffectiveAtDate(mpm, PULSES_PER_WHOLE, 'accentuationPattern', 'global'),
    ).toHaveLength(0);
  });

  test('six eighth-note beats reach three quarters, not six', () => {
    const mpm = withPattern(6);
    const barIn68 = (PULSES_PER_WHOLE * 6) / 8;
    const sixEight = [{ date: 0, numerator: 6, denominator: 8 }];

    expect(
      instructionsEffectiveAtDate(mpm, barIn68 - 1, 'accentuationPattern', 'global', sixEight),
    ).toHaveLength(1);
    expect(
      instructionsEffectiveAtDate(mpm, barIn68, 'accentuationPattern', 'global', sixEight),
    ).toHaveLength(0);

    // Read as quarters — the old, unconditional assumption — the same pattern claims twice
    // the span it has.
    expect(instructionsEffectiveAtDate(mpm, barIn68, 'accentuationPattern', 'global')).toHaveLength(
      1,
    );
  });
});
