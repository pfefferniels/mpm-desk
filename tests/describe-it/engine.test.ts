/**
 * DescribeIt's engine, over the published transcription: that with nothing described the MPM's
 * rendering is a steady tempo and one level laid against the recording, that it comes onto the
 * playing as the published reconstruction is replayed through it, and that what the engine adds
 * to the chain does what a reader describing a piece bit by bit needs of it.
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

/** How far the chords were played from where the MPM has them, and the notes of a chord from one another, in ms. */
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
  it('renders a steady tempo and one level, laid against the recording at its two ends', () => {
    const base = run([]);
    expect(base.assumed.tempo).toHaveLength(1);
    expect(base.assumed.tempo[0]).toMatchObject({ from: 0, to: base.end });
    expect(base.assumed.levelDates).toEqual([0]);
    expect(base.mpm).toContain('<tempo');
    expect(base.mpm).toContain('<dynamics');

    // The recording runs from its first note, and the rendering begins with it.
    const first = base.notes.reduce((a, b) => (b.ms < a.ms ? b : a));
    expect(first.ms).toBe(0);
    expect(first.mpm.ms).toBeCloseTo(0, 6);
    // One tempo: every beat as long as the next, and the last chord where it was played.
    const steps = base.beats.slice(1, -1).map((beat, i) => beat.ms - base.beats[i]!.ms);
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(1e-6);
    const lastDate = Math.max(...base.notes.map((note) => note.date));
    const last = base.notes.filter((note) => note.date === lastDate);
    expect(Math.min(...last.map((note) => Math.abs(note.late)))).toBeLessThan(1);
    // In between the two run apart, which is what there is to describe.
    expect(left(base).pulse).toBeGreaterThan(1000);
    // One level: every note rendered as loud as every other.
    expect(new Set(base.notes.map((note) => note.mpm.velocity)).size).toBe(1);
    expect(base.notes.every((note) => note.loud === note.velocity - note.mpm.velocity)).toBe(true);
  });
});

describe('the published reconstruction, replayed', () => {
  it('leaves little of the timing and the loudness, and assumes nothing it describes', () => {
    const base = left(run([]));
    const result = run(reference);
    const after = left(result);
    expect(result.calls.filter((report) => report.error)).toEqual([]);
    expect(after.pulse).toBeLessThan(base.pulse / 50);
    expect(after.spread).toBeLessThan(base.spread / 3);
    expect(after.loud).toBeLessThan(base.loud);
    expect(result.assumed.levelDates).toEqual([]);
  });
});

