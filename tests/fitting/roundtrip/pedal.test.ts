import { describe, expect, test } from 'vitest';
import { performMsmToData } from 'espressivo';
import { createMpm, exportMPM, getInstructions } from '../../../src/fitting/instructions/index';
import { compareTransformers } from '../../../src/fitting/transformers/index';
import {
  InsertTempo,
  TranslatePhysicalTimeToTicks,
} from '../../../src/fitting/transformers/tempo/index';
import {
  InsertPedal,
  type InsertPedalOptions,
} from '../../../src/fitting/transformers/pedal/InsertPedalInstructions';
import type { AlignedPedal } from '../../../src/fitting/alignment';
import { at } from '../../support/at';
import { buildScore, QUARTER } from './score';
import { assertWellFormed } from './invariants';
import { MODELLED_PRESS } from '../pedal/pressLine';

/**
 * Pedalling.
 *
 * `InsertPedal` fits the bend of each traversal of a press's line; where the press starts, how
 * deep it goes and where it lifts are read off the record. What is asserted is that the
 * movements land where the line says, that the document is structurally sound, and — the part no
 * unit test can see — that the renderer actually produces a pedal from it. The shortcut that
 * hangs a ramp of stated length on one end of the press is kept for calls already written, and
 * checked as such.
 */

const SUSTAIN_DEPTH = 1;
/** Long enough that the ramp is a ramp, short enough to stay inside the first beat. */
const RAMP_TICKS = 60;
/** 120 bpm at 720 ppq, which is what the onsets below describe: 1.44 ticks to the millisecond. */
const TICKS_PER_MS = QUARTER / 500;

const press = (id: string, onsetMs: number, over: Partial<AlignedPedal> = {}): AlignedPedal => ({
  'xml:id': id,
  type: 'sustain',
  'milliseconds.date': onsetMs,
  'milliseconds.date.end': onsetMs + 1000,
  ...over,
});

const pedalledScore = (pedals: AlignedPedal[]) => {
  const score = buildScore({ beats: 8 });
  for (const note of score.allNotes) {
    // Half a second to the quarter, which is the 120 bpm the assertions below read back.
    const onset = (note.date / QUARTER) * 500;
    note['milliseconds.date'] = onset;
    note['milliseconds.date.end'] = onset + 500;
    note.velocity = 64;
  }
  score.pedals = pedals;
  return score;
};

/** Down on beat 1 and again on beat 5, as switches — 0 ms and 2000 ms at the 120 bpm the onsets describe. */
const switches = () => pedalledScore([press('ped0', 0), press('ped1', 2000)]);

/** One press with the line a Welte's bellows drew, three seconds long. */
const modelled = () =>
  pedalledScore([press('ped0', 0, { 'milliseconds.date.end': 3039, travel: MODELLED_PRESS })]);

const fitPedals = (score: ReturnType<typeof pedalledScore>, options: InsertPedalOptions = {}) => {
  const mpm = createMpm();
  const chain = [
    // The tempo is stated, not fitted: `pedalledScore` lays the onsets out at exactly 500 ms
    // to the quarter, so 120 bpm is the tempo those milliseconds describe rather than a guess
    // about them. What this file is about is downstream of it — `TranslatePhysicalTimeToTicks`
    // needs *a* tempo map to convert the pedal's milliseconds against, and the assertions read
    // 120 bpm back out of the render.
    new InsertTempo({
      scope: 'global',
      from: 0,
      to: 7 * QUARTER,
      bpm: 120,
      beatLength: 0.25,
    }),
    new TranslatePhysicalTimeToTicks({
      translatePhysicalModifiers: true,
      translatePedalling: true,
    }),
    new InsertPedal(options),
  ].sort(compareTransformers);
  for (const transformer of chain) transformer.run(score, mpm);
  return mpm;
};

const movementsOf = (mpm: ReturnType<typeof createMpm>) =>
  getInstructions(mpm, 'movement', 'global').sort((a, b) => a.date - b.date);

const sustainStream = (msmXml: string, mpmXml: string) => {
  const data = performMsmToData({ msm: msmXml, mpm: mpmXml });
  return data.parts
    .flatMap((part) => part.controlChanges)
    .find((stream) => stream.kind === 'position' && stream.controller === 'sustain');
};

