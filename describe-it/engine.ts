/**
 * DescribeIt's engine: the fitting chain of the MPM Desk, run for a piano roll that shows what the
 * MPM as it stands leaves unexplained.
 *
 * Nothing of the chain is reimplemented here. A list of calls goes in, `buildChain` orders it,
 * every transformer runs as it does in the editor, and `deriveResidual` says where each recorded
 * note falls on the score grid and how far its velocity is from what the document sounds it at.
 *
 * What is added is what a reader who only describes needs and a reader who draws does not:
 *
 * - **Fitted steps.** `InsertTempo` writes the tempo it is handed, because in the editor a person
 *   draws it. Somebody who says "steady on half bars" hands over no number, so {@link FitTempo}
 *   reads one off the recorded onsets and then makes the same `InsertTempo` call a drawn line
 *   would have made. {@link FitDynamics} does the same for a level.
 * - **Assumptions.** A tick position exists only under a `<tempo>`, and a velocity residual only
 *   against a `<dynamics>`. Where nothing has been said yet the engine assumes the least: a steady
 *   tempo joining what has been described on either side, and one level throughout. They are
 *   ordinary `InsertTempo` and `InsertDynamics` calls, reported apart so that a page can show
 *   them as assumed.
 * - **`Repeat`**, which writes one call per step of a span, for a remark about every beat of a
 *   passage.
 *
 * Bundled into one file for the browser by `build.ts`; it has no DOM in it and runs in a worker.
 */
import { performMsmToData } from 'espressivo';
import '../src/fitting/transformers/index';
import { buildChain } from '../src/fitting/chain';
import { registerTransformer } from '../src/fitting/transformers/TransformerRegistry';
import {
  AbstractTransformer,
  type ScopedTransformationOptions,
  type Transformer,
} from '../src/fitting/transformers/Transformer';
import { InsertTempo, type InsertTempoOptions } from '../src/fitting/transformers/tempo/InsertTempo';
import { InsertDynamics } from '../src/fitting/transformers/dynamics/InsertDynamics';
import {
  coversDate,
  placeTempos,
  renderedMsAt,
  segmentAtMs,
  type PlacedTempo,
} from '../src/fitting/transformers/tempo/placedTempos';
import {
  dateAtMilliseconds,
  getTempoAt,
  millisecondsAt,
  resolveSpan,
} from '../src/fitting/transformers/tempo/tempoCalculations';
import { createMpm, exportMPM, type Mpm, withoutMaps } from '../src/fitting/instructions/index';
import { clearResidualCache, deriveResidual, type Residual } from '../src/fitting/residual';
import { Alignment, type AlignedNote } from '../src/fitting/alignment';
import type { Range } from '../src/fitting/transformers/range';
import { parseWorkFile, type Call } from '../src/model/Work';
import type { AlignmentData } from '../src/fitting/fit.worker';

const PPQ = 720;
const WHOLE = PPQ * 4;

// ---------------------------------------------------------------------------------------------
// Reading the recording
// ---------------------------------------------------------------------------------------------

/** The onset of the chord on each date: the note the tempo walk itself would anchor on. */
const anchorsOf = (msm: Alignment): Map<number, number> => {
  const anchors = new Map<number, number>();
  for (const note of msm.in('global').notes()) {
    if (!anchors.has(note.date) && Number.isFinite(note['milliseconds.date'])) {
      anchors.set(note.date, note['milliseconds.date']);
    }
  }
  return anchors;
};

/** The chords between two dates, both included, ascending. */
const chordsBetween = (anchors: Map<number, number>, from: number, to: number) =>
  [...anchors.entries()]
    .filter(([date]) => date >= from && date <= to)
    .sort((a, b) => a[0] - b[0])
    .map(([date, ms]) => ({ date, ms }));

const beats = (ticks: number, beatLength: number) => ticks / (WHOLE * beatLength);

