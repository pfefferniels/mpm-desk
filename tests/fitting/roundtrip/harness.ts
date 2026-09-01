import { performMsmToData } from 'espressivo';
import type { PerformanceData, PerformedNote } from 'espressivo';
import { Alignment } from '../../../src/fitting/alignment';
import { createMpm, exportMPM, Mpm } from '../../../src/fitting/instructions/index';
import type { Transformer } from '../../../src/fitting/transformers/Transformer';
import { compareTransformers } from '../../../src/fitting/transformers/index';
import {
  InsertTempo,
  TranslatePhysicalTimeToTicks,
} from '../../../src/fitting/transformers/tempo/index';
import { InsertDynamicsInstructions } from '../../../src/fitting/transformers/dynamics/index';
import { InsertRubato } from '../../../src/fitting/transformers/rubato/InsertRubato';
import {
  InsertTemporalSpread,
  InsertDynamicsGradient,
  StylizeOrnamentation,
} from '../../../src/fitting/transformers/ornamentation/index';

import {
  InsertArticulation,
  type ArticulationProperty,
} from '../../../src/fitting/transformers/articulation/InsertArticulation';
import {
  InsertMetricalAccentuation,
  MergeMetricalAccentuations,
} from '../../../src/fitting/transformers/accentuation/index';
import { at } from '../../support/at';
import { buildScore, COMMON_TIME, PPQ, type ScoreSpec } from './score';
import { type Truth, truthMpm } from './truth';

/**
 * The round trip.
 *
 *     score + truth MPM  --espressivo-->  performance P
 *     score + P          --chain------->  fitted MPM
 *     score + fitted MPM --espressivo-->  performance P'
 *     assert P' ~ P
 *
 * The comparison is in **performance space**, not MPM space, because MPM to performance is
 * many-to-one: a velocity can come from `<dynamics>`, from an articulation's `relativeVelocity`
 * or from an accentuation, and timing from tempo or rubato. The chain is entitled to
 * explain the same performance differently than the truth did; what it is not entitled to do is
 * render differently. Every one of the four criticals in the 2026-08 audit is exactly that
 * shape — a well-formed MPM that renders wrong — which is why unit tests never saw them.
 *
 * `expectedParameters` on a case adds the MPM-space check on top, but only for cases built to
 * be identifiable: one aspect, exactly representable, boundaries handed in. Those are
 * diagnostic — they say *which* fitter is wrong instead of "the chain is off".
 */

export interface AspectError {
  mean: number;
  median: number;
  max: number;
}

export interface Errors {
  /** Note onset, in milliseconds. */
  onset: AspectError;
  /** Sounding duration, in milliseconds. */
  duration: AspectError;
  /** MIDI velocity, 0-127. */
  velocity: AspectError;
  /** How many notes were compared, and how many the refit failed to produce. */
  matched: number;
  missing: number;
}

export interface Bound {
  mean?: number;
  max?: number;
}

export interface Bounds {
  onset?: Bound;
  duration?: Bound;
  velocity?: Bound;
}

export interface Case {
  name: string;
  score: ScoreSpec;
  truth: Truth;
  /**
   * The bound each aspect's error must stay under. A bound looser than the aspect can be
   * fitted to is a recorded gap, and `note` says which issue keeps it loose — tightening it
   * is what "fixed" means for that issue.
   */
  bounds: Bounds;
  /**
   * Structural checks this case currently violates, by check name.
   *
   * Asserted as an exact set, not a ceiling: a violation that appears fails, and so does one
   * that has been fixed but left declared. A case may only carry this with a `note` naming the
   * issue — it is a recorded gap, not a licence.
   */
  knownViolations?: string[];
  note?: string;
}

// ── Running one case ──────────────────────────────────────────────

/** An MPM that says nothing, for the baseline render below. */
export const EMPTY_MPM =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<mpm xmlns="http://www.cemfi.de/mpm/ns/1.0">' +
  '<performance name="empty" pulsesPerQuarter="720">' +
  '<global><header/><dated/></global></performance></mpm>';

export interface RoundTripResult {
  score: Alignment;
  scoreXml: string;
  truthXml: string;
  truthPerformance: PerformanceData;
  /** The MSM the chain was given: the score, carrying the truth's performance. */
  performed: Alignment;
  fitted: Mpm;
  fittedXml: string;
  refitPerformance: PerformanceData;
  errors: Errors;
  transformers: Transformer[];
  /**
   * How far the truth performance departs from rendering the score under an empty MPM.
   *
   * A round trip is trivially perfect when the truth does nothing: an inert truth MPM — a
   * `@name.ref` that resolves to nothing, a transition with no successor, an attribute the
   * renderer ignores — renders as the bare score, the chain fits the bare score, and the case
   * passes while testing nothing. Every tier asserts this is non-zero, which is what stops a
   * mis-authored fixture from reading as a success.
   */
  exercised: Errors;
}

