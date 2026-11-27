/**
 * DescribeIt's engine, over the published transcription: that the roll it draws is the recording
 * while nothing is described, that it comes down to the score as the published reconstruction is
 * replayed through it, and that what the engine adds to the chain does what a reader describing a
 * piece bit by bit needs of it.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { convertMeiToMsm } from 'espressivo';
import { runFit } from '../../src/fitting/fit';
import { asMSM } from '../../src/fitting/asMSM';
import { parseWorkFile, type Call } from '../../src/model/Work';
import { publishedPath } from '../../src/test/published';
import { load, run, type PlainCall, type RunResult } from '../../describe-it/engine';

const call = (name: string, options: Record<string, unknown>, id = name): PlainCall => ({ id, name, options });

const rms = (values: number[]) =>
  Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / Math.max(1, values.length));

/** How far the chords stand from the grid, and the notes of a chord from one another, in ms. */
const left = (result: RunResult, from = -Infinity, to = Infinity) => {
  const notes = result.notes.filter((note) => note.date >= from && note.date < to);
  const chords = Map.groupBy(notes, (note) => note.date);
  const means = new Map(
    [...chords].map(([date, chord]) => [date, chord.reduce((sum, note) => sum + note.late, 0) / chord.length]),
  );
  return {
    pulse: rms([...means.values()]),
    spread: rms(notes.map((note) => note.late - (means.get(note.date) ?? 0))),
    loud: rms(notes.map((note) => note.loud)),
  };
};

const BAR = 2880;
const bar = (n: number) => 720 + (n - 1) * BAR;

let reference: PlainCall[] = [];

beforeAll(() => {
  const mei = readFileSync(publishedPath('mei'), 'utf-8');
  const rawWork = readFileSync(publishedPath('work'), 'utf-8');
  const work = parseWorkFile(rawWork);
  const movement = convertMeiToMsm(mei)[0];
  if (!movement) throw new Error('the transcription holds no movement');
  const alignment = asMSM(mei, movement.msm, movement.graces);
  runFit({ ...work, provenance: work.provenance.filter((c) => c.name === 'MakeChoice') }, alignment);
  load({
    title: work.name,
    alignment: {
      allNotes: alignment.allNotes,
      pedals: alignment.pedals,
      graces: alignment.graces,
      tiedPrincipals: alignment.tiedPrincipals,
      timeSignatures: alignment.timeSignatures,
    },
  });
  reference = (JSON.parse(rawWork) as { provenance: Call[] }).provenance
    .filter((c) => !['AlignSource', 'MakeChoice', 'InsertMetadata'].includes(c.name))
    .map(({ id, name, options }) => ({ id, name, options }));
});

describe('with nothing described', () => {
  it('draws the recording: a steady tempo and one level are all that is assumed', () => {
    const base = run([]);
    expect(base.assumed.tempo).toHaveLength(1);
    expect(base.assumed.tempo[0]).toMatchObject({ from: 0, to: base.end });
    expect(base.assumed.levelDates).toEqual([0]);
    // Under one tempo a tick is so many ms, so the roll is the recording to scale (as nearly as
    // a tempo written to four decimals says it).
    const [first, second] = base.notes;
    expect(first && second && (second.x - first.x) / (second.ms - first.ms)).toBeCloseTo(
      (base.assumed.tempo[0]!.bpm * 720) / 60000,
      4,
    );
    // And a velocity is drawn as it was played.
    for (const note of base.notes.slice(0, 20)) expect(note.v).toBeCloseTo(note.velocity, 6);
    expect(base.mpm).toContain('<tempo');
    expect(base.mpm).toContain('<dynamics');
  });
});

describe('the published reconstruction, replayed', () => {
  it('leaves little of the timing and the loudness, and assumes nothing it describes', () => {
    const base = left(run([]));
    const result = run(reference);
    const after = left(result);
    expect(result.calls.filter((report) => report.error)).toEqual([]);
    expect(after.pulse).toBeLessThan(base.pulse / 50);
    expect(after.spread).toBeLessThan(10);
    expect(after.loud).toBeLessThan(base.loud);
    expect(result.assumed.levelDates).toEqual([]);
  });
});