describe('a press written from its line', () => {
  test('a switch is the two constants it is, where the press was', () => {
    const movements = movementsOf(fitPedals(switches()));

    expect(movements.map((m) => m.id)).toEqual(['ped0_down', 'ped0_rest', 'ped1_down', 'ped1_rest']);
    expect(at(movements, 0, 'movement').date).toBeCloseTo(0, 6);
    expect(at(movements, 0, 'movement').position).toBe(1);
    expect(at(movements, 0, 'movement').transitionTo).toBeUndefined();
    // A second long, which at 120 bpm is two quarters.
    expect(at(movements, 1, 'movement').date).toBeCloseTo(2 * QUARTER, 3);
    expect(at(movements, 1, 'movement').position).toBe(0);
    // Beat 5 of a 4/4 bar of quarters: 2 s in, which is 2880 ticks at 120 bpm.
    expect(at(movements, 2, 'movement').date).toBeCloseTo(4 * QUARTER, 3);
    for (const movement of movements) expect(movement.controller).toBe('sustain');
  });

  test('a modelled line is a traversal, the hold, a traversal and the rest, each where the line has it', () => {
    const movements = movementsOf(fitPedals(modelled()));

    expect(movements.map((m) => m.id)).toEqual(['ped0_down', 'ped0_held', 'ped0_up', 'ped0_rest']);
    const [down, held, up, rest] = movements;
    expect(down.date).toBeCloseTo(0, 6);
    expect(down.position).toBe(0.04);
    expect(down.transitionTo).toBe(1);
    expect(down.curvature).toBeGreaterThanOrEqual(0);
    expect(down.curvature).toBeLessThanOrEqual(1);
    expect(held.date).toBeCloseTo(191 * TICKS_PER_MS, 3);
    expect(held.transitionTo).toBeUndefined();
    expect(up.date).toBeCloseTo(2846 * TICKS_PER_MS, 3);
    expect(up.transitionTo).toBe(0);
    expect(rest.date).toBeCloseTo(3039 * TICKS_PER_MS, 3);
    expect(rest.position).toBe(0);
  });

  test('names the press it is about, and leaves the others', () => {
    const movements = movementsOf(fitPedals(switches(), { pedal: 'ped1' }));

    expect(movements.map((m) => m.id)).toEqual(['ped1_down', 'ped1_rest']);
  });

  test('the fitted movementMap is structurally sound', () => {
    assertWellFormed(exportMPM(fitPedals(modelled())), 'the fitted pedal MPM');
    assertWellFormed(exportMPM(fitPedals(switches())), 'the switched pedal MPM');
  });

  /**
   * The assertion the unit tests cannot make. A `movementMap` can be perfectly well-formed and
   * still produce no pedal — which is the shape every critical in the 2026-08 audit had — so
   * the only way to know a pedal was described is to ask the renderer for one.
   */
  test('espressivo renders the line as a sustain stream that reaches full depth and comes back', () => {
    const score = modelled();
    const mpm = fitPedals(score);
    const msmXml = score.serialize()!;

    const stream = sustainStream(msmXml, exportMPM(mpm));
    expect(stream, 'no sustain stream in the rendered performance').toBeDefined();
    expect(stream!.ccNumber).toBe(64);
    expect(stream!.points.length).toBeGreaterThan(4);

    const values = stream!.points.map((point) => point.value);
    expect(Math.max(...values)).toBe(127);
    expect(values.at(-1)).toBe(0);
  });

  test('and the pedal comes from the MPM, not from the score alone', () => {
    // The vacuity guard, in the form this file can state it: without the movementMap the
    // same score renders no sustain stream at all, so the test above is about the fit.
    const score = modelled();
    const empty =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<mpm xmlns="http://www.cemfi.de/mpm/ns/1.0">' +
      '<performance name="empty" pulsesPerQuarter="720">' +
      '<global><header/><dated/></global></performance></mpm>';

    expect(sustainStream(score.serialize()!, empty)).toBeUndefined();
  });
});

describe('the shortcut, kept for calls already written', () => {
  const ramp = (depth = SUSTAIN_DEPTH): InsertPedalOptions => ({
    start: 0,
    duration: RAMP_TICKS,
    direction: 'down',
    depth,
  });

  test('hangs a ramp of the stated length on the press, at the depth asked for', () => {
    const movements = movementsOf(fitPedals(switches(), ramp()));

    // Two pedal marks, each a start and the point it arrives at full depth.
    expect(movements).toHaveLength(4);
    expect(at(movements, 0, 'movement').date).toBeCloseTo(0, 6);
    expect(at(movements, 0, 'movement').position).toBe(0);
    expect(at(movements, 0, 'movement').transitionTo).toBe(SUSTAIN_DEPTH);
    expect(at(movements, 1, 'movement').date).toBeCloseTo(RAMP_TICKS, 6);
    expect(at(movements, 1, 'movement').position).toBe(SUSTAIN_DEPTH);
    expect(at(movements, 2, 'movement').date).toBeCloseTo(4 * QUARTER, 3);
    expect(at(movements, 3, 'movement').date).toBeCloseTo(4 * QUARTER + RAMP_TICKS, 3);
  });

  test('is structurally sound', () => {
    assertWellFormed(exportMPM(fitPedals(switches(), ramp())), 'the ramped pedal MPM');
  });

  test('renders as a sustain stream that reaches full depth', () => {
    const score = switches();
    const stream = sustainStream(score.serialize()!, exportMPM(fitPedals(score, ramp())));

    expect(stream?.ccNumber).toBe(64);
    // 0 to 127: the ramp starts released and arrives fully down.
    expect(at(stream!.points, 0, 'sustain point').value).toBe(0);
    expect(Math.max(...stream!.points.map((point) => point.value))).toBe(127);
  });

  /**
   * `depth` is optional and defaults to a fully depressed pedal, and `|| 1` read a depth of
   * `0` as "not given" — so a caller asking for no depression got the opposite of what they
   * asked for, silently (issue #46).
   */
  test('a depth of 0 is a depth, not an absent option', () => {
    const movements = movementsOf(fitPedals(switches(), ramp(0)));

    expect(at(movements, 0, 'movement').transitionTo).toBe(0);
    expect(at(movements, 1, 'movement').position).toBe(0);
  });
});