export const roundTrip = (spec: Case): RoundTripResult => {
  const needsTicks = !!(spec.truth.articulation || spec.truth.rubato?.length);
  if (needsTicks && !spec.truth.tempo?.length) {
    // `TranslatePhysicalTimeToTicks` reads the fitted tempo map to convert performed
    // milliseconds into ticks. With no tempo in the truth there is no map to read and the
    // case would measure that accident rather than what it means to.
    throw new Error(`case "${spec.name}": articulation and rubato need a tempo in the truth`);
  }

  const score = buildScore(spec.score);
  const scoreXml = score.serialize()!;
  const scoreNotes = score.allNotes.map((note) => ({ id: note['xml:id'], date: note.date }));

  const truthXml = truthMpm(spec.truth, scoreNotes);
  const truthPerformance = performMsmToData({ msm: scoreXml, mpm: truthXml });

  const performed = withPerformance(buildScore(spec.score), truthPerformance);

  const fitted = createMpm();
  const transformers = chainFor(spec, performed);
  for (const transformer of transformers) transformer.run(performed, fitted);

  const fittedXml = exportMPM(fitted);
  const refitPerformance = performMsmToData({ msm: scoreXml, mpm: fittedXml });
  const baseline = performMsmToData({ msm: scoreXml, mpm: EMPTY_MPM });

  return {
    score,
    scoreXml,
    truthXml,
    truthPerformance,
    performed,
    fitted,
    fittedXml,
    refitPerformance,
    errors: compare(truthPerformance, refitPerformance),
    exercised: compare(truthPerformance, baseline),
    transformers,
  };
};

/** Attach a rendered performance to a clean score, the way `asMSM` attaches an aligned one. */
const withPerformance = (score: Alignment, performance: PerformanceData): Alignment => {
  const byId = new Map<string, PerformedNote>();
  for (const part of performance.parts) {
    for (const note of part.notes) if (note.id) byId.set(note.id, note);
  }

  for (const note of score.allNotes) {
    const performed = byId.get(note['xml:id']);
    if (!performed) throw new Error(`no rendered note for ${note['xml:id']}`);
    note['milliseconds.date'] = performed.milliseconds.date;
    note['milliseconds.date.end'] = performed.milliseconds.end;
    note.velocity = performed.velocity;
  }

  return score;
};

// ── The chain, derived from the case ──────────────────────────────

/**
 * The transformer chain a case runs, derived from its truth — never hand-picked.
 *
 * Hand-tuning the chain per case is how a synthetic suite quietly starts measuring the person
 * who wrote it: given enough freedom to choose transformers and windows, almost any fit can be
 * made to look good. Deriving the chain mechanically from the same spec that produced the truth
 * removes that freedom, and `compareTransformers` — the registry's own order, not a hand-picked
 * one — decides what runs when.
 */
