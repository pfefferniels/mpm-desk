import { describe, expect, test, vi } from 'vitest';
import { Alignment, type AlignedNote } from '../../../src/fitting/alignment';
import { ProcessVoices } from '../../../src/fitting/transformers/voices/index';
import { createMpm, getInstructions } from '../../../src/fitting/instructions/index';
import { getRange } from '../../../src/fitting/transformers/Transformer';

const note = (
  id: string,
  staff: string,
  layer: string,
  date: number,
  part = Number(staff),
): AlignedNote => ({
  'xml:id': id,
  part,
  staff,
  layer,
  date,
  duration: 720,
  pitchname: 'c',
  accidentals: 0,
  octave: 4,
  'midi.pitch': 60,
  velocity: 64,
  'milliseconds.date': date,
  'milliseconds.date.end': date + 500,
});

/** Two staves of two voices each, one note per voice per beat. */
const score = () =>
  new Alignment([
    note('a1', '1', '1', 0),
    note('a2', '1', '2', 0),
    note('b1', '2', '1', 720),
    note('b2', '2', '2', 720),
  ]);

const partsOf = (msm: Alignment) =>
  Object.fromEntries(msm.allNotes.map((n) => [n['xml:id'], n.part]));

describe('ProcessVoices', () => {
  test('an empty layout is the identity, down to the note objects', () => {
    const msm = score();
    const before = [...msm.allNotes];

    new ProcessVoices().run(msm, createMpm());

    // `toBe`, not `toEqual`: the chain of an untouched file must not even reallocate, or every
    // memo keyed on a note's identity is invalidated for nothing.
    expect(msm.allNotes).toHaveLength(before.length);
    before.forEach((original, index) => {
      expect(msm.allNotes[index]).toBe(original);
    });
  });

  test('folds voices into the parts a layout names', () => {
    const msm = score();
    new ProcessVoices({
      parts: [
        { number: 1, name: 'melody', voices: ['1/1'] },
        { number: 2, name: 'accompaniment', voices: ['1/2', '2/1', '2/2'] },
      ],
      moves: [],
    }).run(msm, createMpm());

    expect(partsOf(msm)).toEqual({ a1: 1, a2: 2, b1: 2, b2: 2 });
  });

  test('a voice no part names keeps the part it was in', () => {
    const msm = score();
    new ProcessVoices({
      parts: [{ number: 3, name: '', voices: ['1/1'] }],
      moves: [],
    }).run(msm, createMpm());

    expect(partsOf(msm)).toEqual({ a1: 3, a2: 1, b1: 2, b2: 2 });
  });

  test('a move by id overrides the voice layout', () => {
    const msm = score();
    new ProcessVoices({
      parts: [{ number: 1, name: '', voices: ['1/1', '1/2', '2/1', '2/2'] }],
      moves: [{ part: 1, select: { noteIDs: ['b1'] } }],
    }).run(msm, createMpm());

    expect(partsOf(msm)).toEqual({ a1: 1, a2: 1, b1: 1, b2: 1 });
  });

  test('a move by voice and range takes that voice over a half-open interval', () => {
    // `to` is the first tick *after* the stretch — the desk builds it as the downbeat of the bar
    // following the range — so `late` is outside it. An inclusive end took the first note of the
    // next bar as well, which showed up as a move previewing twelve notes and applying to
    // thirteen.
    const msm = new Alignment([
      note('early', '2', '2', 0),
      note('inside', '2', '2', 720),
      note('late', '2', '2', 1440),
      note('other', '2', '1', 720),
    ]);

    new ProcessVoices({
      parts: [
        { number: 1, name: 'melody', voices: [] },
        { number: 2, name: '', voices: ['2/1', '2/2'] },
      ],
      moves: [{ part: 1, select: { voice: '2/2', from: 720, to: 1440 } }],
    }).run(msm, createMpm());

    expect(partsOf(msm)).toEqual({ early: 2, inside: 1, late: 2, other: 2 });
  });

  test('the later of two moves over one note wins', () => {
    const msm = score();
    new ProcessVoices({
      parts: [
        { number: 1, name: '', voices: ['1/1', '1/2'] },
        { number: 2, name: '', voices: ['2/1', '2/2'] },
      ],
      moves: [
        { part: 2, select: { noteIDs: ['a1'] } },
        { part: 1, select: { noteIDs: ['a1'] } },
      ],
    }).run(msm, createMpm());

    expect(partsOf(msm)['a1']).toBe(1);
  });

  test('leaves the notes sorted by date, which NotesProvider binary-searches', () => {
    const msm = score();
    new ProcessVoices({
      parts: [{ number: 1, name: '', voices: ['1/1', '1/2', '2/1', '2/2'] }],
      moves: [],
    }).run(msm, createMpm());

    const dates = msm.allNotes.map((n) => n.date);
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
  });

  test('names the MPM part of a part that holds notes, and no other', () => {
    const msm = score();
    const mpm = createMpm();

    new ProcessVoices({
      parts: [
        { number: 1, name: 'melody', voices: ['1/1', '1/2'] },
        { number: 2, name: 'accompaniment', voices: ['2/1', '2/2'] },
        // Named, but nothing is in it — an empty `<part>` in the performance describes nothing.
        { number: 4, name: 'nobody', voices: [] },
      ],
      moves: [],
    }).run(msm, mpm);

    const performance = mpm.getPerformance(0);
    expect(performance?.getPart(1)?.getName()).toBe('melody');
    expect(performance?.getPart(2)?.getName()).toBe('accompaniment');
    expect(performance?.getPart(4)).toBeNull();
  });

  test('is answerable for nothing: it writes no instruction', () => {
    const msm = score();
    const mpm = createMpm();
    const call = new ProcessVoices({
      parts: [{ number: 1, name: 'melody', voices: ['1/1', '1/2', '2/1', '2/2'] }],
      moves: [],
    });

    // `run` throws on an instruction without an `xml:id` or with a non-finite attribute, so a
    // named part reaching the audit is what this exercises as much as the emptiness.
    call.run(msm, mpm);

    expect(call.created).toEqual([]);
    expect(getInstructions(mpm)).toEqual([]);
  });

  test('has no range — a layout is not a place in the score', () => {
    // The guard on the nested selector. `getRange` duck-types `{from,to}`, `{date}` and
    // `{noteIDs}` at the *top level* of the options, so hoisting a move's selector out of
    // `select` would give this call a span in the narrative for instructions it never wrote.
    const call = new ProcessVoices({
      parts: [{ number: 1, name: '', voices: ['1/1'] }],
      moves: [{ part: 1, select: { noteIDs: ['a1'] } }],
    });

    expect(getRange(call.options, score())).toBeUndefined();
  });

  describe('reports a layout it will not repair', () => {
    const layoutIsReported = (options: ConstructorParameters<typeof ProcessVoices>[0]) => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      new ProcessVoices(options).run(score(), createMpm());
      const said = errors.mock.calls.map((args) => String(args[0])).join('\n');
      errors.mockRestore();
      return said;
    };

    test('a part numbered below one, which is no scope at all', () => {
      expect(
        layoutIsReported({ parts: [{ number: 0, name: '', voices: ['1/1'] }], moves: [] }),
      ).toContain('is not a part');
    });

    test('a part on the drum channel', () => {
      // `Alignment.build` writes `midiChannel: number - 1` with no channel-10 skip, unlike
      // espressivo's own converter. A layout is the first thing that can make ten parts.
      expect(
        layoutIsReported({ parts: [{ number: 10, name: '', voices: ['1/1'] }], moves: [] }),
      ).toContain('drum channel');
    });

    test('two parts under one number', () => {
      expect(
        layoutIsReported({
          parts: [
            { number: 1, name: '', voices: ['1/1'] },
            { number: 1, name: '', voices: ['1/2'] },
          ],
          moves: [],
        }),
      ).toContain('two parts are numbered 1');
    });

    test('a voice two parts both claim', () => {
      expect(
        layoutIsReported({
          parts: [
            { number: 1, name: '', voices: ['1/1'] },
            { number: 2, name: '', voices: ['1/1'] },
          ],
          moves: [],
        }),
      ).toContain('is claimed by parts 1 and 2');
    });

    test('a move naming a part the layout has no entry for', () => {
      expect(
        layoutIsReported({
          parts: [{ number: 1, name: '', voices: ['1/1'] }],
          moves: [{ part: 7, select: { noteIDs: ['a1'] } }],
        }),
      ).toContain('names part 7');
    });
  });
});