const median = (values: number[]): number => {
  if (values.length === 0) return 64;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

// ---------------------------------------------------------------------------------------------
// Fitting a tempo
// ---------------------------------------------------------------------------------------------

interface FittedTempo {
  bpm: number;
  transitionTo?: number;
  meanTempoAt?: number;
  /** How far the fitted line is from the onsets it was fitted to, root mean square, in ms. */
  rmsMs: number;
  /** How many chords it was fitted to. */
  onsets: number;
}

/** A moment of the span being fitted: a date of the score and when it sounded. */
interface Moment {
  date: number;
  ms: number;
}

/**
 * The tempo a span has to hold for its last chord to fall where it was played, given when the
 * span begins.
 *
 * @param start when the span's first tick sounds: its chord's onset, or, where no chord stands
 * there, where the tempo before it leaves off.
 * @param chords the chords after the span's first tick, ascending.
 */
const steadyTempo = (start: Moment, chords: Moment[], beatLength: number): FittedTempo | undefined => {
  const last = chords[chords.length - 1];
  if (!last || last.date <= start.date || last.ms <= start.ms) return undefined;
  const bpm = (60000 * beats(last.date - start.date, beatLength)) / (last.ms - start.ms);
  const perTick = (last.ms - start.ms) / (last.date - start.date);
  const squares = chords.map((c) => (start.ms + (c.date - start.date) * perTick - c.ms) ** 2);
  return {
    bpm,
    rmsMs: Math.sqrt(squares.reduce((a, b) => a + b, 0) / chords.length),
    onsets: chords.length,
  };
};

/**
 * A tempo that moves across a span, fitted to the chords in it.
 *
 * Two things are searched for, how far the tempo moves (`transitionTo / bpm`) and where along the
 * way it is half done (`meanTempoAt`); the level is not, because for any shape there is one level
 * at which the span's last chord falls where it was played, and that one is taken. So the fitted
 * line always meets both ends of what it was fitted to, as a steady one does.
 *
 * @param end where the instruction stops applying, which is where its curve arrives.
 */
const movingTempo = (
  start: Moment,
  chords: Moment[],
  end: number,
  beatLength: number,
): FittedTempo | undefined => {
  const steady = steadyTempo(start, chords, beatLength);
  const last = chords[chords.length - 1];
  // Two numbers more than a steady tempo has, so it takes chords to tell a bend from noise: with
  // fewer than three after the start a curve passes through anything.
  if (!steady || !last || chords.length < 3) return steady;

  const played = last.ms - start.ms;
  const errorOf = (ratio: number, meanTempoAt: number) => {
    // At 60 to 60 x ratio the chords fall at `unscaled`; scaling both ends scales that inversely.
    const probe = resolveSpan({
      date: start.date,
      endDate: end,
      beatLength,
      bpm: 60,
      transitionTo: 60 * ratio,
      meanTempoAt,
    });
    const unscaled = millisecondsAt(last.date, probe);
    if (!Number.isFinite(unscaled) || unscaled <= 0) return undefined;
    const scale = played / unscaled;
    let squares = 0;
    for (const chord of chords) {
      squares += (start.ms + millisecondsAt(chord.date, probe) * scale - chord.ms) ** 2;
    }
    return { squares, bpm: 60 / scale };
  };

  let best = { squares: Infinity, ratio: 1, meanTempoAt: 0.5, bpm: steady.bpm };
  const consider = (ratio: number, meanTempoAt: number) => {
    const found = errorOf(ratio, meanTempoAt);
    if (found && found.squares < best.squares) best = { ...found, ratio, meanTempoAt };
  };
  // Between half and double: a span whose tempo moves further than that is not one gesture.
  for (let r = -12; r <= 12; r++) {
    for (let m = 3; m <= 17; m++) consider(2 ** (r / 12), m / 20);
  }
  const coarse = best;
  for (let r = -5; r <= 5; r++) {
    for (let m = -4; m <= 4; m++) {
      const mean = Math.min(0.9, Math.max(0.1, coarse.meanTempoAt + m / 80));
      consider(Math.min(2, Math.max(0.5, coarse.ratio * 2 ** (r / 72))), mean);
    }
  }

  const rmsMs = Math.sqrt(best.squares / chords.length);
  // A tempo that hardly moves is a steady one, and so is one whose bend explains little more
  // than a steady one does: both are written steady.
  if (Math.abs(best.ratio - 1) < 0.03 || rmsMs > 0.85 * steady.rmsMs) return steady;
  return {
    bpm: best.bpm,
    transitionTo: best.bpm * best.ratio,
    meanTempoAt: best.meanTempoAt,
    rmsMs,
    onsets: chords.length,
  };
};

export interface FitTempoOptions extends ScopedTransformationOptions {
  /** Where the tempo starts, in ticks. */
  from: number;
  /** Where it stops applying, in ticks, exclusive. A chord on it is the one fitted to. */
  to: number;
  /** The beat the tempo is counted in, as a fraction of a whole note. */
  beatLength: number;
  /** One tempo held over the span, or one that moves across it. */
  shape: 'steady' | 'transition';
  /** Set by the engine on a span nobody described: the tempo it assumes there. */
  assumed?: boolean;
}

/**
 * `InsertTempo` with the numbers read off the recording.
 *
 * Fitted where `InsertTempo` runs, after the rolls of the chords have been taken out, so the
 * onsets it reads are the ones the tempo walk will place. Its calls run in the order of the
 * score, which the fit leans on: a span no chord begins is measured from where the tempo before
 * it leaves off, which that tempo has to have been written to say.
 */
export class FitTempo extends AbstractTransformer<FitTempoOptions> {
  readonly name = 'FitTempo';
  readonly requires = [];
  /** What the last run fitted, for the page to show and for an export that states it. */
  fitted?: InsertTempoOptions & { rmsMs: number; onsets: number };

  constructor(options?: FitTempoOptions) {
    super(options ?? { scope: 'global', from: 0, to: 0, beatLength: 0.25, shape: 'steady' });
  }

  range(): Range | undefined {
    return this.options.assumed ? undefined : { from: this.options.from, to: this.options.to };
  }

  override evidence(msm: Alignment, residual?: Residual): string[] {
    return this.options.assumed ? [] : super.evidence(msm, residual);
  }

  protected transform(msm: Alignment, mpm: Mpm): void {
    this.fitted = undefined;
    msm.shiftToFirstOnset();
    const { scope, from, beatLength, shape } = this.options;
    let { to } = this.options;
    if (!(to > from)) throw new Error(`FitTempo: "to" (${to}) has to lie after "from" (${from})`);

    const anchors = anchorsOf(msm);
    const chords = chordsBetween(anchors, from, to).filter((chord) => chord.date > from);
    const last = chords[chords.length - 1];
    const start = this.startOf(msm, mpm, anchors);
    if (this.options.assumed && (!last || !start)) {
      // A gap nothing sounds in, the tail of the score after its last chord. No tempo can be
      // read there and none places a note, but the tempo before it has to stop somewhere.
      const all = chordsBetween(anchors, 0, Infinity);
      const whole = all[0] && steadyTempo(all[0], all.slice(1), beatLength);
      const options = { scope, from, to, beatLength, bpm: whole?.bpm ?? 60 };
      this.fitted = { ...options, rmsMs: 0, onsets: 0 };
      new InsertTempo(options).run(msm, mpm);
      return;
    }
    if (!last || !start) {
      throw new Error(
        `FitTempo: no chord sounds after tick ${from} up to tick ${to}, so there is no tempo to ` +
          'read off. Widen the span.',
      );
    }

    // A tempo that moves needs an instruction after it to arrive at, and the score's end has
    // none. There its curve runs to the last chord, where a tempo that holds takes over.
    const closes = shape === 'transition' && to >= msm.end && last.date > from;
    if (closes) to = last.date;

    const fit =
      shape === 'transition'
        ? movingTempo(start, chords, to, beatLength)
        : steadyTempo(start, chords, beatLength);
    if (!fit) {
      throw new Error(`FitTempo: the chords between ticks ${from} and ${to} do not follow one another in time`);
    }

    const options: InsertTempoOptions = {
      scope,
      from,
      to,
      beatLength,
      bpm: fit.bpm,
      ...(fit.transitionTo !== undefined && {
        transitionTo: fit.transitionTo,
        meanTempoAt: fit.meanTempoAt,
      }),
    };
    this.fitted = { ...options, rmsMs: fit.rmsMs, onsets: fit.onsets };
    new InsertTempo(options).run(msm, mpm);
    if (closes && fit.transitionTo !== undefined) {
      new InsertTempo({ scope, from: to, to: msm.end, beatLength, bpm: fit.transitionTo }).run(msm, mpm);
    }
  }

  /** When the span's first tick sounds: its chord, or where the tempo so far puts it. */
  private startOf(msm: Alignment, mpm: Mpm, anchors: Map<number, number>): Moment | undefined {
    const { scope, from, to } = this.options;
    const onset = anchors.get(from);
    if (onset !== undefined) return { date: from, ms: onset };

    const segment = placeTempos(msm, mpm, scope).findLast((placed) => placed.tempo.date <= from);
    if (segment) {
      const ms = segment.startMs + millisecondsAt(from, segment.resolved);
      if (Number.isFinite(ms)) return { date: from, ms };
    }
    // No tempo before it to say: the span is measured from its first chord.
    const first = chordsBetween(anchors, from, to)[0];
    return first;
  }
}

export interface FitDynamicsOptions extends ScopedTransformationOptions {
  from: number;
  to: number;
}

/**
 * One level held over a span: the mean of what its chords were played at.
 *
 * `InsertDynamics` takes the first and last chord of its span as the two ends of a curve. A
 * level is the case where the reader says there is no curve, so the ends are not to be read off
 * two chords that happen to stand there.
 */
export class FitDynamics extends AbstractTransformer<FitDynamicsOptions> {
  readonly name = 'FitDynamics';
  readonly requires = [];
  fitted?: { volume: number; chords: number };

  constructor(options?: FitDynamicsOptions) {
    super(options ?? { scope: 'global', from: 0, to: 0 });
  }

  range(): Range {
    return { from: this.options.from, to: this.options.to };
  }

  protected transform(msm: Alignment, mpm: Mpm): void {
    this.fitted = undefined;
    const { scope, from, to } = this.options;
    const notes = msm.in(scope).notesInRange(from, to);
    if (notes.length === 0) {
      throw new Error(`FitDynamics: no note of this scope lies between ticks ${from} and ${to}`);
    }
    const chords = Map.groupBy(notes, (note) => note.date);
    const means = [...chords.values()].map(
      (chord) => chord.reduce((sum, note) => sum + note.velocity, 0) / chord.length,
    );
    const volume = means.reduce((a, b) => a + b, 0) / means.length;
    this.fitted = { volume, chords: means.length };
    new InsertDynamics({ scope, from, to: from, guides: new Map([[from, volume]]) }).run(msm, mpm);
  }
}

/**
 * The level assumed where no dynamics have been described: the median of what was played.
 *
 * One level for every gap, so that describing one passage does not redraw another.
 */
class AssumeLevel extends AbstractTransformer<ScopedTransformationOptions & { dates: number[] }> {
  readonly name = 'AssumeLevel';
  readonly requires = [];
  level?: number;

  constructor(options?: ScopedTransformationOptions & { dates: number[] }) {
    super(options ?? { scope: 'global', dates: [] });
  }

  range(): Range | undefined {
    return undefined;
  }

  override evidence(): string[] {
    return [];
  }

  protected transform(msm: Alignment, mpm: Mpm): void {
    const level = Math.round(median(msm.allNotes.map((note) => note.velocity)));
    this.level = level;
    for (const date of this.options.dates) {
      new InsertDynamics({
        scope: 'global',
        from: date,
        to: date,
        guides: new Map([[date, level]]),
      }).run(msm, mpm);
    }
  }
}

// A fitted step before the stated one of its kind, so that a number somebody gave is the one
// that stands; the level assumed before either, so that what a reader described is written over
// it. The tempo assumed in a gap is a `FitTempo` like any other, and takes its turn by its date.
registerTransformer(FitTempo, { before: 'InsertTempo' });
registerTransformer(AssumeLevel, { before: 'InsertDynamics' });
registerTransformer(FitDynamics, { before: 'InsertDynamics' });

// ---------------------------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------------------------

/** A call as a page hands it over: `Map`s and `Set`s in the envelopes the work file uses. */
export interface PlainCall {
  id: string;
  name: string;
  options: Record<string, unknown>;
}

const SYSTEM = new Set(['AssumeLevel']);
/** The stated call a step of this module comes to, for a transformer that requires one. */
const STANDS_FOR = new Map([
  ['FitTempo', 'InsertTempo'],
  ['AssumeLevel', 'InsertDynamics'],
  ['FitDynamics', 'InsertDynamics'],
]);

/**
 * Calls a description does not make, and why.
 *
 * The first four a chain makes for itself or made on the score before there was a chain. The
 * piece arrives with its base text chosen and its staves as its parts, so there is no take left
 * to choose between, and what the engine assumes is written for both hands.
 */
const NOT_FOR_A_READER = new Map<string, string>([
  ['AlignSource', 'the recording is already aligned'],
  ['InsertMetadata', 'the chain writes the metadata itself'],
  ['TranslatePhysicalTimeToTicks', 'the chain makes this call itself'],
  ['RoundNumbers', 'the chain makes this call itself'],
  ['MakeChoice', 'this roll has one take, and it is already chosen'],
  ['ProcessVoices', 'the parts are the two staves here, and stay so'],
  ...[...SYSTEM].map((name): [string, string] => [name, 'the engine makes this assumption itself']),
]);

/** Transformers that take a scope, which is the whole score where a call does not say. */
const SCOPED = new Set([
  'Modify',
  'InsertDynamicsGradient',
  'InsertTemporalSpread',
  'InsertTempo',
  'FitTempo',
  'InsertRubato',
  'CombineAdjacentRubatos',
  'InsertDynamics',
  'FitDynamics',
  'InsertMetricalAccentuation',
  'MergeMetricalAccentuations',
  'InsertArticulation',
  'MakeDefaultArticulation',
]);

/**
 * Maps a part of its own would hide the global one from, for that part: the tempo and the level
 * the engine assumes are global, so a part's map would be measured against nothing.
 */
const BOTH_HANDS = new Set([
  'InsertTempo',
  'FitTempo',
  'InsertRubato',
  'CombineAdjacentRubatos',
  'InsertDynamics',
  'FitDynamics',
  'InsertMetricalAccentuation',
  'MergeMetricalAccentuations',
]);

/** The options that have to be numbers for a call to mean anything. */
const NUMBERS: Record<string, string[]> = {
  InsertTempo: ['from', 'to', 'bpm', 'beatLength'],
  FitTempo: ['from', 'to', 'beatLength'],
  InsertRubato: ['date', 'length'],
  InsertDynamics: ['from', 'to'],
  FitDynamics: ['from', 'to'],
  InsertMetricalAccentuation: ['from', 'to', 'beatLength', 'scaleTolerance'],
  StylizeOrnamentation: ['tickTolerance', 'intensityTolerance', 'gradientTolerance'],
  CombineAdjacentRubatos: ['intensityTolerance', 'compressionTolerance'],
};

const STYLIZE = { tickTolerance: 8, intensityTolerance: 0.3, gradientTolerance: 0.1 };

/** A `Map` or a `Set` in the envelope a work file carries it in, from whatever shape it came in. */
const envelope = (value: unknown, dataType: 'Map' | 'Set'): unknown => {
  if (value && typeof value === 'object' && 'dataType' in value) return value;
  if (dataType === 'Set') return { dataType, value: Array.isArray(value) ? value : [] };
  if (Array.isArray(value)) return { dataType, value };
  if (value && typeof value === 'object') {
    return { dataType, value: Object.entries(value).map(([key, entry]) => [Number(key), entry]) };
  }
  return { dataType, value: [] };
};

/**
 * A call with what the editor would have filled in: the options a desk always writes and a
 * description never mentions. A transformer takes its options whole, so one left out is
 * `undefined` where it is read, and a tempo with no beat length is written with the word.
 *
 * @returns the call, or why it cannot be made.
 */
const complete = (call: PlainCall): PlainCall | string => {
  const options: Record<string, unknown> = { ...call.options };
  const { name } = call;

  if (SCOPED.has(name)) options['scope'] ??= 'global';
  if (BOTH_HANDS.has(name) && options['scope'] !== 'global') {
    return `${name} is written for both hands here: scope "global"`;
  }

  switch (name) {
    case 'InsertTemporalSpread':
      if (!('group' in options) && !('graces' in options)) {
        options['placement'] ??= 'estimate';
        options['noteOffShiftTolerance'] ??= 2;
        if (!('date' in options)) options['durationThreshold'] ??= 35;
      }
      break;
    case 'InsertDynamicsGradient':
      options['sortVelocities'] ??= true;
      if (!('date' in options)) {
        options['crescendo'] ??= { from: -1, to: 0 };
        options['decrescendo'] ??= { from: 0, to: -1 };
      }
      break;
    case 'InsertDynamics':
      options['guides'] = envelope(options['guides'], 'Map');
      break;
    case 'InsertPedal':
      if ('guides' in options) options['guides'] = envelope(options['guides'], 'Map');
      break;
    case 'InsertMetricalAccentuation':
      options['name'] ??= `pattern-${call.id}`;
      options['scaleTolerance'] ??= 0;
      options['neutralEnd'] ??= true;
      break;
    case 'InsertArticulation':
      options['name'] ??= `articulation-${call.id}`;
      options['aspects'] = envelope(options['aspects'] ?? ['relativeDuration'], 'Set');
      if (!Array.isArray(options['noteIDs']) || options['noteIDs'].length === 0) {
        return 'InsertArticulation needs the ids of its notes in "noteIDs"';
      }
      break;
    case 'FitTempo':
      options['beatLength'] ??= 0.25;
      options['shape'] ??= 'steady';
      break;
    case 'StylizeOrnamentation':
      for (const [key, value] of Object.entries(STYLIZE)) options[key] ??= value;
      break;
    case 'CombineAdjacentRubatos':
      options['intensityTolerance'] ??= 0.2;
      options['compressionTolerance'] ??= 0.2;
      break;
    case 'Modify':
      if (!['velocity', 'onset', 'duration'].includes(options['aspect'] as string)) {
        return 'Modify needs an "aspect": "velocity", "onset" or "duration"';
      }
      if (typeof options['change'] !== 'number' && !Array.isArray(options['points'])) {
        return 'Modify needs a "change" (a number) or "points"';
      }
      break;
  }

  for (const key of NUMBERS[name] ?? []) {
    if (typeof options[key] !== 'number' || !Number.isFinite(options[key])) {
      return `${name} needs a number for "${key}"`;
    }
  }
  return { ...call, options };
};

const substitute = (value: unknown, bindings: Record<string, number>): unknown => {
  if (typeof value === 'string' && value in bindings) return bindings[value];
  if (Array.isArray(value)) return value.map((entry) => substitute(entry, bindings));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, substitute(entry, bindings)]),
    );
  }
  return value;
};