const chainFor = (spec: Case, msm: Alignment): Transformer[] => {
  const transformers: Transformer[] = [];
  const end = msm.lastDate();

  // Tempo is stated, not fitted.
  //
  // `ApproximateLogarithmicTempo` — which read a tempo curve off the onsets and was the one
  // fitter in the chain that could *discover* a tempo — is not part of this application. What
  // is left is `InsertTempo`, whose own doc comment says it "writes down the one it is given".
  //
  // So the truth's tempo map is handed to the chain rather than recovered from the recording,
  // and tempo stops being an aspect under test: it is the substrate the other five are
  // measured over. It cannot be dropped instead, because `TranslatePhysicalTimeToTicks` reads
  // the fitted tempo map to convert performed milliseconds into ticks — with no tempo in the
  // document every other fitter has nothing to convert against.
  //
  // Two consequences a reader has to know. The bounds in `cases.ts` were recorded against a
  // chain that fitted its own tempo, so every one of them is now slack by however much that
  // fit used to err — they are ceilings that still hold, not measurements of this chain. And
  // the four `tempo:` cases are gone from `cases.ts`, because stating a truth and rendering it
  // back measures the writer, not a fit.
  const tempo = spec.truth.tempo;
  if (tempo?.length) {
    tempo.forEach((span, index) =>
      transformers.push(
        new InsertTempo({
          scope: 'global',
          from: span.date,
          to: tempo[index + 1]?.date ?? end,
          bpm: span.bpm,
          ...(span['transition.to'] !== undefined && { transitionTo: span['transition.to'] }),
          ...(span.meanTempoAt !== undefined && { meanTempoAt: span.meanTempoAt }),
          beatLength: span.beatLength ?? 0.25,
        }),
      ),
    );
  }

  if (spec.truth.tempo?.length || spec.truth.rubato?.length || spec.truth.articulation) {
    transformers.push(new TranslatePhysicalTimeToTicks({ translatePhysicalModifiers: true }));
  }

  for (const frame of spec.truth.rubato ?? []) {
    // `InsertRubato` fits one frame per call and writes `loop="false"`, so a looping truth
    // frame has to be met with one call per repetition. Deriving that from `loop` rather
    // than writing the calls out by hand is what keeps the chain a function of the truth.
    const repetitions = frame.loop
      ? Math.max(1, Math.ceil((end - frame.date) / frame.frameLength))
      : 1;
    for (let repetition = 0; repetition < repetitions; repetition++) {
      transformers.push(
        new InsertRubato({
          scope: 'global',
          date: frame.date + repetition * frame.frameLength,
          length: frame.frameLength,
        }),
      );
    }

    // A looping truth frame is one instruction; the fit is one per repetition. `CombineAdjacentRubatos`
    // used to fold them back into a single `loop="true"` frame here, and it is not part of this
    // application. The fold was an MPM-space tidying: each repetition's `<rubato>` covers its own
    // stretch, so the unfolded document renders the same performance the folded one does, and this
    // suite compares performances. What is lost is the assertion that the fit can *recognise* the
    // repetition — which was never this suite's to make anyway, since it never read the frame count.
  }

  if (spec.truth.ornamentation) {
    transformers.push(...ornamentationCalls(spec));
  }

  if (spec.truth.dynamics?.length) {
    const windows = fittingWindows(
      spec.truth.dynamics.map((span) => span.date),
      end,
    );
    for (const window of windows) {
      transformers.push(
        new InsertDynamicsInstructions({
          scope: 'global',
          from: window.from,
          to: window.to,
          phantomVelocities: new Map(),
        }),
      );
    }
  }

  if (spec.truth.accentuation) {
    transformers.push(...accentuationCalls(spec, end));
  }

  if (spec.truth.articulation) {
    transformers.push(...articulationCalls(spec, msm));
  }

  return transformers.sort(compareTransformers);
};

/**
 * The ornamentation chain: fit the two families, then cluster them into definitions.
 *
 * Only the families the truth actually uses are fitted, so a spread-only case does not have a
 * gradient fitter reading a chord it has nothing to say about. `StylizeOrnamentation` always
 * runs: `InsertDynamicsGradient` writes `name.ref="neutralArpeggio"` and parks the attributes
 * on the instruction, and it is the clustering step that turns those into the `<ornamentDef>`
 * the reference resolves to. Without it the map names a definition that was never written —
 * which tier 0 reports rather than measuring around.
 *
 * The registry orders `InsertTemporalSpread` before `InsertDynamicsGradient`, while the latter's
 * own doc comment says the opposite ("should always take place before inserting temporal
 * spread, since temporal spread will destroy the original order of MIDI onsets"). This chain
 * follows the registry, because the registry is what the pipeline follows. See issue #32.
 */
const ornamentationCalls = (spec: Case): Transformer[] => {
  const ornamentation = spec.truth.ornamentation!;
  const calls: Transformer[] = [];

  if (ornamentation.defs.some((def) => def.dynamicsGradient)) {
    calls.push(
      new InsertDynamicsGradient({
        scope: 'global',
        crescendo: { from: -1, to: 0 },
        decrescendo: { from: 0, to: -1 },
        sortVelocities: false,
      }),
    );
  }

  if (ornamentation.defs.some((def) => def.temporalSpread)) {
    calls.push(
      new InsertTemporalSpread({
        scope: 'global',
        placement: 'estimate',
        durationThreshold: 35,
        noteOffShiftTolerance: 500,
      }),
    );
  }

  calls.push(
    new StylizeOrnamentation({
      tickTolerance: 10,
      gradientTolerance: 0.1,
      intensityTolerance: 0.3,
    }),
  );

  return calls;
};

/**
 * One `InsertMetricalAccentuation` per measure, then the merge.
 *
 * The transformer fits a single metrical cell per call: `extractVelocities` walks
 * `[from, to]` in `beatLength` steps and numbers the beats from 1, and the last sample only
 * closes the previous beat's transition. So a cell is one bar, its `to` is the *next* bar's
 * downbeat, and covering a piece means one call per bar — which is also why the registry has
 * `MergeMetricalAccentuations` right behind it to fold the identical ones back together.
 */
