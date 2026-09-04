/**
 * Where a recorded onset falls on the score grid.
 *
 * This is the tempo half of the reduction: it reads the `<tempo>` instructions already in the
 * MPM and converts each note's recorded onset into `tickDate`, and the span from it to the
 * recorded release into `tickDuration` — the only domain `<rubato>` and `<articulation>` can
 * speak.
 *
 * Apart from any one transformer, because two callers need it and neither should import the
 * other: `TranslatePhysicalTimeToTicks`, which writes the values onto the score, and
 * `deriveResidual`, which computes them on a scratch copy.
 *
 * **The conversion is a function of the MPM *and* the recording, not of the MPM alone.** At every
 * tempo boundary the running millisecond cursor is re-anchored on the recorded onset of the note
 * sitting on it rather than on the tempo's own prediction. That keeps a segment's error out of
 * the next, and it is why the tick domain cannot be recovered by inverting a rendered
 * performance, which has no recording to anchor to. `performMsmToData` is not a substitute.
 *
 * The walk itself is in `placedTempos.ts`, which states the rule once for its four callers.
 */
import { getInstructions, Mpm, scopesOf } from '../../instructions/index';
import { Alignment } from '../../alignment';
import { dateAtMilliseconds } from './tempoCalculations';
import { coversDate, placeTempos, type PlacedTempo, segmentAtMs } from './placedTempos';
import { removeRubatoDistortion } from '../rubato/rubatoMath';

/** Where one note or pedal fell on the score grid. Absent fields mean "no tempo covered it". */
export interface TickTime {
  tickDate?: number;
  tickDuration?: number;
}

/**
 * The derived positions, notes and pedals kept apart because their ids are only unique within
 * their own map.
 */
export interface TickTimes {
  readonly notes: Map<string, TickTime>;
  readonly pedals: Map<string, TickTime>;
}

export const emptyTickTimes = (): TickTimes => ({ notes: new Map(), pedals: new Map() });

/**
 * The entry for an id, created on first ask.
 *
 * Returning a mutable record rather than a value is deliberate: it lets the walks below keep
 * reading and writing positions as `at(...).tickDate = x`, which is what they did when the
 * positions lived on the note, so the arithmetic and the control flow are unchanged from the
 * version this was measured against.
 */
const at = (table: Map<string, TickTime>, id: string): TickTime => {
  const existing = table.get(id);
  if (existing) return existing;
  const fresh: TickTime = {};
  table.set(id, fresh);
  return fresh;
};

/**
 * Where a recorded time falls on the tick grid, under whichever segment governs it.
 *
 * The one place a millisecond time becomes a tick date, so that "which segment" and "measured
 * from that segment's own start" cannot come apart. Returns `undefined` only when the scope has
 * no `<tempo>` at all, or when the recording says nothing about this event — a note the
 * alignment left unperformed has no time to convert, and inventing one for it would be worse
 * than leaving the position unknown.
 */
const tickAtMs = (segments: PlacedTempo[], ms: number): number | undefined => {
  const segment = segmentAtMs(segments, ms);
  if (!segment) return undefined;
  const ticks = dateAtMilliseconds(ms - segment.startMs, segment.resolved);
  return Number.isFinite(ticks) ? ticks : undefined;
};

/**
 * Translates recorded onsets into tick dates, writing `tickDate` for every note and pedal a
 * segment covers.
 *
 * Notes and pedals are placed by different keys, and the asymmetry is forced rather than
 * incidental: a note carries a score `@date`, so the instruction governing it is the one covering
 * that date, and its recorded onset is then measured under that instruction — which is the
 * anchoring rule. A pedal carries no score date at all (see `AlignedPedal`), so the only question
 * that can be asked of it is which segment its *recording* falls in.
 *
 * And `msm.pedals` is not scoped, so with a part-scoped tempo map in the document every scope
 * would place every pedal. The first one to reach it keeps it — `scopesOf` puts `global` first,
 * which is the map a sustain pedal belongs under.
 */
const addTickOnsets = (msm: Alignment, mpm: Mpm, times: TickTimes) => {
  for (const scope of scopesOf(mpm)) {
    const segments = placeTempos(msm, mpm, scope);
    if (segments.length === 0) continue;

    for (const note of msm.in(scope).notes()) {
      const segment = segments.find((s) => coversDate(s, note.date));
      if (!segment) continue;
      const tickDate = dateAtMilliseconds(
        note['milliseconds.date'] - segment.startMs,
        segment.resolved,
      );
      if (!Number.isFinite(tickDate)) continue;
      at(times.notes, note['xml:id']).tickDate = tickDate;
    }

    for (const pedal of msm.pedals) {
      if (times.pedals.get(pedal['xml:id'])?.tickDate !== undefined) continue;
      const tickDate = tickAtMs(segments, pedal['milliseconds.date']);
      if (tickDate === undefined) continue;
      at(times.pedals, pedal['xml:id']).tickDate = tickDate;
    }
  }
};

/**
 * Translates recorded releases into tick durations, measured from the onsets
 * {@link addTickOnsets} has already placed — so it must run after it.
 *
 * A release is placed by the segment governing the *release*, which need not be the one that
 * placed the onset: a note held across a tempo boundary is released under the instruction in
 * force where the hand comes off the key, and both ends are absolute tick positions, so
 * subtracting them across a boundary is exactly right.
 *
 * Where the onset was never placed there is nothing to measure from, and the duration stays
 * unknown rather than becoming the difference between a tick and `undefined`.
 */
const addTickDurations = (msm: Alignment, mpm: Mpm, times: TickTimes) => {
  for (const scope of scopesOf(mpm)) {
    const segments = placeTempos(msm, mpm, scope);
    if (segments.length === 0) continue;

    for (const note of msm.in(scope).notes()) {
      const time = times.notes.get(note['xml:id']);
      if (time?.tickDate === undefined) continue;
      const release = tickAtMs(segments, note['milliseconds.date.end']);
      if (release === undefined) continue;
      time.tickDuration = release - time.tickDate;
    }

    // Same first-wins rule as the onsets, and for the same reason.
    for (const pedal of msm.pedals) {
      const time = times.pedals.get(pedal['xml:id']);
      if (time?.tickDate === undefined || time.tickDuration !== undefined) continue;
      const release = tickAtMs(segments, pedal['milliseconds.date.end']);
      if (release === undefined) continue;
      time.tickDuration = release - time.tickDate;
    }
  }
};

/**
 * Where every note and pedal fell on the score grid, under the MPM as it stands.
 *
 * The order is the whole of what this adds over the three steps it calls, and it is not free to
 * change: durations are measured from the onsets, and the rubato warp comes off positions that
 * already exist. A `<rubato>` the document holds has explained its share of the deviation, so it
 * is taken back off — leaving what nothing has explained yet, which is what a fitter wants.
 */
export const computeTickTimes = (msm: Alignment, mpm: Mpm): TickTimes => {
  const times = emptyTickTimes();

  addTickOnsets(msm, mpm, times);
  addTickDurations(msm, mpm, times);

  // Scopes with no rubato are skipped rather than walked. If a global and a part rubato ever
  // covered the same note the removal would compound, which is not what a part map overriding
  // a global one should mean; rubatos are written in one scope, so it does not arise.
  for (const scope of scopesOf(mpm)) {
    if (getInstructions(mpm, 'rubato', scope).length === 0) continue;
    removeRubatoDistortion(msm, mpm, scope, times);
  }

  return times;
};
