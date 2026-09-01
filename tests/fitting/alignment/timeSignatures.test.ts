import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import { convertMeiToMsm, performMsmToData } from 'espressivo';
import { Alignment, type AlignedNote } from '../../../src/fitting/alignment';
import { asMSM } from '../../../src/fitting/asMSM';
import { bars } from '../../../src/fitting/timeSignature';
import {
  AccentuationPatternDef,
  createMpm,
  ensureDefaultStyle,
  exportMPM,
  insertDefinition,
  requireMap,
  unwrap,
} from '../../../src/fitting/instructions/index';

/**
 * What an alignment knows about the metre — the whole `<timeSignatureMap>`, rather than the entry
 * the document happens to state first.
 *
 * Issue #22: the shipped transcription opens with a quarter of anacrusis, so its first entry is
 * the 1/4 of the upbeat bar and its second the 4/4 that governs the rest. Read as one signature,
 * the piece was reported to be in 1/4 throughout — a bar one beat long for espressivo to place
 * every accentuation in, and no metric level above the quarter for the tempo desk to group by.
 */

const note = (id: string, date: number): AlignedNote =>
  ({
    'xml:id': id,
    part: 1,
    date,
    duration: 720,
    pitchname: 'c',
    accidentals: 0,
    octave: 4,
    'midi.pitch': 60,
  }) as AlignedNote;

/** The anacrusis of the shipped transcription: one quarter of upbeat, then common time. */
const ANACRUSIS = [
  { date: 0, numerator: 1, denominator: 4 },
  { date: 720, numerator: 4, denominator: 4 },
];

/** Every `<timeSignature>` of a serialized alignment, in document order. */
const written = (xml: string) =>
  [...xml.matchAll(/<timeSignature [^>]*\/>/g)].map(([element]) => ({
    date: Number(/date="(-?\d+)"/.exec(element)?.[1]),
    numerator: Number(/numerator="(\d+)"/.exec(element)?.[1]),
    denominator: Number(/denominator="(\d+)"/.exec(element)?.[1]),
  }));

describe('reading the map off the score', () => {
  let alignment: Alignment;

  beforeAll(() => {
    const mei = readFileSync('public/transcription.mei', 'utf-8');
    alignment = asMSM(mei, convertMeiToMsm(mei)[0]!.msm);
  });

  test('keeps both entries the transcription states', () => {
    expect(alignment.timeSignatures).toEqual(ANACRUSIS);
  });

  test('reads the metre the anacrusis gives way to off the second entry', () => {
    expect(alignment.timeSignatureAt(720)).toEqual({ date: 720, numerator: 4, denominator: 4 });
  });
});

describe('the signature governing a date', () => {
  const alignment = new Alignment([note('a', 0), note('b', 720)], ANACRUSIS);

  test('is the entry in force, until the next one displaces it', () => {
    expect(alignment.timeSignatureAt(0)?.numerator).toBe(1);
    expect(alignment.timeSignatureAt(719)?.numerator).toBe(1);
    expect(alignment.timeSignatureAt(720)?.numerator).toBe(4);
    expect(alignment.timeSignatureAt(92880)?.numerator).toBe(4);
  });

  test('is nothing where the score states none', () => {
    const stateless = new Alignment([note('a', 0)]);

    expect(stateless.timeSignatureAt(0)).toBeUndefined();
  });
});