const accentuationCalls = (spec: Case, end: number): Transformer[] => {
  const accentuation = spec.truth.accentuation!;
  const signature = spec.score.timeSignature ?? COMMON_TIME;
  const beatTicks = (4 * PPQ) / signature.denominator;
  const measureTicks = signature.numerator * beatTicks;

  const names: string[] = [];
  const calls: Transformer[] = [];
  for (let from = accentuation.date; from + measureTicks <= end; from += measureTicks) {
    const name = `fitted_accentuation_${from}`;
    names.push(name);
    calls.push(
      new InsertMetricalAccentuation({
        scope: 'global',
        name,
        from,
        to: from + measureTicks,
        beatLength: 1 / signature.denominator,
        scaleTolerance: 0.1,
      }),
    );
  }

  if (names.length > 1) {
    calls.push(
      new MergeMetricalAccentuations({
        scope: 'global',
        names,
        into: 'fitted_accentuation',
      }),
    );
  }

  return calls;
};

/**
 * One `InsertArticulation` per group of notes that shares an articulation.
 *
 * A single call cannot express per-note variation: it averages its notes into one
 * `<articulationDef>` and blanks the per-note attributes, so every note it covers ends up with
 * the mean. So the truth's grouping is handed in, and a truth with no pattern gets one call.
 *
 * There used to be a third path: withhold the grouping, fit one call over everything, and let
 * `StylizeArticulation` cluster the notes back apart. That transformer is not part of this
 * application, and with it went the `discoverBoundaries` mode and the one case that used it.
 */
const articulationCalls = (spec: Case, msm: Alignment): Transformer[] => {
  const articulation = spec.truth.articulation!;
  const aspects = new Set<ArticulationProperty>();
  for (const def of articulation.defs) {
    if (def.relativeDuration !== undefined) aspects.add('relativeDuration');
    if (def.relativeVelocity !== undefined) aspects.add('relativeVelocity');
  }

  const noteIds = msm.allNotes.map((note) => note['xml:id']);
  const pattern = articulation.pattern;

  if (!pattern?.length) {
    return [
      new InsertArticulation({
        scope: 'global',
        noteIDs: noteIds,
        aspects,
        name: 'fitted_articulation',
      }),
    ];
  }

  const groups = new Map<string, string[]>();
  noteIds.forEach((id, index) => {
    const name = at(pattern, index % pattern.length, 'articulation pattern entry');
    const group = groups.get(name) ?? [];
    group.push(id);
    groups.set(name, group);
  });

  return Array.from(groups.entries()).map(
    ([name, ids]) =>
      new InsertArticulation({
        scope: 'global',
        noteIDs: ids,
        aspects,
        name: `fitted_${name}`,
      }),
  );
};

/** Consecutive `[date, nextDate)` windows, dropping any the score does not reach. */
const fittingWindows = (dates: number[], end: number) => {
  const sorted = [...new Set(dates)].sort((a, b) => a - b);
  return sorted
    .map((from, index) => ({ from, to: sorted[index + 1] ?? end }))
    .filter((window) => window.from < window.to);
};

// ── Comparison ────────────────────────────────────────────────────

export const statistics = (values: number[]): AspectError => {
  if (values.length === 0) return { mean: 0, median: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: at(sorted, Math.floor(sorted.length / 2), 'median'),
    max: at(sorted, sorted.length - 1, 'max'),
  };
};

const compare = (truth: PerformanceData, refit: PerformanceData): Errors => {
  const byId = new Map<string, PerformedNote>();
  for (const part of refit.parts) {
    for (const note of part.notes) if (note.id) byId.set(note.id, note);
  }

  const onsets: number[] = [];
  const durations: number[] = [];
  const velocities: number[] = [];
  let missing = 0;

  for (const part of truth.parts) {
    for (const note of part.notes) {
      const other = note.id ? byId.get(note.id) : undefined;
      if (!other) {
        missing++;
        continue;
      }
      onsets.push(Math.abs(other.milliseconds.date - note.milliseconds.date));
      durations.push(
        Math.abs(
          other.milliseconds.end -
            other.milliseconds.date -
            (note.milliseconds.end - note.milliseconds.date),
        ),
      );
      velocities.push(Math.abs(other.velocity - note.velocity));
    }
  }

  return {
    onset: statistics(onsets),
    duration: statistics(durations),
    velocity: statistics(velocities),
    matched: onsets.length,
    missing,
  };
};

export const notesOf = (performance: PerformanceData) =>
  performance.parts.flatMap((part) => part.notes);

/** A one-line error summary, so a failing case says what it measured rather than just failing. */
export const describe = (errors: Errors) =>
  `onset ${errors.onset.mean.toFixed(2)}/${errors.onset.max.toFixed(2)} ms · ` +
  `duration ${errors.duration.mean.toFixed(2)}/${errors.duration.max.toFixed(2)} ms · ` +
  `velocity ${errors.velocity.mean.toFixed(2)}/${errors.velocity.max.toFixed(2)} ` +
  `(mean/max over ${errors.matched} notes)`;