describe('what a description adds to the chain', () => {
  it('rolls every chord, and gives the ornaments their definitions unasked', () => {
    const result = run([call('InsertTemporalSpread', {})]);
    expect(left(result).spread).toBeLessThan(5);
    expect(result.mpm).toContain('<ornamentDef');
    expect(result.mpm).not.toContain('neutralArpeggio');
    expect(result.calls[0]?.evidence.length).toBeGreaterThan(100);
  });

  it('reads a tempo off the recording, span by span, and leaves the rest assumed', () => {
    const result = run([call('FitTempo', { from: bar(1), to: bar(9), shape: 'steady', step: BAR / 2 })]);
    const report = result.calls[0];
    expect(report?.error).toBeUndefined();
    expect(report?.fitted?.length).toBeGreaterThan(10);
    expect(left(result, bar(1), bar(9)).pulse).toBeLessThan(left(run([]), bar(1), bar(9)).pulse / 10);
    // What was fitted is handed on as the stated calls the editor would hold.
    expect(report?.concrete.every((concrete) => concrete.name === 'InsertTempo')).toBe(true);
    expect(result.assumed.tempo.map((gap) => gap.from)).toEqual([0, bar(9)]);
  });

  it('lets a later remark own its span, and refits the earlier one round it', () => {
    const result = run([
      call('FitTempo', { from: bar(1), to: bar(9), shape: 'steady', step: BAR }, 'bars'),
      call('FitTempo', { from: bar(6), to: bar(8), shape: 'transition' }, 'broadening'),
    ]);
    const [bars, broadening] = result.calls;
    expect(bars?.fitted).toHaveLength(6);
    expect(broadening?.fitted).toHaveLength(1);
    expect(broadening?.fitted?.[0]).toMatchObject({ from: bar(6), to: bar(8) });
  });

  it('puts a roll on one chord before a roll over all of them, whichever was said first', () => {
    const result = run([
      call('InsertTemporalSpread', {}, 'all'),
      call('InsertTemporalSpread', { date: 1440, placement: 'before-beat' }, 'one'),
    ]);
    const one = result.calls.find((report) => report.id === 'one');
    expect(one?.elements).toEqual(['ornament_1440']);
    expect(result.calls.find((report) => report.id === 'all')?.elements).not.toContain('ornament_1440');
    // Measured before the other call collapsed it: a frame of some length, not of none.
    expect(result.mpm).not.toMatch(/frameLength="0ticks"/);
  });

  it('repeats a call over a passage, passing over a frame with nothing to redistribute', () => {
    const result = run([
      call('Repeat', {
        from: bar(9),
        to: bar(11),
        step: 720,
        call: { name: 'InsertRubato', options: { date: '$from', length: '$step' } },
      }),
    ]);
    const written = result.calls[0]?.written ?? [];
    expect(written.length).toBeGreaterThan(0);
    expect(written.length).toBeLessThan(8);
    expect(written.every((tag) => tag.startsWith('<rubato'))).toBe(true);
  });

  it('meets a requirement with what it assumes', () => {
    const result = run([
      call('InsertMetricalAccentuation', { from: bar(1), to: bar(2), beatLength: 0.25 }),
    ]);
    expect(result.calls[0]?.error).toBeUndefined();
    expect(result.mpm).toContain('<accentuationPattern');
  });

  it('leaves out a call that cannot run, says why, and runs the rest', () => {
    const result = run([
      call('InsertTempo', { from: 0, to: 720 }, 'no-bpm'),
      call('InsertDynamics', { scope: 0, from: 0, to: 720 }, 'one-hand'),
      call('MakeChoice', { prefer: 'x' }, 'choice'),
      call('Nonsense', {}, 'unknown'),
      call('FitDynamics', { from: bar(1), to: bar(2) }, 'level'),
    ]);
    const errors = Object.fromEntries(result.calls.map((report) => [report.id, report.error]));
    expect(errors['no-bpm']).toMatch(/number for "bpm"/);
    expect(errors['one-hand']).toMatch(/both hands/);
    expect(errors['choice']).toMatch(/one take/);
    expect(errors['unknown']).toMatch(/no transformer called Nonsense/);
    expect(errors['level']).toBeUndefined();
    expect(result.notes.every((note) => Number.isFinite(note.x) && Number.isFinite(note.v))).toBe(true);
  });

  it('corrects the recording where a reader doubts it, and writes no instruction for that', () => {
    const base = run([]);
    const id = base.notes[5]!.id;
    const result = run([call('Modify', { aspect: 'velocity', change: -6, noteIDs: [id] })]);
    expect(result.calls[0]?.elements).toEqual([]);
    expect(result.notes.find((note) => note.id === id)!.v).toBeCloseTo(
      base.notes.find((note) => note.id === id)!.v - 6,
      6,
    );
    // The shadow keeps the velocity as it arrived.
    expect(result.notes.find((note) => note.id === id)!.velocity).toBe(base.notes[5]!.velocity);
  });
});
