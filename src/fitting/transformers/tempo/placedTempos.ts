/**
 * The piece cut into tempo segments, with the millisecond timeline anchored on the recording.
 *
 * Four callers need the same walk over the tempo list (`addTickOnsets`, `addTickDurations`, and
 * the two directions of the millisecond ⇄ tick conversion): close the instruction against the
 * next one, convert the span to milliseconds, advance a running cursor. That loop encodes the
 * most consequential rule in the fit:
 *
 * > **At every tempo boundary the cursor is re-anchored on the recorded onset of the note sitting
 * > on it, not on the tempo's own prediction.**
 *
 * It keeps one segment's error out of the next, and it is why the tick domain cannot be recovered
 * by inverting a rendered performance, which has no recording to anchor to. Stated once because a
 * hand-copy diverges: looking the anchor up in `msm.allNotes` rather than `msm.in(scope).notes()`
 * anchors, under part-scoped tempo maps, on notes from a different part than the one being
 * walked.
 *
 * ## Modelled and measured
 *
 * A segment has two lengths and they are not the same number:
 *
 * - {@link PlacedTempo.modelledMs} — what the `<tempo>` says it lasts.
 * - {@link PlacedTempo.measuredMs} — what the recording says it lasts, when a note lands on the
 *   boundary to say so; {@link PlacedTempo.modelledMs} when none does.
 *
 * The cursor always advances by the measured length, which is the anchoring rule stated as
 * arithmetic: `startMs + measuredMs` is the anchor's own onset wherever there is an anchor.
 *
 * Which of the two bounds a segment *as a window* is not a free choice, and the callers have to
 * agree on it (issue #27): windows built from `modelledMs` while the cursor advances by
 * `measuredMs` are neither contiguous nor exhaustive, so an event in a gap gets no tick position
 * and one in an overlap takes its onset from one segment and its duration from the next. The
 * windows are a partition; {@link segmentAtMs} states that.
 */
import { getInstructions, Mpm, type Scope } from '../../instructions/index';
import { Alignment, type AlignedNote } from '../../alignment';
import { millisecondsAt, resolveSpan, type TempoWithEndDate } from './tempoCalculations';
import type { Tempo as ResolvedTempo } from 'espressivo';
import { elementAt, withNext } from 'espressivo';

export interface PlacedTempo {
  /** The instruction, carrying the date the next one starts (or the end of the score). */
  readonly tempo: TempoWithEndDate;

  /**
   * The instruction as the renderer resolves it. Resolved once per segment because the
   * consumers evaluate it many times, and resolving parses `@bpm` out of text: a walk over a
   * score asks about the same span once per note, and `dateAtMilliseconds` several times per
   * ask.
   */
  readonly resolved: ResolvedTempo;

  /**
   * The date the *next* instruction starts, or `undefined` for the last segment.
   *
   * Distinct from `tempo.endDate`, which for the last segment is the end of the score. A note
   * belongs to a segment when it is at or after `tempo.date` and, if there is a next
   * instruction, before it — the open-ended last segment takes everything remaining.
   */
  readonly nextDate: number | undefined;

  /** Where the segment begins on the recorded millisecond timeline. */
  readonly startMs: number;

  /** What the `<tempo>` says the segment lasts, in milliseconds. */
  readonly modelledMs: number;

  /** The note whose recorded onset sits exactly on the segment's end, if there is one. */
  readonly anchor: AlignedNote | undefined;

  /**
   * What the *recording* says the segment lasts: the anchor's onset less {@link startMs}, or
   * {@link modelledMs} where no note lands on the boundary.
   *
   * `startMs + measuredMs` is therefore the next segment's `startMs`, always — which is why
   * this and not {@link modelledMs} is what bounds a segment as a window on the recording.
   * {@link segmentAtMs} is the only place that division is made.
   */
  readonly measuredMs: number;
}

/**
 * The tempo segments of one scope, in order, with the millisecond cursor already anchored.
 *
 * Returns an empty array when the scope has no `<tempo>` at all, which is what an MPM with no
 * tempoMap yet looks like — every caller reads that as "no tick position is derivable".
 */