interface Expanded {
  calls: PlainCall[];
  /** The call a page made, by the id of each call the chain runs for it. */
  origin: Map<string, string>;
  problems: { id: string; message: string }[];
}

/**
 * Write out what a page's calls stand for: a `Repeat` as one call per step, a `FitTempo` with a
 * `step` as one per step.
 */
const expand = (calls: readonly PlainCall[], piece: Alignment): Expanded => {
  const out: PlainCall[] = [];
  const origin = new Map<string, string>();
  const problems: { id: string; message: string }[] = [];

  const push = (parent: string, call: PlainCall) => {
    const refused = NOT_FOR_A_READER.get(call.name);
    if (refused !== undefined) {
      problems.push({ id: parent, message: `${call.name} is not a call a description makes: ${refused}` });
      return;
    }
    const completed = complete(call);
    if (typeof completed === 'string') {
      problems.push({ id: parent, message: completed });
      return;
    }
    out.push(completed);
    origin.set(call.id, parent);
  };

  const steps = (from: unknown, to: unknown, step: unknown): [number, number][] | string => {
    if (typeof from !== 'number' || typeof to !== 'number' || typeof step !== 'number') {
      return '"from", "to" and "step" have to be numbers, in ticks';
    }
    if (!(step > 0) || !(to > from)) return '"step" has to be positive and "to" after "from"';
    if ((to - from) / step > 400) return 'more than 400 steps';
    const spans: [number, number][] = [];
    for (let at = from; at < to - 1e-6; at += step) spans.push([at, Math.min(at + step, to)]);
    return spans;
  };

  for (const call of calls) {
    const options = call.options ?? {};
    if (call.name === 'Repeat') {
      const template = options['call'] as PlainCall | undefined;
      const spans = steps(options['from'], options['to'], options['step']);
      if (typeof spans === 'string' || !template || typeof template.name !== 'string') {
        problems.push({
          id: call.id,
          message: `Repeat: ${typeof spans === 'string' ? spans : 'no "call" to repeat'}`,
        });
        continue;
      }
      // A frame with one chord in it has nothing to redistribute. Repeated over a passage such
      // frames are passed over, a held note among the moving ones being no fault of the remark.
      const idle = ([from, to]: [number, number]) =>
        template.name === 'InsertRubato' && chordDates(piece).filter((date) => date >= from && date < to).length < 2;
      spans.forEach(([from, to], index) => {
        if (idle([from, to])) return;
        push(call.id, {
          id: `${call.id}~${index}`,
          name: template.name,
          options: substitute(template.options ?? {}, {
            $from: from,
            $to: to,
            $step: to - from,
            $index: index,
          }) as Record<string, unknown>,
        });
      });
    } else if (call.name === 'FitSpread') {
      // The rolled chords of a passage: `InsertTemporalSpread` takes one date or a whole scope,
      // and a remark about bars 5 to 8 is about neither.
      const { from, to } = options;
      const scope = (options['scope'] ?? 'global') as 'global' | number;
      const threshold = typeof options['durationThreshold'] === 'number' ? options['durationThreshold'] : 35;
      if (typeof from !== 'number' || typeof to !== 'number' || to < from) {
        problems.push({ id: call.id, message: 'FitSpread: "from" and "to" have to be ticks, "to" not before "from"' });
        continue;
      }
      const chords = Map.groupBy(
        piece.in(scope).notesInRange(from, to).filter((note) => Number.isFinite(note['milliseconds.date'])),
        (note) => note.date,
      );
      const rolled = [...chords.entries()]
        .filter(([, chord]) => {
          const onsets = chord.map((note) => note['milliseconds.date']);
          return chord.length > 1 && Math.max(...onsets) - Math.min(...onsets) > threshold;
        })
        .map(([date]) => date)
        .sort((a, b) => a - b);
      if (rolled.length === 0) {
        problems.push({
          id: call.id,
          message: `FitSpread: no chord between ticks ${from} and ${to} is spread wider than ${threshold} ms`,
        });
        continue;
      }
      rolled.forEach((date, index) => {
        push(call.id, {
          id: `${call.id}~${index}`,
          name: 'InsertTemporalSpread',
          options: { scope, placement: options['placement'] ?? 'estimate', noteOffShiftTolerance: 2, date },
        });
      });
    } else if (call.name === 'FitTempo' && options['step'] !== undefined) {
      const { step, ...rest } = options;
      const spans = steps(options['from'], options['to'], step);
      if (typeof spans === 'string') {
        problems.push({ id: call.id, message: `FitTempo: ${spans}` });
        continue;
      }
      // A tempo is read off the chords at the two ends of its span, so each cut is made on the
      // chord nearest the step, and a step with no chord near it is not cut at all: "every half
      // bar" over a half note held into the next is one tempo up to where the next thing sounds.
      const sounding = chordDates(piece);
      const [first] = spans[0]!;
      const [, last] = spans[spans.length - 1]!;
      const reach = (step as number) / 2;
      const cuts = new Set<number>();
      for (const [at] of spans.slice(1)) {
        const near = sounding
          .filter((date) => date > first && date < last && Math.abs(date - at) < reach)
          .sort((a, b) => Math.abs(a - at) - Math.abs(b - at) || b - a)[0];
        if (near !== undefined) cuts.add(near);
      }
      const edges = [first, ...[...cuts].sort((a, b) => a - b), last];
      const merged: [number, number][] = [];
      for (let i = 0; i + 1 < edges.length; i++) merged.push([edges[i]!, edges[i + 1]!]);
      // The tail after the last chord has nothing to read either, and belongs to the span before.
      const final = merged[merged.length - 1];
      if (merged.length > 1 && final && !sounding.some((date) => date > final[0] && date <= final[1])) {
        merged.pop();
        merged[merged.length - 1]![1] = final[1];
      }
      merged.forEach(([from, to], index) => {
        push(call.id, { id: `${call.id}~${index}`, name: 'FitTempo', options: { ...rest, from, to } });
      });
    } else {
      push(call.id, call);
    }
  }
  return { calls: out, origin, problems };
};