describe('what a description adds to the chain', () => {
  it('rolls every chord, and gives the ornaments their definitions unasked', () => {
    const result = run([call('InsertTemporalSpread', {})]);
    expect(left(result).spread).toBeLessThan(left(run([])).spread / 3);
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
    expect(result.notes.every((note) => Number.isFinite(note.mpm.ms) && Number.isFinite(note.loud))).toBe(true);
  });

  it('holds the recording still, and moves the rendering to it', () => {
    const base = run([]);
    const tempo = run([call('FitTempo', { from: bar(1), to: bar(9), shape: 'steady', step: BAR })]);
    const before = new Map(base.notes.map((note) => [note.id, note]));
    // What was played is where it was; what the MPM renders has moved, and nearer.
    expect(tempo.notes.every((note) => note.ms === before.get(note.id)!.ms)).toBe(true);
    expect(tempo.notes.some((note) => Math.abs(note.mpm.ms - before.get(note.id)!.mpm.ms) > 100)).toBe(true);
    expect(left(tempo, bar(1), bar(9)).pulse).toBeLessThan(left(base, bar(1), bar(9)).pulse / 5);
    // The beats of the described bars went with it: no longer one as long as the next.
    const steps = tempo.beats.slice(1, 30).map((beat, i) => beat.ms - tempo.beats[i]!.ms);
    expect(Math.max(...steps) - Math.min(...steps)).toBeGreaterThan(50);

    // A roll stays as it was played, and it is the rendering that spreads out to meet it.
    const rolled = run([call('InsertTemporalSpread', { date: 4320 })]);
    const chord = (result: RunResult) => result.notes.filter((note) => note.date === 4320);
    const span = (values: number[]) => Math.max(...values) - Math.min(...values);
    expect(span(chord(base).map((note) => note.mpm.ms))).toBeLessThan(1e-6);
    expect(span(chord(rolled).map((note) => note.ms))).toBe(span(chord(base).map((note) => note.ms)));
    expect(span(chord(rolled).map((note) => note.mpm.ms))).toBeCloseTo(span(chord(base).map((note) => note.ms)), 0);
  });

  it('corrects the recording where a reader doubts it, and writes no instruction for that', () => {
    const base = run([]);
    const { id, velocity } = base.notes[5]!;
    const result = run([call('Modify', { aspect: 'velocity', change: -6, noteIDs: [id] })]);
    const corrected = result.notes.find((note) => note.id === id)!;
    expect(result.calls[0]?.elements).toEqual([]);
    expect(corrected.velocity).toBe(velocity - 6);
    // What the roll had stays behind it, and no other note has anything behind it.
    expect(corrected.arrived?.velocity).toBe(velocity);
    expect(result.notes.filter((note) => note.arrived)).toHaveLength(1);
  });

  it('keeps a remark as a step of the flat list, naming the calls it became', () => {
    const fit = call('FitTempo', { from: bar(1), to: bar(3), shape: 'steady', step: BAR }, 'r1:0');
    const remark = call(
      'Describe',
      {
        text: 'steady by the bar',
        scope: { kind: 'span', from: bar(1), to: bar(3), notes: [] },
        model: 'claude-opus-5-5',
        date: '2026-11-27T12:00:00.000Z',
        calls: ['r1:0'],
      },
      'r1',
    );
    const bare = run([fit]);
    const described = run([remark, fit]);
    // The step changes nothing by itself.
    expect(described.mpm).toBe(bare.mpm);

    const at = described.record.findIndex((step) => step.name === 'Describe');
    const kept = described.record[at]!;
    const made = described.record.slice(at + 1);
    expect(kept.options).toMatchObject({ text: 'steady by the bar', model: 'claude-opus-5-5' });
    // A fitted step is recorded as the call it came to, one tempo to the bar, numbers stated.
    expect(made.map((step) => step.name)).toEqual(['InsertTempo', 'InsertTempo']);
    expect(kept.options['calls']).toEqual(made.map((step) => step.id));
    expect(made.every((step) => typeof step.options['bpm'] === 'number')).toBe(true);
    // What was assumed for the rest stands before it, and nothing is recorded twice.
    expect(described.record.slice(0, at).every((step) => step.id.startsWith('assumed-tempo-'))).toBe(true);
    expect(new Set(described.record.map((step) => step.id)).size).toBe(described.record.length);
  });

  it('gives the pedals on the roll\'s clock: the presses as recorded, and the MPM\'s once it has any', () => {
    const base = run([]);
    const last = Math.max(...base.notes.map((note) => note.msEnd));
    expect(base.pedals.played.length).toBeGreaterThan(10);
    expect(new Set(base.pedals.played.map((press) => press.kind))).toEqual(new Set(['sustain', 'soft']));
    // On the notes' own clock, in order, each press let go after it was made. The soft pedal goes
    // down before the first note is struck.
    for (const [i, press] of base.pedals.played.entries()) {
      expect(press.msEnd).toBeGreaterThan(press.ms);
      expect(press.ms).toBeGreaterThanOrEqual(i ? base.pedals.played[i - 1]!.ms : -5000);
      expect(press.ms).toBeLessThan(last);
    }
    // Nothing described, nothing rendered; described, the pedal goes down and comes up again.
    expect(base.pedals.mpm).toEqual([]);
    const pedalled = run([call('InsertPedal', {})]);
    expect(pedalled.calls[0]?.error).toBeUndefined();
    expect(pedalled.pedals.mpm.some((move) => move.value >= 64)).toBe(true);
    expect(pedalled.pedals.mpm.some((move) => move.value < 64)).toBe(true);
    expect(pedalled.pedals.mpm.every((move, i, moves) => i === 0 || move.ms >= moves[i - 1]!.ms)).toBe(true);
  });
});