export const placeTempos = (msm: Alignment, mpm: Mpm, scope: Scope): PlacedTempo[] => {
  const tempos = getInstructions(mpm, 'tempo', scope);

  // The anchoring rule, in one place. `msm.in(scope).notes()` and not `allNotes`: the tempo being
  // walked governs this scope, so the note that dates its boundary must be one it governs.
  //
  // Indexed by date once rather than scanned per segment, which would make placing a map
  // O(tempos x notes) — and every consumer of a tick position places the map first. The first
  // note on a date wins, which is the note a linear `find` answers with.
  const anchorByDate = new Map<number, AlignedNote>();
  for (const note of msm.in(scope).notes()) {
    if (!anchorByDate.has(note.date)) anchorByDate.set(note.date, note);
  }

  const segments: PlacedTempo[] = [];
  let startMs = 0;

  for (const [current, next] of withNext(tempos)) {
    const nextDate = next?.date;
    const endDate = nextDate ?? msm.end;

    const tempo: TempoWithEndDate = { ...current, endDate };
    const resolved = resolveSpan(tempo);
    const modelledMs = millisecondsAt(endDate, resolved);

    const anchor = anchorByDate.get(endDate);
    const measuredMs = anchor ? anchor['milliseconds.date'] - startMs : modelledMs;

    segments.push({ tempo, resolved, nextDate, startMs, modelledMs, anchor, measuredMs });

    startMs += measuredMs;
  }

  return segments;
};

/**
 * Whether `date` falls in the stretch of *score* this segment governs.
 *
 * The tick windows tile `[tempos[0].date, ∞)` exactly, so a note has one segment or none, and
 * none means the tempo map does not reach back as far as the note's *score date* — a partial fit,
 * where the map starts later than the piece does.
 *
 * A different question from the one {@link segmentAtMs} folds into its first window, and the two
 * do not conflict. There an event's recorded time falls before the first segment's cursor, which
 * starts at zero, so only a negative onset reaches it and the first instruction still governs.
 * Here the tempo map does not claim the note at all, and the right answer is unsettled: the
 * renderer performs such a note at MPM's default of 100 quarter-bpm
 * (`TempoMap.renderTempoToMap`), while the ornament path extrapolates at the first instruction's
 * tempo rather than bake one renderer's fallback into the document (see the 'ornamentation:
 * rolled chords' round-trip case). Leaving the position unknown answers neither, which is a
 * decision about partial fits rather than about issue #27.
 */
export const coversDate = (segment: PlacedTempo, date: number): boolean =>
  date >= segment.tempo.date && (segment.nextDate === undefined || date < segment.nextDate);

/**
 * The segment governing a millisecond time on the *recording*'s timeline.
 *
 * The windows are `[startMs, startMs + measuredMs)`, and because the cursor advances by exactly
 * `measuredMs` that makes each one's end the next one's start: contiguous by construction rather
 * than by two expressions happening to agree. The first window opens at −∞ and the last closes at
 * +∞, so **every** finite time has exactly one segment and no caller has to decide what to do
 * with one that has none.
 *
 * Both open ends earn their place. A recording is aligned to the score rather than generated
 * from it, so an onset can land before the first modelled moment, and a note or pedal released
 * after the last is ordinary: the final `<tempo>` runs to the end of the *score*, and a
 * performer's hand comes off the key after that. Issue #27 is what closing them cost, the last
 * note of the run having no `tickDuration`, which `InsertRubato` saw and abandoned the whole
 * frame over while `InsertArticulation` did not see it and wrote `NaN`.
 *
 * Searching from the end rather than the start is what makes the fold-in work, and it also
 * decides the degenerate case: where a recording is so far out of order that the cursor goes
 * backwards, the later segment wins.
 */
export const segmentAtMs = (segments: PlacedTempo[], ms: number): PlacedTempo | undefined => {
  for (let i = segments.length - 1; i > 0; i--) {
    const segment = elementAt(segments, i, 'the placed tempo segments');
    if (ms >= segment.startMs) return segment;
  }
  return segments[0];
};