const TEMPO = new Set(['FitTempo', 'InsertTempo']);
const DYNAMICS = new Set(['FitDynamics', 'InsertDynamics']);
const ROLLS = new Set(['InsertTemporalSpread', 'InsertDynamicsGradient']);

/**
 * Let what was said later stand where two remarks speak of the same place.
 *
 * The chain orders calls of one transformer by where they start, not by when they were made, and
 * each transformer settles an overlap its own way: a tempo cuts into the one before it, a second
 * roll on a chord measures the chord the first has already collapsed. Somebody describing a piece
 * bit by bit expects neither. They say "steady by the bar" and later, of two of those bars,
 * "broadening": the second remark is about those two bars, and the first is still about the rest.
 *
 * So, in the order the remarks were made: a tempo or a dynamics span takes its ticks out of every
 * earlier one, which is refitted over what it has left; a rubato frame replaces the earlier
 * frames it overlaps; a roll or a ramp on one chord replaces an earlier one on that chord. And a
 * call on one chord goes before a call over all of them, which then finds that chord done.
 */
const settle = (calls: PlainCall[], origin: Map<string, string>): PlainCall[] => {
  const out: PlainCall[] = [];
  const numbers = (call: PlainCall, a: string, b: string): [number, number] => [
    call.options[a] as number,
    call.options[b] as number,
  ];

  const carve = (family: Set<string>, from: number, to: number) => {
    for (let i = out.length - 1; i >= 0; i--) {
      const earlier = out[i]!;
      if (!family.has(earlier.name)) continue;
      const [start, end] = numbers(earlier, 'from', 'to');
      if (end <= from || start >= to) continue;
      const left: PlainCall[] = [];
      if (start < from) left.push({ ...earlier, options: { ...earlier.options, to: from } });
      // A stated tempo is a line from its start; what would be left of it after the cut is not.
      if (end > to && earlier.name !== 'InsertTempo') {
        const rest = { ...earlier, id: `${earlier.id}'`, options: { ...earlier.options, from: to } };
        origin.set(rest.id, origin.get(earlier.id) ?? earlier.id);
        left.push(rest);
      }
      out.splice(i, 1, ...left);
    }
  };

  for (const call of calls) {
    const { options } = call;
    if (TEMPO.has(call.name) || DYNAMICS.has(call.name)) {
      const [from, to] = numbers(call, 'from', 'to');
      // A level stated on one date is a point, and takes nothing out of a span it stands in.
      if (to > from) carve(TEMPO.has(call.name) ? TEMPO : DYNAMICS, from, to);
    } else if (call.name === 'InsertRubato') {
      const [date, length] = numbers(call, 'date', 'length');
      for (let i = out.length - 1; i >= 0; i--) {
        const earlier = out[i]!;
        if (earlier.name !== 'InsertRubato') continue;
        const [start, span] = numbers(earlier, 'date', 'length');
        if (start < date + length && start + span > date) out.splice(i, 1);
      }
    } else if (ROLLS.has(call.name) && typeof options['date'] === 'number') {
      for (let i = out.length - 1; i >= 0; i--) {
        const earlier = out[i]!;
        if (
          earlier.name === call.name &&
          earlier.options['date'] === options['date'] &&
          earlier.options['scope'] === options['scope']
        ) {
          out.splice(i, 1);
        }
      }
    }
    out.push(call);
  }

  const onOneChord = (call: PlainCall) => ROLLS.has(call.name) && typeof call.options['date'] === 'number';
  return [...out.filter(onOneChord), ...out.filter((call) => !onOneChord(call))];
};

