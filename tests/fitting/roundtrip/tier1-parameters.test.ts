import { describe, expect, test } from 'vitest';
import { performMsmToData } from 'espressivo';
import {
  createMpm,
  exportMPM,
  getDefinitions,
  getInstructions,
} from '../../../src/fitting/instructions/index';
import { compareTransformers } from '../../../src/fitting/transformers/index';
import {
  InsertTempo,
  TranslatePhysicalTimeToTicks,
} from '../../../src/fitting/transformers/tempo/index';
import { InsertDynamicsInstructions } from '../../../src/fitting/transformers/dynamics/index';
import { InsertArticulation } from '../../../src/fitting/transformers/articulation/InsertArticulation';
import { at, only } from '../../support/at';
import { buildScore, QUARTER } from './score';
import { truthMpm } from './truth';
import { roundTrip, notesOf } from './harness';
import { tierTwoCases } from './cases';

/**
 * Tier 1 — the diagnostic tier.
 *
 * These compare **MPM parameters** against the truth's, which the round trip deliberately does
 * not: MPM to performance is many-to-one, so a chain is entitled to explain a performance
 * differently than the truth did. That freedom is exactly what makes a failing round trip hard
 * to read — it says the chain is wrong without saying where.
 *
 * So each case here is built to be *identifiable*: one aspect, exactly representable, and the
 * segmentation handed in, such that there is only one sensible answer and the fitter either
 * writes it or does not. When a tier-2 or tier-3 case fails, these are what say which fitter.
 */

const caseNamed = (name: string) => tierTwoCases.find((spec) => spec.name === name)!;

/*
 * `the tempo fitter recovers its own curve` used to open this file — a constant tempo coming
 * back as one instruction at that bpm, and a ritardando coming back with both boundary tempos
 * to within a bpm. Both measured `ApproximateLogarithmicTempo`, which is not part of this
 * application: `InsertTempo` writes down the tempo it is given, so there is no curve to
 * recover and no fit to diagnose. The two cases they read (`tempo: constant` and
 * `tempo: ritardando 120 to 60`) went from `cases.ts` for the same reason.
 */

describe('the dynamics fitter recovers its own curve', () => {
  test('a linear crescendo comes back with both boundary volumes', () => {
    const { fitted } = roundTrip(caseNamed('dynamics: linear crescendo 40 to 100'));
    const dynamics = getInstructions(fitted, 'dynamics', 'global').sort((a, b) => a.date - b.date);

    expect(dynamics.length).toBeGreaterThanOrEqual(2);
    expect(at(dynamics, 0, 'dynamics').volume as number).toBeCloseTo(40, 0);
    expect(at(dynamics, 0, 'dynamics').transitionTo as number).toBeCloseTo(100, 0);
  });

  test('a constant dynamic comes back flat, with no transition at all', () => {
    const { fitted } = roundTrip(caseNamed('dynamics: constant'));
    const dynamics = getInstructions(fitted, 'dynamics', 'global');

    expect(at(dynamics, 0, 'dynamics').volume as number).toBeCloseTo(70, 4);
    expect(at(dynamics, 0, 'dynamics').transitionTo).toBeUndefined();
  });
});

describe('the articulation fitter recovers its own ratios', () => {
  test('a uniform legato comes back as one def at that relativeDuration', () => {
    const { fitted } = roundTrip(caseNamed('articulation: one legato for every note'));
    const defs = getDefinitions(fitted, 'articulationDef', 'global');

    expect(defs).toHaveLength(1);
    expect(only(defs, 'articulationDef').getRelativeDuration()).toBeCloseTo(1.3, 2);
  });

  /**
   * The identity behind issue #23, isolated.
   *
   * `relativeVelocity` is a factor on what the dynamics curve prescribes, so its divisor has
   * to be that prescribed value — the velocity a render of the rest of the MPM would sound —
   * and not the performed velocity. With one articulation unit per note there is no averaging
   * to blur the result, so the round trip is *exact*: the renderer computes `prescribed x
   * (recorded/prescribed)` and lands back on `recorded`.
   *
   * Under the old divisor this same case errs by up to 43 velocity units, so a regression here
   * is unmissable rather than a slightly worse mean.
   */
  test('per-note articulation units reproduce the performed velocity exactly (#23)', () => {
    const score = buildScore({ beats: 8 });
    const scoreXml = score.serialize()!;
    const scoreNotes = score.allNotes.map((note) => ({ id: note['xml:id'], date: note.date }));

    const truthXml = truthMpm(
      {
        tempo: [{ date: 0, bpm: 120 }],
        dynamics: [{ date: 0, volume: 64 }],
        articulation: {
          defs: [
            { name: 'loud', relativeVelocity: 1.4 },
            { name: 'soft', relativeVelocity: 0.7 },
          ],
          pattern: ['loud', 'soft'],
        },
      },
      scoreNotes,
    );

    const truthPerformance = performMsmToData({ msm: scoreXml, mpm: truthXml });
    const performed = buildScore({ beats: 8 });
    const byId = new Map(notesOf(truthPerformance).map((note) => [note.id, note]));
    for (const note of performed.allNotes) {
      const rendered = byId.get(note['xml:id'])!;
      note['milliseconds.date'] = rendered.milliseconds.date;
      note['milliseconds.date.end'] = rendered.milliseconds.end;
      note.velocity = rendered.velocity;
    }

    const mpm = createMpm();
    const chain = [
      // The truth above states 120 bpm flat, so stating it back is exactly what a tempo fit
      // of it would land on. This test is about velocity, and needs a tempo map only so
      // `TranslatePhysicalTimeToTicks` has one to convert the performed onsets against.
      new InsertTempo({
        scope: 'global',
        from: 0,
        to: 7 * QUARTER,
        bpm: 120,
        beatLength: 0.25,
      }),
      new TranslatePhysicalTimeToTicks({ translatePhysicalModifiers: true }),
      new InsertDynamicsInstructions({
        scope: 'global',
        from: 0,
        to: 7 * QUARTER,
        phantomVelocities: new Map(),
      }),
      ...performed.allNotes.map(
        (note) =>
          new InsertArticulation({
            scope: 'global',
            noteIDs: [note['xml:id']],
            aspects: new Set(['relativeVelocity' as const]),
            name: `unit_${note['xml:id']}`,
          }),
      ),
    ].sort(compareTransformers);
    for (const transformer of chain) transformer.run(performed, mpm);

    const refit = performMsmToData({ msm: scoreXml, mpm: exportMPM(mpm) });
    const truthVelocities = notesOf(truthPerformance).map((note) => note.velocity);
    const refitVelocities = notesOf(refit).map((note) => note.velocity);

    expect(truthVelocities).toEqual([89.6, 44.8, 89.6, 44.8, 89.6, 44.8, 89.6, 44.8]);
    refitVelocities.forEach((velocity, index) => {
      expect(velocity).toBeCloseTo(at(truthVelocities, index, 'truth velocity'), 6);
    });
  });
});
