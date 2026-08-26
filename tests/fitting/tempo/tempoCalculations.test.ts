import { describe, expect, test } from 'vitest';
import {
  dateAtMilliseconds,
  getTempoAt,
  millisecondsAt,
  resolveSpan,
  type TempoWithEndDate,
} from '../../../src/fitting/transformers/tempo/tempoCalculations';

const QUARTER = 720;
const START = 2160;

const span = (over: Partial<TempoWithEndDate> = {}): TempoWithEndDate =>
  ({
    id: 't',
    date: START,
    endDate: START + 4 * QUARTER,
    beatLength: 0.25,
    bpm: 60,
    ...over,
  }) as TempoWithEndDate;

/**
 * The shapes a `<tempo>` can take, as the renderer resolves them — not as the options spell them.
 *
 * The last two are here because they used to be inverted against the wrong curve. `meanTempoAt`
 * of 0 resolves to a *constant at `@transition.to`*, and a `@transition.to` with no
 * `@meanTempoAt` resolves to a *linear ramp*; the old test for which arm to take was a
 * truthiness check on the two fields, which calls the first false (0 is falsy) and the second
 * false as well, and inverted both at `@bpm`.
 */
const SHAPES: [string, TempoWithEndDate][] = [
  ['a constant tempo', span()],
  ['a very slow constant tempo', span({ bpm: 2 })],
  ['a linear accelerando', span({ transitionTo: 90, meanTempoAt: 0.5 })],
  ['a convex accelerando', span({ transitionTo: 90, meanTempoAt: 0.3 })],
  ['a concave accelerando', span({ transitionTo: 90, meanTempoAt: 0.75 })],
  ['a ritardando', span({ bpm: 144, transitionTo: 72, meanTempoAt: 0.4 })],
  ['a transition between very slow tempi', span({ bpm: 2, transitionTo: 3, meanTempoAt: 0.6 })],
  ['a half-note beat unit', span({ beatLength: 0.5, transitionTo: 100, meanTempoAt: 0.35 })],
  [
    '@meanTempoAt="0", which resolves to a constant at the target',
    span({ transitionTo: 90, meanTempoAt: 0 }),
  ],
  [
    'a @transition.to with no @meanTempoAt, which resolves to a linear ramp',
    span({ transitionTo: 90 }),
  ],
];

/**
 * The times a walk over a real score asks about, expressed as a fraction of the span's own
 * length so that every shape gets the same questions.
 *
 * The negative ones are not exotic. `addTickOnsets` asks `dateAtMilliseconds(onsetMs - startMs)`,
 * and a note sounding ahead of its predecessor makes that negative — which is what an arpeggio
 * and an asynchrony *are*. The ones past 1 are the release of a note held past the last modelled
 * moment of the piece, and the frame of a roll near the final beat.
 */
const FRACTIONS = [-0.5, -0.1, -0.001, 0, 0.001, 0.05, 0.25, 0.5, 0.75, 0.999, 1, 1.2, 2];

/**
 * An order of magnitude of headroom over `dateAtMilliseconds`'s own stopping tolerance, which is
 * a microsecond of time or a millionth of a tick, whichever it reaches first. Both are stated in
 * `tempoCalculations.ts`; asserting against the looser of them rather than against a digit count
 * keeps this test measuring the routine's contract instead of its floating-point luck.
 *
 * The iteration this replaced stopped at **one millisecond**, so what is asserted here is five
 * orders of magnitude tighter than what used to be considered converged — and it converged on
 * the wrong number besides.
 */
const TOLERANCE_MS = 1e-5;