/** The dates of the score a chord sounds on, ascending. */
const chordDates = (piece: Alignment): number[] =>
  [
    ...new Set(
      piece
        .in('global')
        .notes()
        .filter((note) => Number.isFinite(note['milliseconds.date']))
        .map((note) => note.date),
    ),
  ].sort((a, b) => a - b);

/** The stretches of `[start, end)` that no span covers. */
const gaps = (spans: [number, number][], start: number, end: number): Range[] => {
  const sorted = spans
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);
  const free: Range[] = [];
  let cursor = start;
  for (const [from, to] of sorted) {
    if (from > cursor) free.push({ from: cursor, to: Math.min(from, end) });
    cursor = Math.max(cursor, to);
    if (cursor >= end) break;
  }
  if (cursor < end) free.push({ from: cursor, to: end });
  return free;
};

const spanOf = (call: PlainCall): [number, number] | undefined => {
  const { from, to, scope } = call.options;
  if (typeof from !== 'number' || typeof to !== 'number') return undefined;
  if (scope !== undefined && scope !== 'global') return undefined;
  return [from, to];
};

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

export interface PieceData {
  title: string;
  alignment: AlignmentData;
}

/** One note of the roll: what was played, and what of it nothing has explained yet. */
export interface RollNote {
  id: string;
  part: number;
  pitch: number;
  /** Where the score has it, and for how long, in ticks. */
  date: number;
  duration: number;
  /** What was played: onset and release in ms from the first note, and the velocity. */
  ms: number;
  msEnd: number;
  velocity: number;
  /** Where the onset falls on the score grid under the tempo as it stands, in ticks. */
  x: number;
  /** How long it sounds on that grid, less what its articulation accounts for. */
  w: number;
  /** The velocity left once what the document sounds it at is taken off, about the level. */
  v: number;
  /** The three remainders themselves: onset in ms, length in ticks and in ms, velocity. */
  late: number;
  long: number;
  longMs: number;
  loud: number;
  /**
   * The note as it was played, on the grid as it now stands: where its recorded onset falls
   * under the tempo in force, how long it sounded there, and its velocity about the level.
   *
   * What a shadow is drawn from, and it is in the roll's own measure on purpose. A tempo is not
   * something taken out of a note but the ruler the notes are laid against, so describing one
   * moves a note and its shadow alike; they part only by what a remark took out of the note
   * itself, the stagger of a roll, the give of a rubato, a correction of the recording.
   */
  played: { x: number; w: number; loud: number };
}

