import { describe, expect, test } from 'vitest';
import { performMsmToData } from 'espressivo';
import { createMpm, exportMPM, getInstructions } from '../../../src/fitting/instructions/index';
import { compareTransformers } from '../../../src/fitting/transformers/index';
import {
  InsertTempo,
  TranslatePhysicalTimeToTicks,
} from '../../../src/fitting/transformers/tempo/index';
import { InsertPedal } from '../../../src/fitting/transformers/pedal/InsertPedalInstructions';
import { at } from '../../support/at';
import { buildScore, QUARTER } from './score';
import { assertWellFormed } from './invariants';

/**
 * Pedalling — and why this is not a round-trip case.
 *
 * Every case in `cases.ts` states a truth in MPM, renders it, and asks whether the chain can
 * recover it. That only means something where the chain *fits* something. `InsertPedal` does
 * not: its own doc comment calls it "a shortcut", and it takes the shape of the movement —
 * `start`, `duration`, `direction`, `depth` — as constructor options rather than reading it off
 * the recording. A round trip would therefore compare a truth this file wrote against a fit
 * whose shape this file also dictated, and measure nothing but the option-picking. That is
 * precisely the failure mode the harness is built to exclude, so it is excluded here too.
 *
 * What is worth asserting is everything downstream of the shortcut: that the movements land
 * where the pedal is, that the document is structurally sound, and — the part no unit test can
 * see — that the renderer actually produces a pedal from it.
 */

const SUSTAIN_DEPTH = 1;
/** Long enough that the ramp is a ramp, short enough to stay inside the first beat. */
const RAMP_TICKS = 60;

const pedalledScore = () => {
  const score = buildScore({ beats: 8 });
  for (const note of score.allNotes) {
    // Half a second to the quarter, which is the 120 bpm the assertions below read back.
    const onset = (note.date / QUARTER) * 500;
    note['milliseconds.date'] = onset;
    note['milliseconds.date.end'] = onset + 500;
    note.velocity = 64;
  }
  // Down on beat 1, again on beat 5 — 0 ms and 2000 ms at the 120 bpm the onsets describe.
  score.pedals = [
    { 'xml:id': 'ped0', type: 'sustain', 'milliseconds.date': 0, 'milliseconds.date.end': 1000 },
    { 'xml:id': 'ped1', type: 'sustain', 'milliseconds.date': 2000, 'milliseconds.date.end': 3000 },
  ];
  return score;
};

const fitPedals = (score: ReturnType<typeof pedalledScore>, depth = SUSTAIN_DEPTH) => {
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
    new InsertPedal({
      start: 0,
      duration: RAMP_TICKS,
      direction: 'down',
      depth,
    }),
  ].sort(compareTransformers);
  for (const transformer of chain) transformer.run(score, mpm);
  return mpm;
};

const sustainStream = (msmXml: string, mpmXml: string) => {
  const data = performMsmToData({ msm: msmXml, mpm: mpmXml });
  return data.parts
    .flatMap((part) => part.controlChanges)
    .find((stream) => stream.kind === 'position' && stream.controller === 'sustain');
};

describe('pedalling reaches the renderer', () => {
  test('the movements land on the pedal, at the depth asked for', () => {
    const score = pedalledScore();
    const mpm = fitPedals(score);

    const movements = getInstructions(mpm, 'movement', 'global').sort((a, b) => a.date - b.date);

    // Two pedal marks, each a start and the point it arrives at full depth.
    expect(movements).toHaveLength(4);
    expect(at(movements, 0, 'movement').date).toBeCloseTo(0, 6);
    expect(at(movements, 0, 'movement').position).toBe(0);
    expect(at(movements, 0, 'movement').transitionTo).toBe(SUSTAIN_DEPTH);
    expect(at(movements, 1, 'movement').date).toBeCloseTo(RAMP_TICKS, 6);
    expect(at(movements, 1, 'movement').position).toBe(SUSTAIN_DEPTH);

    // Beat 5 of a 4/4 bar of quarters: 2 s in, which is 2880 ticks at 120 bpm.
    expect(at(movements, 2, 'movement').date).toBeCloseTo(4 * QUARTER, 3);
    expect(at(movements, 3, 'movement').date).toBeCloseTo(4 * QUARTER + RAMP_TICKS, 3);

    for (const movement of movements) {
      expect(movement.controller).toBe('sustain');
    }
  });

  test('the fitted movementMap is structurally sound', () => {
    assertWellFormed(exportMPM(fitPedals(pedalledScore())), 'the fitted pedal MPM');
  });

  /**
   * The assertion the unit tests cannot make. A `movementMap` can be perfectly well-formed and
   * still produce no pedal — which is the shape every critical in the 2026-08 audit had — so
   * the only way to know a pedal was described is to ask the renderer for one.
   */
  test('espressivo renders it as a sustain controller stream that reaches full depth', () => {
    const score = pedalledScore();
    const mpm = fitPedals(score);
    const msmXml = score.serialize()!;

    const stream = sustainStream(msmXml, exportMPM(mpm));
    expect(stream, 'no sustain stream in the rendered performance').toBeDefined();
    expect(stream!.ccNumber).toBe(64);
    expect(stream!.points.length).toBeGreaterThan(1);

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
    const movements = getInstructions(fitPedals(pedalledScore(), 0), 'movement', 'global').sort(
      (a, b) => a.date - b.date,
    );

    expect(at(movements, 0, 'movement').transitionTo).toBe(0);
    expect(at(movements, 1, 'movement').position).toBe(0);
  });

  test('and the pedal comes from the MPM, not from the score alone', () => {
    // The vacuity guard, in the form this file can state it: without the movementMap the
    // same score renders no sustain stream at all, so the test above is about the fit.
    const score = pedalledScore();
    const empty =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<mpm xmlns="http://www.cemfi.de/mpm/ns/1.0">' +
      '<performance name="empty" pulsesPerQuarter="720">' +
      '<global><header/><dated/></global></performance></mpm>';

    expect(sustainStream(score.serialize()!, empty)).toBeUndefined();
  });
});
