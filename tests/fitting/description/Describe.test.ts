import { describe, expect, test } from 'vitest';
import { createMpm, exportMPM } from '../../../src/fitting/instructions/index';
import { buildChain } from '../../../src/fitting/chain';
import { validate } from '../../../src/fitting/transformers/Order';
import { Describe, type DescribeOptions } from '../../../src/fitting/transformers/index';
import { Alignment, type AlignedNote } from '../../../src/fitting/alignment';
import { parseWorkFile, serializeWorkFile } from '../../../src/model/Work';

const note = (id: string, date: number): AlignedNote =>
  ({ 'xml:id': id, part: 1, date, duration: 720, 'midi.pitch': 60, 'milliseconds.date': date, 'milliseconds.date.end': date + 500, velocity: 40 }) as AlignedNote;

const score = () => new Alignment([note('a', 0), note('b', 720), note('c', 1440), note('d', 2160)], []);

const remark = (about: DescribeOptions['about']): DescribeOptions => ({
  text: 'pressing forward',
  about,
  model: 'claude-opus-5-5',
  date: '2026-11-27T12:00:00.000Z',
  steps: [{ name: 'FitTempo', options: { from: 0, to: 1440, shape: 'transition' } }],
  calls: ['r1.0.0'],
});

describe('Describe', () => {
  test('writes nothing', () => {
    const mpm = createMpm();
    const before = exportMPM(mpm);
    const step = new Describe(remark({ kind: 'span', from: 0, to: 1440, notes: [] }));
    step.run(score(), mpm);

    expect(exportMPM(mpm)).toBe(before);
    expect(step.created).toEqual([]);
  });

  test('is about the passage it was said of, its end excluded', () => {
    const span = new Describe(remark({ kind: 'span', from: 0, to: 1440, notes: [] }));
    expect(span.range()).toEqual({ from: 0, to: 1440 });
    expect(span.evidence(score())).toEqual(['a', 'b']);

    // An arrow names its two ends and is about everything between them.
    const arrow = new Describe(remark({ kind: 'arrow', from: 720, to: 2160, notes: ['b', 'c'] }));
    expect(arrow.evidence(score())).toEqual(['b', 'c']);
  });

  test('is about the notes it names, and about no place where it is said of the piece', () => {
    const set = new Describe(remark({ kind: 'box', from: 0, to: 2160, notes: ['a', 'c'] }));
    expect(set.evidence(score())).toEqual(['a', 'c']);

    const piece = new Describe(remark({ kind: 'piece', from: 0, to: 2880, notes: [] }));
    expect(piece.range()).toBeUndefined();
    expect(piece.evidence(score())).toEqual([]);
  });

  test('is a step the chain knows, and asks nothing of the steps before it', () => {
    const saved = { id: 'r1', name: 'Describe', options: { ...remark({ kind: 'piece', from: 0, to: 2880, notes: [] }) } };
    const { transformers, unknown } = buildChain([saved]);
    const step = transformers.find((transformer) => transformer.name === 'Describe');

    expect(unknown).toEqual([]);
    expect(step?.id).toBe('r1');
    expect(step?.options).toMatchObject({ text: 'pressing forward', model: 'claude-opus-5-5', calls: ['r1.0.0'] });
    expect(validate(transformers)).toEqual([]);
  });

  test('keeps the steps the remark became, and runs none of them', () => {
    const mpm = createMpm();
    const before = exportMPM(mpm);
    const step = new Describe(remark({ kind: 'span', from: 0, to: 1440, notes: [] }));
    step.run(score(), mpm);

    // `FitTempo` is no step of this chain: it is resolved by `src/fitting/description`.
    expect(step.options.steps).toEqual([{ name: 'FitTempo', options: { from: 0, to: 1440, shape: 'transition' } }]);
    expect(exportMPM(mpm)).toBe(before);
    expect(new Describe().options.steps).toEqual([]);
  });

  test('carries its steps through a work file as they were written, envelopes and all', () => {
    const guided = { name: 'InsertDynamics', options: { from: 0, to: 720, guides: new Map([[0, 40]]) } };
    const options = { ...remark({ kind: 'piece', from: 0, to: 2880, notes: [] }), steps: [guided] };
    const file = serializeWorkFile({ name: '', mei: '', mpm: '', provenance: [{ id: 'r1', name: 'Describe', options }] });

    expect(file).toContain('"dataType": "Map"');
    expect(parseWorkFile(file).provenance[0]?.options['steps']).toEqual([guided]);
  });

  test('still loads and runs where it was saved without steps', () => {
    const { steps: _steps, ...saved } = remark({ kind: 'span', from: 0, to: 1440, notes: [] });
    void _steps;
    const file = JSON.stringify({ name: '', mei: '', mpm: '', provenance: [{ id: 'r1', name: 'Describe', options: saved }] });
    const { transformers, unknown } = buildChain(parseWorkFile(file).provenance);
    const step = transformers.find((transformer) => transformer.name === 'Describe');
    const mpm = createMpm();
    const before = exportMPM(mpm);

    expect(unknown).toEqual([]);
    expect(() => step?.run(score(), mpm)).not.toThrow();
    expect(exportMPM(mpm)).toBe(before);
    expect(step?.range(score())).toEqual({ from: 0, to: 1440 });
    expect(step?.evidence(score())).toEqual(['a', 'b']);
  });
});