describe('dateAtMilliseconds inverts millisecondsAt', () => {
  /**
   * The property the whole module rests on, and the one nothing asserted while
   * `approximateDate` was getting it wrong by 57 000 ticks (issue #26).
   *
   * Stated as a round trip rather than against expected numbers on purpose: a table of expected
   * ticks is a table someone computed with the same arithmetic, so it agrees with a wrong
   * implementation as readily as with a right one. What cannot be faked is that converting a
   * time to a tick and back returns the time.
   */
  test.each(SHAPES)('over %s, for times inside and outside the span', (_, tempo) => {
    const resolved = resolveSpan(tempo);
    const spanMs = millisecondsAt(resolved.endDate, resolved);

    for (const fraction of FRACTIONS) {
      const target = fraction * spanMs;
      const date = dateAtMilliseconds(target, resolved);

      expect(Number.isFinite(date), `${target} ms gave ${date}`).toBe(true);
      expect(Math.abs(millisecondsAt(date, resolved) - target)).toBeLessThan(TOLERANCE_MS);
    }
  });

  /**
   * Where the answer is knowable without the renderer, it is checked against arithmetic rather
   * than against itself. 200 ms before a 60 bpm quarter-note span begins is 144 ticks before
   * its start, whatever the span goes on to do — the continuation is at the tempo it departs
   * from, so the curve's shape does not enter.
   */
  test('a time before the span is placed at the tempo the span departs from', () => {
    for (const meanTempoAt of [0.3, 0.5, 0.75]) {
      const resolved = resolveSpan(span({ transitionTo: 90, meanTempoAt }));
      expect(dateAtMilliseconds(-200, resolved)).toBeCloseTo(START - 144, 9);
    }
  });

  /**
   * And the symmetric one at the other end: past `endDate` the continuation is at the tempo the
   * transition *arrives* at, which is `@transition.to` only where the transition survives
   * resolution. `msToTicks` used to read the attribute straight off the record.
   */
  test('a time after the span is placed at the tempo the span arrives at', () => {
    const resolved = resolveSpan(span({ transitionTo: 120, meanTempoAt: 0.4 }));
    const spanMs = millisecondsAt(resolved.endDate, resolved);
    // 200 ms at 120 bpm with a quarter-note beat is 288 ticks.
    expect(dateAtMilliseconds(spanMs + 200, resolved)).toBeCloseTo(resolved.endDate + 288, 6);
  });

  /**
   * The specific number issue #26 reported. Below about 4 bpm per beat unit the old step —
   * `guess += 0.1 * (targetMs - guessedMs)`, milliseconds added to a tick count — has a
   * multiplier above 2 in absolute value and walks away from the answer.
   */
  test('a tempo slow enough to make the old fixed step diverge', () => {
    const resolved = resolveSpan(span({ bpm: 2, transitionTo: 3, meanTempoAt: 0.6 }));
    const date = dateAtMilliseconds(5000, resolved);
    expect(millisecondsAt(date, resolved)).toBeCloseTo(5000, 6);
  });

  /**
   * A caller that does not know the time it is asking about gets `NaN`, not a tick that looks
   * like an answer. This is the half of issue #26 that says *how* it should fail: the old loop
   * condition `Math.abs(NaN - target) > 1` is `false`, so an iteration that had computed
   * nothing exited as though it had converged and returned its untouched initial guess.
   */
  test('an unknown time gives NaN rather than a plausible tick', () => {
    const resolved = resolveSpan(span({ transitionTo: 90, meanTempoAt: 0.3 }));
    expect(dateAtMilliseconds(NaN, resolved)).toBeNaN();
    expect(dateAtMilliseconds(Infinity, resolved)).toBeNaN();
  });
});

describe('millisecondsAt is defined everywhere and increases', () => {
  /**
   * `Math.pow(negative, non-integer)` is `NaN`, and `NaN` is what the whole of issue #26
   * propagated from: it is not caught by any comparison, so it travels until something writes
   * it to the document. An integer exponent — which is exactly `@meanTempoAt="0.5"`, the value
   * mpmify writes most — hides it, and hands back a *positive* elapsed time for a date before
   * the span instead, because the sign of Simpson's `resultConst` flips there.
   */
  test.each(SHAPES)('over %s, on both sides of both boundaries', (_, tempo) => {
    const resolved = resolveSpan(tempo);
    const { startDate, endDate } = resolved;

    const dates = [
      startDate - 1000,
      startDate - 1,
      startDate,
      startDate + 1,
      endDate - 1,
      endDate,
      endDate + 1,
      endDate + 1000,
    ];

    let previous = -Infinity;
    for (const date of dates) {
      const ms = millisecondsAt(date, resolved);
      expect(Number.isFinite(ms), `date ${date} gave ${ms}`).toBe(true);
      expect(ms).toBeGreaterThan(previous);
      previous = ms;
    }

    // The span's own start is the origin the elapsed time is measured from, so times before
    // it are negative — which is the whole of what lets a note sounding early be placed.
    expect(millisecondsAt(startDate, resolved)).toBe(0);
    expect(millisecondsAt(startDate - 1, resolved)).toBeLessThan(0);
  });

  /**
   * No step at either boundary: the continuation starts where the curve leaves off.
   *
   * A billionth of a tick is under a microsecond of time even at the 2 bpm one of these spans
   * runs at, so a jump this test would miss is smaller than the answer is asked to be right to.
   */
  test.each(SHAPES)('continuously, over %s', (_, tempo) => {
    const resolved = resolveSpan(tempo);
    const spanMs = millisecondsAt(resolved.endDate, resolved);

    expect(Math.abs(millisecondsAt(resolved.startDate - 1e-9, resolved))).toBeLessThan(
      TOLERANCE_MS,
    );
    expect(Math.abs(millisecondsAt(resolved.endDate + 1e-9, resolved) - spanMs)).toBeLessThan(
      TOLERANCE_MS,
    );
  });
});

/**
 * The clamp issue #26 asks for by name, and the one `bugs.md` #7 asks meico for in
 * `TempoMap.renderTempoToMap`. Doing both keeps the two in step.
 */
test('getTempoAt clamps to the span rather than continuing the curve past it', () => {
  const tempo = span({ transitionTo: 90, meanTempoAt: 0.3 });

  expect(getTempoAt(tempo.date - 1000, tempo)).toBe(60);
  expect(getTempoAt(tempo.date, tempo)).toBe(60);
  expect(getTempoAt(tempo.endDate, tempo)).toBe(90);
  expect(getTempoAt(tempo.endDate + 1000, tempo)).toBe(90);
});