export interface CallReport {
  /** The call the page made. */
  id: string;
  /** The MPM elements it is answerable for. */
  elements: string[];
  /** Those elements as they stand in the document: each one's start tag, one for one. */
  written: string[];
  /** The definitions those elements name, whole: where an ornament or an articulation keeps its numbers. */
  definitions: string[];
  /** The notes it was fitted to. */
  evidence: string[];
  range: { from: number; to: number | null } | null;
  /** Why it did not run, where it did not. */
  error?: string;
  /** What a fitted step read off the recording. */
  fitted?: Record<string, unknown>[];
  /** The calls the editor would hold for it, numbers stated. */
  concrete: PlainCall[];
}

export interface RunResult {
  mpm: string;
  notes: RollNote[];
  calls: CallReport[];
  /** What was assumed where nothing was described. */
  assumed: { tempo: { from: number; to: number; bpm: number }[]; level: number | null; levelDates: number[] };
  /** The grace notes, which the score gives no time: where each was played. */
  graces: { id: string; group: string; principal: string; pitch: number; x: number; velocity: number }[];
  /** The level a velocity is drawn about. */
  level: number;
  end: number;
  timeSignatures: AlignmentData['timeSignatures'];
  chainMs: number;
  problems: string[];
}

let pristine: Alignment | null = null;

/** Take a piece in. The alignment is kept as it arrived and cloned for every run. */
export const load = (piece: PieceData): { notes: number; end: number } => {
  const { alignment } = piece;
  pristine = new Alignment(alignment.allNotes, alignment.timeSignatures);
  pristine.pedals = alignment.pedals;
  pristine.graces = alignment.graces;
  pristine.tiedPrincipals = alignment.tiedPrincipals;
  return { notes: pristine.allNotes.length, end: pristine.end };
};

/** Give the options their `Map`s and `Set`s back, the way a work file is read. */
const revive = (calls: PlainCall[]): Call[] =>
  parseWorkFile(JSON.stringify({ name: '', mei: '', mpm: '', provenance: calls })).provenance;

const msPerTickAt = (segments: PlacedTempo[], date: number): number => {
  const segment =
    segments.find((s) => date >= s.tempo.date && (s.nextDate === undefined || date < s.nextDate)) ??
    segments[0];
  if (!segment) return 1;
  const bpm = getTempoAt(Math.min(Math.max(date, segment.tempo.date), segment.tempo.endDate), segment.tempo);
  return 60000 / (bpm * WHOLE * segment.tempo.beatLength);
};

const silently = <T>(work: () => T): T => {
  const { log, warn, error } = console;
  console.log = console.warn = console.error = () => undefined;
  try {
    return work();
  } finally {
    Object.assign(console, { log, warn, error });
  }
};

/**
 * Run a list of calls over the piece and say what is left.
 *
 * A call that throws is left out and reported, and the rest still run: one remark that could not
 * be fitted is no reason to lose the picture the others drew.
 */