describe('the bars the metre lays out', () => {
  const PULSES_PER_WHOLE = 2880;
  const dates = (laid: { date: number }[]) => laid.map((bar) => bar.date);

  test('counts them from the downbeat, leaving the anacrusis its own bar', () => {
    expect(dates(bars(ANACRUSIS, 10 * 720, PULSES_PER_WHOLE))).toEqual([0, 720, 3600, 6480]);
  });

  test('starts no bar the piece has already ended on', () => {
    // Nine quarters: the upbeat and two whole bars, and 6480 is the end rather than a third bar.
    expect(dates(bars(ANACRUSIS, 9 * 720, PULSES_PER_WHOLE))).toEqual([0, 720, 3600]);
  });

  test('rules each stretch off at its own bar length', () => {
    const signatures = [
      { date: 0, numerator: 3, denominator: 4 },
      { date: 4320, numerator: 2, denominator: 4 },
    ];

    expect(bars(signatures, 7200, PULSES_PER_WHOLE)).toEqual([
      { date: 0, ticks: 2160, number: 1 },
      { date: 2160, ticks: 2160, number: 2 },
      { date: 4320, ticks: 1440, number: 3 },
      { date: 5760, ticks: 1440, number: 4 },
    ]);
  });

  test('numbers the first complete bar 1 and the upbeat before it 0', () => {
    expect(bars(ANACRUSIS, 10 * 720, PULSES_PER_WHOLE).map((bar) => bar.number)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  test('numbers from 1 where a piece opens on a whole bar', () => {
    const common = [{ date: 0, numerator: 4, denominator: 4 }];

    expect(bars(common, 8640, PULSES_PER_WHOLE).map((bar) => bar.number)).toEqual([1, 2, 3]);
  });

  // A shortening at a metre change is a shorter bar, not an upbeat: only the first can be one.
  test('reads a bar that shortens mid-piece as a bar, not as an anacrusis', () => {
    const signatures = [
      { date: 0, numerator: 4, denominator: 4 },
      { date: 2880, numerator: 2, denominator: 4 },
    ];

    expect(bars(signatures, 5760, PULSES_PER_WHOLE).map((bar) => bar.number)).toEqual([1, 2, 3]);
  });

  test('lays out none where the score states no signature', () => {
    expect(bars([], 92880, PULSES_PER_WHOLE)).toEqual([]);
  });
});

describe('Alignment.serialize time signatures', () => {
  test('writes every entry of the map, ascending', () => {
    const xml = new Alignment([note('a', 0), note('b', 720)], ANACRUSIS).serialize()!;

    expect(written(xml)).toEqual(ANACRUSIS);
  });

  // The renderer derives the bar from this map — `tickLengthOfOneMeasure = 4 * ppq / denominator
  // * numerator` in espressivo's `MetricalAccentuationMap` — so a document stating only the first
  // entry has espressivo place every note of the piece on beat 1 of a one-beat bar.
  test('states the metre the anacrusis gives way to, and not only the anacrusis', () => {
    const xml = new Alignment([note('a', 0), note('b', 720)], ANACRUSIS).serializeScore()!;

    expect(written(xml)).toContainEqual({ date: 720, numerator: 4, denominator: 4 });
  });

  test('publishes a score that states no signature in common time', () => {
    const xml = new Alignment([note('a', 0)]).serialize()!;

    expect(written(xml)).toEqual([{ date: 0, numerator: 4, denominator: 4 }]);
  });
});

/**
 * What the truncation cost, rendered.
 *
 * espressivo derives the bar from the map — `tickLengthOfOneMeasure = ticksPerBeat * numerator` —
 * and places a note in the pattern by `1 + (date − tsDate) % measure / ticksPerBeat`. A document
 * stating the 1/4 of the anacrusis alone has a bar one beat long, so every note of the piece is
 * beat 1 and a pattern fitted against 4/4 renders flat.
 */
describe('the bar a rendering counts', () => {
  const QUARTER = 720;
  /** The upbeat, then two bars of common time, one note to the beat. */
  const score = () =>
    new Alignment(
      Array.from({ length: 9 }, (_, index) => note(`n${String(index)}`, index * QUARTER)),
      ANACRUSIS,
    );

  /** An accentuation on the downbeat and nothing on the other three beats, looped. */
  const downbeats = () => {
    const mpm = createMpm();
    const def = unwrap(AccentuationPatternDef.fromNameLength('downbeat', 4));
    [1, 2, 3, 4].forEach((beat) => {
      const value = beat === 1 ? 1 : 0;
      def.addAccentuation(beat, value, value, value);
    });
    insertDefinition(mpm, 'accentuationPatternDef', def, 'global');
    requireMap(mpm, 'accentuationPattern', 'global').addAccentuationPattern({
      accentuationPatternDefName: 'downbeat',
      date: QUARTER,
      scale: 20,
      loop: true,
      id: 'accentuationPattern_1',
    });
    ensureDefaultStyle(mpm, 'accentuationPattern', 'global');
    return mpm;
  };

  test('puts the accentuation on the downbeats of the 4/4, not on every note', () => {
    const msm = score();
    const data = performMsmToData({ msm: msm.serializeScore()!, mpm: exportMPM(downbeats()) }, {});

    const performed = new Map(
      data.parts.flatMap((part) =>
        part.notes.flatMap((rendered) =>
          rendered.id === null ? [] : [[rendered.id, rendered.velocity] as const],
        ),
      ),
    );

    // Bar lines at 720 and 3600, which is where the two accented notes are.
    expect(performed.get('n1')).toBeGreaterThan(performed.get('n2')!);
    expect(performed.get('n5')).toBeGreaterThan(performed.get('n6')!);
    expect(performed.get('n2')).toEqual(performed.get('n3'));
    expect(new Set(performed.values()).size).toBeGreaterThan(1);
  });
});