export const run = (userCalls: readonly PlainCall[]): RunResult => {
  if (!pristine) throw new Error('no piece loaded');
  const alignment = pristine.deepClone();
  clearResidualCache();

  // The chain sets its clock to the first onset as it stands when the first tempo is written.
  // How far that moved the recording is kept, to say where a note as it arrived falls.
  let shifted = 0;
  const shiftToFirstOnset = alignment.shiftToFirstOnset.bind(alignment);
  alignment.shiftToFirstOnset = () => {
    const earliest = alignment.allNotes.reduce(
      (min, note) => (Number.isFinite(note['milliseconds.date']) ? Math.min(min, note['milliseconds.date']) : min),
      Infinity,
    );
    if (Number.isFinite(earliest)) shifted += earliest;
    shiftToFirstOnset();
  };

  const { calls: written, origin, problems } = expand(userCalls, alignment);
  const expanded = settle(written, origin);
  const failed = new Map<string, string>(problems.map((p) => [p.id, p.message]));

  // What has been described, and so what is left to assume.
  const end = alignment.end;
  const tempoSpans = expanded
    .filter((call) => call.name === 'InsertTempo' || call.name === 'FitTempo')
    .map(spanOf)
    .filter((span): span is [number, number] => span !== undefined);
  const dynamicsSpans = expanded
    .filter((call) => call.name === 'InsertDynamics' || call.name === 'FitDynamics')
    .map(spanOf)
    .filter((span): span is [number, number] => span !== undefined);

  // A dynamics span takes in the chord on its last date, so a gap begins on the chord after it.
  const dates = [...new Set(alignment.allNotes.map((note) => note.date))].sort((a, b) => a - b);
  const described = (date: number) => dynamicsSpans.some(([from, to]) => date >= from && date <= to);
  const levelDates = dates.filter(
    (date, index) => !described(date) && (index === 0 || described(dates[index - 1]!)),
  );

  const system: PlainCall[] = [
    ...gaps(tempoSpans, 0, end).map((gap, index) => ({
      id: `assume-tempo-${index}`,
      name: 'FitTempo',
      options: { scope: 'global', from: gap.from, to: gap.to, beatLength: 0.25, shape: 'steady', assumed: true },
    })),
    { id: 'assume-level', name: 'AssumeLevel', options: { scope: 'global', dates: levelDates } },
  ];
  // An ornament sounds only through a definition, and one call gives every ornament its own. It
  // is no part of what anybody described, so the engine makes it wherever there is an ornament.
  const ornaments = expanded.some(
    (call) => call.name === 'InsertTemporalSpread' || call.name === 'InsertDynamicsGradient',
  );
  if (ornaments && !expanded.some((call) => call.name === 'StylizeOrnamentation')) {
    system.push({ id: 'stylize-ornaments', name: 'StylizeOrnamentation', options: { ...STYLIZE } });
  }

  const mpm = createMpm();
  const startedAt = Date.now();
  let transformers: Transformer[] = [];
  const messages: string[] = [];

  silently(() => {
    const built = buildChain(revive([...system, ...expanded]));
    for (const call of built.unknown) {
      failed.set(origin.get(call.id) ?? call.id, `There is no transformer called ${call.name}`);
    }
    // A call whose requirement nothing meets is left out, with what it would have needed. What
    // the engine assumes, and a fitted step, stand for the stated call they come to.
    let chain = built.transformers;
    const done = new Set<string>();
    for (const transformer of chain) {
      for (const Required of transformer.requires) {
        const needed = new Required().name;
        if (done.has(needed)) continue;
        failed.set(
          origin.get(transformer.id) ?? transformer.id,
          `${transformer.name} needs a ${needed} before it, and nothing described so far makes one`,
        );
      }
      done.add(STANDS_FOR.get(transformer.name) ?? transformer.name);
    }
    chain = chain.filter((t) => !failed.has(origin.get(t.id) ?? t.id));

    for (const transformer of chain) {
      try {
        transformer.run(alignment, mpm);
      } catch (thrown) {
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        const parent = origin.get(transformer.id);
        if (parent) failed.set(parent, message);
        else messages.push(`${transformer.name}: ${message}`);
      }
    }
    transformers = chain;
  });
  const chainMs = Date.now() - startedAt;

  // Where everything fell, and what it is sounded at.
  const residual = silently(() => deriveResidual(alignment, mpm));
  const segments = silently(() => placeTempos(alignment, mpm, 'global'));

  // The lengths the document gives the notes, which is where an articulation shows. Asked of the
  // articulations alone: with no tempo in the document a tick lasts a millisecond, so what comes
  // back is the length in ticks, and no bend of the tempo has to be taken out of it again.
  const rendered = new Map<string, number>();
  silently(() => {
    const score = alignment.serializeScore();
    if (!score) return;
    const probe = withoutMaps(mpm, ['tempo', 'rubato', 'ornament']);
    const data = performMsmToData({ msm: score, mpm: exportMPM(probe) }, { expandOrnaments: false, seed: 1 });
    for (const part of data.parts) {
      for (const note of part.notes) {
        if (note.id !== null) rendered.set(note.id, note.milliseconds.end - note.milliseconds.date);
      }
    }
  });

  const assumeLevel = transformers.find((t): t is AssumeLevel => t instanceof AssumeLevel);
  const assumedTempo = transformers
    .filter((t): t is FitTempo => t instanceof FitTempo && t.options.assumed === true && !!t.fitted)
    .map((t) => ({ from: t.options.from, to: t.options.to, bpm: (t.fitted as InsertTempoOptions).bpm }));
  const level = assumeLevel?.level ?? Math.round(median(alignment.allNotes.map((n) => n.velocity)));

  // The recording as it arrived, on the clock the chain moved it to.
  const first = pristine.allNotes.reduce(
    (min, note) => Math.min(min, note['milliseconds.date']),
    Infinity,
  );
  const arrived = new Map(pristine.allNotes.map((note) => [note['xml:id'], note]));

  const notes: RollNote[] = residual.notes.map(({ note, tickDate, tickDuration, velocity }) => {
    const original = arrived.get(note['xml:id']) as AlignedNote;
    const perTick = msPerTickAt(segments, note.date);
    const x = tickDate ?? note.date;
    const sounded = tickDuration ?? note.duration;
    const explained = rendered.get(note['xml:id']) ?? note.duration;
    const long = sounded - explained;
    // In ms, against how long the tempo map makes those ticks last from the note's place on.
    const begins = renderedMsAt(segments, note.date);
    const ends = renderedMsAt(segments, note.date + explained);
    const longMs =
      begins === undefined || ends === undefined
        ? long * perTick
        : note['milliseconds.date.end'] - note['milliseconds.date'] - (ends - begins);
    const loud = velocity ?? 0;
    const late = (x - note.date) * perTick;

    // The same note as it arrived, placed as the tempo walk places one: its onset under the
    // tempo governing its date, its release under the one in force when the key came up.
    const governing = segments.find((segment) => coversDate(segment, note.date)) ?? segments[0];
    const releasing = segmentAtMs(segments, original['milliseconds.date.end'] - shifted);
    const struck = governing
      ? dateAtMilliseconds(original['milliseconds.date'] - shifted - governing.startMs, governing.resolved)
      : NaN;
    const released = releasing
      ? dateAtMilliseconds(original['milliseconds.date.end'] - shifted - releasing.startMs, releasing.resolved)
      : NaN;
    const played = {
      x: Number.isFinite(struck) ? struck : x,
      w: Number.isFinite(struck) && Number.isFinite(released) ? Math.max(released - struck, 12) : sounded,
      loud: original.velocity - level,
    };
    return {
      id: note['xml:id'],
      part: note.part,
      pitch: note['midi.pitch'],
      date: note.date,
      duration: note.duration,
      ms: original['milliseconds.date'] - first,
      msEnd: original['milliseconds.date.end'] - first,
      velocity: original.velocity,
      x,
      w: Math.max(note.duration + long, 12),
      v: level + loud,
      late,
      long,
      longMs,
      loud,
      played,
    };
  });

  // A grace note has no date of its own, so it is drawn as far from its principal as it was
  // played from it.
  const drawn = new Map(notes.map((note) => [note.id, note]));
  const sounded = new Map(alignment.allNotes.map((note) => [note['xml:id'], note]));
  const graces = alignment.graces.map((grace) => {
    const principal = drawn.get(grace.principal);
    const ground = sounded.get(grace.principal);
    const ahead =
      principal && ground
        ? (grace['milliseconds.date'] - ground['milliseconds.date']) / msPerTickAt(segments, grace.date)
        : -PPQ / 8;
    return {
      id: grace['xml:id'],
      group: grace.group,
      principal: grace.principal,
      pitch: grace['midi.pitch'],
      x: (principal?.x ?? grace.date) + ahead,
      velocity: grace.velocity,
    };
  });

  // What each call of the page came to.
  const reports = new Map<string, CallReport>(
    userCalls.map((call) => [
      call.id,
      { id: call.id, elements: [], written: [], definitions: [], evidence: [], range: null, concrete: [], fitted: [] },
    ]),
  );
  for (const [id, message] of failed) {
    const report = reports.get(id);
    if (report) report.error = message;
    else messages.push(message);
  }
  for (const transformer of transformers) {
    const parent = origin.get(transformer.id);
    const report = parent ? reports.get(parent) : undefined;
    if (!report) continue;
    report.elements.push(...transformer.created);
    silently(() => {
      try {
        report.evidence.push(...transformer.evidence(alignment, residual));
        const range = transformer.range(alignment, residual);
        if (range) {
          const to = range.to ?? range.from;
          report.range = report.range
            ? { from: Math.min(report.range.from, range.from), to: Math.max(report.range.to ?? 0, to) }
            : { from: range.from, to };
        }
      } catch {
        // A range that cannot be told is no reason to lose the report.
      }
    });
    if (transformer instanceof FitTempo && transformer.fitted) {
      const { rmsMs, onsets, ...options } = transformer.fitted;
      report.fitted?.push({ ...options, rmsMs, onsets });
      report.concrete.push({ id: transformer.id, name: 'InsertTempo', options: { ...options } });
    } else if (transformer instanceof FitDynamics && transformer.fitted) {
      const { from } = transformer.options;
      report.fitted?.push({ ...transformer.options, ...transformer.fitted });
      report.concrete.push({
        id: transformer.id,
        name: 'InsertDynamics',
        options: {
          scope: transformer.options.scope,
          from,
          to: from,
          guides: { dataType: 'Map', value: [[from, transformer.fitted.volume]] },
        },
      });
    } else {
      const source = expanded.find((call) => call.id === transformer.id);
      if (source) report.concrete.push(source);
    }
  }
  // The elements themselves, so that a reader of the report sees the numbers a fit came to. An
  // ornament, an articulation and an accentuation pattern keep theirs in the definition they
  // name, so that is written out with them.
  const xml = exportMPM(mpm);
  const tags = new Map<string, string>();
  for (const [tag, , id] of xml.matchAll(/<[\w.:-]+(\s+[\w.:-]+="[^"]*")*?\s+xml:id="([^"]+)"[^>]*>/g)) {
    tags.set(id!, tag);
  }
  const definitions = new Map<string, string>();
  for (const [definition, , name] of xml.matchAll(
    /<((?!style)\w+Def)\b[^>]*?\sname="([^"]+)"[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g,
  )) {
    definitions.set(name!, definition);
  }
  const definedBy = (written: string[]): string[] => {
    const named = new Set<string>();
    for (const tag of written) {
      const name = /\sname\.ref="([^"]+)"/.exec(tag)?.[1];
      if (name !== undefined && definitions.has(name)) named.add(definitions.get(name)!);
    }
    return [...named];
  };

  // A call over every chord names no place, so it has no evidence of its own to give; what it
  // was fitted to is the chords it wrote an ornament on.
  const onDate = Map.groupBy(alignment.allNotes, (note) => note.date);
  for (const report of reports.values()) {
    report.elements = [...new Set(report.elements)];
    // One for one with the elements: an element a later call removed again has an empty place.
    report.written = report.elements.map((id) => tags.get(id) ?? '');
    report.definitions = definedBy(report.written);
    if (report.evidence.length === 0) {
      for (const element of report.elements) {
        const dated = /^ornament_(\d+(?:\.\d+)?)/.exec(element);
        if (!dated) continue;
        for (const note of onDate.get(Number(dated[1])) ?? []) report.evidence.push(note['xml:id']);
      }
    }
    report.evidence = [...new Set(report.evidence)];
  }

  return {
    mpm: xml,
    notes,
    graces,
    calls: [...reports.values()],
    assumed: {
      tempo: assumedTempo,
      level: assumeLevel?.level ?? null,
      levelDates,
    },
    level,
    end,
    timeSignatures: alignment.timeSignatures,
    chainMs,
    problems: messages,
  };
};
