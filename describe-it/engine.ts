/**
 * DescribeIt's engine: runs the MPM Desk fitting chain on a list of calls and reports the residual.
 * DOM-free; bundled for the browser by `build.ts`.
 */
import { exaggerateMpm, performMsmToData, spotlightMpm } from 'espressivo';
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
import { Describe, type DescribeOptions } from '../src/fitting/transformers/description/Describe';
import {
  coversDate,
  placeTempos,
} from '../src/fitting/transformers/tempo/placedTempos';
import {
  millisecondsAt,
  resolveSpan,
} from '../src/fitting/transformers/tempo/tempoCalculations';
import { createMpm, exportMPM, type Mpm } from '../src/fitting/instructions/index';
import { clearResidualCache, deriveResidual, type Residual } from '../src/fitting/residual';
import { Alignment, type AlignedNote } from '../src/fitting/alignment';
import type { Range } from '../src/fitting/transformers/range';
import { parseWorkFile, type Call } from '../src/model/Work';
import type { AlignmentData } from '../src/fitting/fit.worker';

const PPQ = 720;
const WHOLE = PPQ * 4;

// ---------------------------------------------------------------------------------------------
// Recorded onsets
// ---------------------------------------------------------------------------------------------

/** Score date (ticks) -> recorded onset (ms) of the first note on it. */
const anchorsOf = (msm: Alignment): Map<number, number> => {
  const anchors = new Map<number, number>();
  for (const note of msm.in('global').notes()) {
    if (!anchors.has(note.date) && Number.isFinite(note['milliseconds.date'])) {
      anchors.set(note.date, note['milliseconds.date']);
    }
  }
  return anchors;
};

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
// Tempo fitting
// ---------------------------------------------------------------------------------------------

interface FittedTempo {
  bpm: number;
  transitionTo?: number;
  meanTempoAt?: number;
  /** RMS distance of the fit from the onsets. */
  rmsMs: number;
  /** Number of chords fitted to. */
  onsets: number;
}

/** A score date (ticks) and when it sounded (ms). */
interface Moment {
  date: number;
  ms: number;
}

/** Constant tempo from `start` at which the last of `chords` (ascending) falls where it was played. */
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
 * Tempo transition fitted to `chords`, arriving at `end` (ticks). Searches `transitionTo / bpm`
 * and `meanTempoAt`; `bpm` then follows from the last chord falling where it was played.
 */
const movingTempo = (
  start: Moment,
  chords: Moment[],
  end: number,
  beatLength: number,
): FittedTempo | undefined => {
  const steady = steadyTempo(start, chords, beatLength);
  const last = chords[chords.length - 1];
  // Two extra parameters need at least three chords.
  if (!steady || !last || chords.length < 3) return steady;

  const played = last.ms - start.ms;
  const errorOf = (ratio: number, meanTempoAt: number) => {
    // Probe at 60 bpm: scaling both tempo ends scales the times inversely.
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
  // Coarse grid over ratios 0.5 to 2, then a finer one around the best.
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
  // Steady unless the tempo changes by 3% or more and the RMS improves by 15% or more.
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
  /** In ticks. */
  from: number;
  /** In ticks, exclusive; a chord on it is still fitted to. */
  to: number;
  /** As a fraction of a whole note. */
  beatLength: number;
  shape: 'steady' | 'transition';
  /** Set by the engine for spans without a described tempo. */
  assumed?: boolean;
}

/**
 * `InsertTempo` with the tempo fitted to the recorded onsets. Calls must run in score order: a
 * span that does not start on a chord is measured from where the preceding tempo ends.
 */
export class FitTempo extends AbstractTransformer<FitTempoOptions> {
  readonly name = 'FitTempo';
  readonly requires = [];
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
      // An assumed span without chords still needs a tempo, to end the preceding one.
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

    // A transition needs a following tempo to arrive at; at the score's end it stops at the last
    // chord and a constant tempo follows.
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

  /** When the span's first tick sounds: its chord's onset, else where the preceding tempo puts it. */
  private startOf(msm: Alignment, mpm: Mpm, anchors: Map<number, number>): Moment | undefined {
    const { scope, from, to } = this.options;
    const onset = anchors.get(from);
    if (onset !== undefined) return { date: from, ms: onset };

    const segment = placeTempos(msm, mpm, scope).findLast((placed) => placed.tempo.date <= from);
    if (segment) {
      const ms = segment.startMs + millisecondsAt(from, segment.resolved);
      if (Number.isFinite(ms)) return { date: from, ms };
    }
    const first = chordsBetween(anchors, from, to)[0];
    return first;
  }
}

export interface FitDynamicsOptions extends ScopedTransformationOptions {
  from: number;
  to: number;
}

/** Constant dynamics over a span: the mean of its chords' velocities. */
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

/** Dynamics assumed where none are described: the median velocity, the same in every gap. */
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

// Order matters: explicit calls run after fitted ones and so win; the assumed level runs first.
registerTransformer(FitTempo, { before: 'InsertTempo' });
registerTransformer(AssumeLevel, { before: 'InsertDynamics' });
registerTransformer(FitDynamics, { before: 'InsertDynamics' });

// ---------------------------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------------------------

/** A call in JSON form: `Map`s and `Set`s serialized as in the work file. */
export interface PlainCall {
  id: string;
  name: string;
  options: Record<string, unknown>;
}

/** The Desk's step for a remark and the calls made from it. It writes nothing, so it is kept out of the run. */
const DESCRIBE = new Describe().name;

const SYSTEM = new Set(['AssumeLevel']);
/** The built-in transformer each of these runs, which is what satisfies a `requires`. */
const STANDS_FOR = new Map([
  ['FitTempo', 'InsertTempo'],
  ['AssumeLevel', 'InsertDynamics'],
  ['FitDynamics', 'InsertDynamics'],
]);

/** Calls that are rejected, with the reason reported. */
const NOT_FOR_A_READER = new Map<string, string>([
  ['AlignSource', 'the recording is already aligned'],
  ['InsertMetadata', 'the chain writes the metadata itself'],
  ['TranslatePhysicalTimeToTicks', 'the chain makes this call itself'],
  ['RoundNumbers', 'the chain makes this call itself'],
  ['MakeChoice', 'this roll has one take, and it is already chosen'],
  ['ProcessVoices', 'the parts are the two staves here, and stay so'],
  ...[...SYSTEM].map((name): [string, string] => [name, 'the engine makes this assumption itself']),
]);

/** Transformers whose `scope` defaults to `'global'`. */
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

/** Global scope only: a part's own map would hide the global one. */
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

/** Options that must be finite numbers. */
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

/** Converts an array or plain object to the work file's serialized `Map`/`Set` form. */
const envelope = (value: unknown, dataType: 'Map' | 'Set'): unknown => {
  if (value && typeof value === 'object' && 'dataType' in value) return value;
  if (dataType === 'Set') return { dataType, value: Array.isArray(value) ? value : [] };
  if (Array.isArray(value)) return { dataType, value };
  if (value && typeof value === 'object') {
    return { dataType, value: Object.entries(value).map(([key, entry]) => [Number(key), entry]) };
  }
  return { dataType, value: [] };
};

/** Fills in default options and validates a call; returns the call or an error message. */
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
  /** Expanded call id -> id of the call it came from. */
  origin: Map<string, string>;
  problems: { id: string; message: string }[];
}

/** Expands `Repeat`, `FitSpread` and stepped `FitTempo` calls into the calls the chain runs. */
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
      // A rubato frame needs at least two chords.
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
      // `InsertTemporalSpread` takes one date or a whole scope: make one call per spread chord.
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
      // A tempo is fitted between chords: cut on the chord nearest each step (within half a
      // step), and not at all where there is none.
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
      // Merge a last span without chords into the one before.
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
 * Resolves overlaps so that the later call wins: a tempo or dynamics span is cut out of earlier
 * ones, a rubato replaces those it overlaps, a spread or gradient replaces an earlier one on the
 * same chord. Single-chord calls are moved ahead of whole-scope ones.
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
      // An `InsertTempo` is defined from its start, so its part after the cut is dropped.
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
      // A zero-length span cuts nothing.
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

/** Score dates (ticks) with a recorded chord, ascending. */
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

/** The parts of `[start, end)` that no span covers. */
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
// Running the chain
// ---------------------------------------------------------------------------------------------

export interface PieceData {
  title: string;
  alignment: AlignmentData;
}

/** Times in ms from the first note. */
export interface Sounded {
  ms: number;
  msEnd: number;
  velocity: number;
}

/**
 * One note as recorded and as the MPM renders it (`mpm`), on the recording's clock. The rendering
 * is re-anchored on the recorded onset wherever a tempo begins on a chord.
 */
export interface RollNote extends Sounded {
  id: string;
  part: number;
  pitch: number;
  /** In ticks. */
  date: number;
  duration: number;
  /** The uncorrected recording, where a `Modify` call changed the note. */
  arrived?: Sounded;
  mpm: Sounded;
  /** Recorded minus rendered: onset (ms), length (ms), velocity. */
  late: number;
  longMs: number;
  loud: number;
}

export interface CallReport {
  id: string;
  /** Ids of the MPM elements the call produced. */
  elements: string[];
  /** The start tag of each element, parallel to `elements`. */
  written: string[];
  /** The definitions those elements reference. */
  definitions: string[];
  /** Ids of the notes the call was fitted to. */
  evidence: string[];
  range: { from: number; to: number | null } | null;
  error?: string;
  /** What `FitTempo`/`FitDynamics` fitted. */
  fitted?: Record<string, unknown>[];
  /** The equivalent calls with explicit numbers. */
  concrete: PlainCall[];
}

type PedalKind = 'sustain' | 'soft';

export interface RunResult {
  mpm: string;
  notes: RollNote[];
  calls: CallReport[];
  /** What was assumed for undescribed spans. */
  assumed: { tempo: { from: number; to: number; bpm: number }[]; level: number | null; levelDates: number[] };
  /** Grace notes as recorded; the score gives them no date. */
  graces: { id: string; group: string; principal: string; pitch: number; ms: number; velocity: number }[];
  /** Pedals as recorded and as rendered, on the recording's clock; `value` is 0-127. */
  pedals: {
    played: { kind: PedalKind; ms: number; msEnd: number }[];
    mpm: { kind: PedalKind; ms: number; value: number }[];
  };
  /** Score beats on the recording's clock, placed by the tempo map. */
  beats: { date: number; ms: number }[];
  /** All steps in MPM Desk form, fitted steps as explicit calls. */
  record: PlainCall[];
  /** The assumed dynamics level (velocity). */
  level: number;
  end: number;
  timeSignatures: AlignmentData['timeSignatures'];
  chainMs: number;
  problems: string[];
}

let pristine: Alignment | null = null;

const RUNS_KEPT = 6;
/** MPM of a recent run -> the score (MSM) it was rendered with, oldest first. */
const scores = new Map<string, string>();

const keep = (mpm: string, score: string) => {
  scores.delete(mpm);
  scores.set(mpm, score);
  if (scores.size > RUNS_KEPT) scores.delete(scores.keys().next().value!);
};

/** Loads a piece; its alignment is cloned for every run. */
export const load = (piece: PieceData): { notes: number; end: number } => {
  const { alignment } = piece;
  pristine = new Alignment(alignment.allNotes, alignment.timeSignatures);
  pristine.pedals = alignment.pedals;
  pristine.graces = alignment.graces;
  pristine.tiedPrincipals = alignment.tiedPrincipals;
  scores.clear();
  return { notes: pristine.allNotes.length, end: pristine.end };
};

/** Restores `Map`s and `Set`s in plain calls through the work file parser. */
const revive = (calls: PlainCall[]): Call[] =>
  parseWorkFile(JSON.stringify({ name: '', mei: '', mpm: '', provenance: calls })).provenance;

const silently = <T>(work: () => T): T => {
  const { log, warn, error } = console;
  console.log = console.warn = console.error = () => undefined;
  try {
    return work();
  } finally {
    Object.assign(console, { log, warn, error });
  }
};

/** `mpm` as the renderer performs `score`, on the renderer's own clock. */
const perform = (score: string, mpm: string) =>
  silently(() => {
    const notes: ({ id: string } & Sounded)[] = [];
    const pedals: { kind: PedalKind; date: number; ms: number; value: number }[] = [];
    const data = performMsmToData({ msm: score, mpm }, { expandOrnaments: false, seed: 1 });
    for (const part of data.parts) {
      for (const note of part.notes) {
        if (note.id === null) continue;
        notes.push({ id: note.id, ms: note.milliseconds.date, msEnd: note.milliseconds.end, velocity: note.velocity });
      }
      for (const stream of part.controlChanges) {
        const kind = stream.controller;
        if (kind !== 'sustain' && kind !== 'soft') continue;
        for (const point of stream.points) {
          pedals.push({ kind, date: point.date, ms: point.milliseconds, value: point.value });
        }
      }
    }
    return { notes, pedals };
  });

/** Runs the calls on the loaded piece. A failing call is skipped and reported; the rest still run. */
export const run = (steps: readonly PlainCall[]): RunResult => {
  if (!pristine) throw new Error('no piece loaded');
  const userCalls = steps.filter((step) => step.name !== DESCRIBE);
  const alignment = pristine.deepClone();
  clearResidualCache();

  // The chain moves the first onset to 0; keep the shift (ms) to place the original recording.
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

  const end = alignment.end;
  const tempoSpans = expanded
    .filter((call) => call.name === 'InsertTempo' || call.name === 'FitTempo')
    .map(spanOf)
    .filter((span): span is [number, number] => span !== undefined);
  const dynamicsSpans = expanded
    .filter((call) => call.name === 'InsertDynamics' || call.name === 'FitDynamics')
    .map(spanOf)
    .filter((span): span is [number, number] => span !== undefined);

  // A dynamics span includes the chord on its last date, so a gap starts on the chord after it.
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
  // Ornaments only take effect through definitions, which `StylizeOrnamentation` writes.
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
    // Drop calls whose `requires` no earlier transformer meets.
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

  const residual = silently(() => deriveResidual(alignment, mpm));
  const segments = silently(() => placeTempos(alignment, mpm, 'global'));
  const xml = exportMPM(mpm);

  const score = silently(() => alignment.serializeScore());
  if (score) keep(xml, score);
  const rendered = score ? perform(score, xml) : { notes: [], pedals: [] };
  const performed = new Map<string, Sounded>(rendered.notes.map((note) => [note.id, note]));
  const pedalled = rendered.pedals;

  // The recording with only `Modify` applied, to compare the rendering with. The chain's copy
  // will not do: transformers remove from it what they explain.
  const corrected = pristine.deepClone();
  silently(() => {
    const corrections = expanded.filter(
      (call) => call.name === 'Modify' && !failed.has(origin.get(call.id) ?? call.id),
    );
    for (const correction of buildChain(revive(corrections)).transformers) {
      if (correction.name !== 'Modify') continue;
      try {
        correction.run(corrected, createMpm());
      } catch {
        // Already reported by the main run.
      }
    }
  });
  const asCorrected = new Map(corrected.allNotes.map((note) => [note['xml:id'], note]));
  const asArrived = new Map(pristine.allNotes.map((note) => [note['xml:id'], note]));
  const onClock = (note: AlignedNote): Sounded => ({
    ms: note['milliseconds.date'] - shifted,
    msEnd: note['milliseconds.date.end'] - shifted,
    velocity: note.velocity,
  });

  const assumeLevel = transformers.find((t): t is AssumeLevel => t instanceof AssumeLevel);
  const assumedTempo = transformers
    .filter((t): t is FitTempo => t instanceof FitTempo && t.options.assumed === true && !!t.fitted)
    .map((t) => ({ from: t.options.from, to: t.options.to, bpm: (t.fitted as InsertTempoOptions).bpm }));
  const level = assumeLevel?.level ?? Math.round(median(alignment.allNotes.map((n) => n.velocity)));

  const governing = (date: number) => segments.find((segment) => coversDate(segment, date)) ?? segments[0];

  const notes: RollNote[] = alignment.allNotes.map((note) => {
    const id = note['xml:id'];
    const played = onClock(asCorrected.get(id) ?? note);
    const original = onClock(asArrived.get(id) ?? note);
    const sounds = performed.get(id);
    const segment = governing(note.date);
    // Offset (ms) from the renderer's clock to the recording's in this tempo segment.
    const lead = segment ? segment.startMs - segment.renderedStartMs : 0;
    const rendering: Sounded =
      sounds && segment
        ? { ms: lead + sounds.ms, msEnd: lead + sounds.msEnd, velocity: sounds.velocity }
        : played;
    const changed =
      Math.abs(original.ms - played.ms) > 1e-6 ||
      Math.abs(original.msEnd - played.msEnd) > 1e-6 ||
      original.velocity !== played.velocity;
    return {
      id,
      part: note.part,
      pitch: note['midi.pitch'],
      date: note.date,
      duration: note.duration,
      ...played,
      ...(changed && { arrived: original }),
      mpm: rendering,
      late: played.ms - rendering.ms,
      longMs: played.msEnd - played.ms - (rendering.msEnd - rendering.ms),
      loud: played.velocity - rendering.velocity,
    };
  });

  const clockAt = (date: number): number => {
    const segment = governing(date);
    return segment ? segment.startMs + millisecondsAt(date, segment.resolved) : date;
  };
  const beats: RunResult['beats'] = [];
  alignment.timeSignatures.forEach((signature, i) => {
    const until = alignment.timeSignatures[i + 1]?.date ?? end;
    for (let date = signature.date; date < until; date += WHOLE / signature.denominator) {
      beats.push({ date, ms: clockAt(date) });
    }
  });
  if (beats.length === 0) {
    for (let date = 0; date < end; date += PPQ) beats.push({ date, ms: clockAt(date) });
  }
  beats.push({ date: end, ms: clockAt(end) });

  const pedals: RunResult['pedals'] = {
    played: corrected.pedals
      .map((pedal) => ({
        kind: pedal.type,
        ms: pedal['milliseconds.date'] - shifted,
        msEnd: pedal['milliseconds.date.end'] - shifted,
      }))
      .sort((a, b) => a.ms - b.ms),
    mpm: pedalled
      .map(({ kind, date, ms, value }) => {
        const segment = governing(date);
        return { kind, ms: (segment ? segment.startMs - segment.renderedStartMs : 0) + ms, value };
      })
      .sort((a, b) => a.ms - b.ms),
  };

  const graces = alignment.graces.map((grace) => ({
    id: grace['xml:id'],
    group: grace.group,
    principal: grace.principal,
    pitch: grace['midi.pitch'],
    ms: grace['milliseconds.date'],
    velocity: grace.velocity,
  }));

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
        // Evidence and range are optional.
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
  // Start tags by `xml:id` and definitions by name, from the exported XML.
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

  const onDate = Map.groupBy(alignment.allNotes, (note) => note.date);
  for (const report of reports.values()) {
    report.elements = [...new Set(report.elements)];
    // '' for an element a later call removed.
    report.written = report.elements.map((id) => tags.get(id) ?? '');
    report.definitions = definedBy(report.written);
    // A whole-scope call reports no evidence: use the chords it wrote ornaments on.
    if (report.evidence.length === 0) {
      for (const element of report.elements) {
        const dated = /^ornament_(\d+(?:\.\d+)?)/.exec(element);
        if (!dated) continue;
        for (const note of onDate.get(Number(dated[1])) ?? []) report.evidence.push(note['xml:id']);
      }
    }
    report.evidence = [...new Set(report.evidence)];
  }

  // Assumed tempos first, so the record alone reproduces the document.
  const concreteOf = (id: string) => reports.get(id)?.concrete ?? [];
  const linked = new Set<string>();
  const record: PlainCall[] = assumedTempo.map((gap, index) => ({
    id: `assumed-tempo-${index}`,
    name: 'InsertTempo',
    options: { scope: 'global', from: gap.from, to: gap.to, bpm: gap.bpm, beatLength: 0.25 },
  }));
  for (const step of steps) {
    if (step.name === DESCRIBE) {
      const options = step.options as unknown as DescribeOptions;
      const made = (options.calls ?? []).flatMap(concreteOf);
      (options.calls ?? []).forEach((id) => linked.add(id));
      record.push({ ...step, options: { ...options, calls: made.map((call) => call.id) } }, ...made);
    } else if (!linked.has(step.id)) {
      record.push(...concreteOf(step.id));
    }
  }

  return {
    mpm: xml,
    notes,
    graces,
    pedals,
    beats,
    record,
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

// ---------------------------------------------------------------------------------------------
// Bringing instructions out
// ---------------------------------------------------------------------------------------------

/** The MPM of a run with some of its instructions brought out, as the renderer performs it. */
export interface BroughtOut {
  /** Every note as performed, in ms on this rendering's own clock (not the recording's). */
  notes: { id: string; ms: number; msEnd: number; velocity: number }[];
  /** The sustaining pedal's moves in this rendering, on the same clock; `value` is of 127. */
  pedal: { ms: number; value: number }[];
  /** The expression dimensions that were exaggerated; empty where nothing could be brought out. */
  spared: string[];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** `mpm` with the dimensions of the instructions `ids` exaggerated and the others damped. */
const emphasize = (mpm: string, ids: readonly string[], factor: number, attenuation: number) => {
  const plain = { mpm, spared: [] as string[] };
  const present = ids.filter((id) => mpm.includes(`xml:id="${id}"`));
  if (present.length === 0) return plain;
  try {
    const { mpm: damped, spared } = spotlightMpm(mpm, { ids: present, attenuation: clamp(attenuation, 0.05, 1) });
    // Beyond 1.9 an ornament can end a note before it begins.
    const factors = Object.fromEntries(spared.map((dimension) => [dimension, clamp(factor, 1, 1.9)]));
    return { mpm: exaggerateMpm(damped, { factors }).mpm, spared: [...spared] };
  } catch {
    // An id on a definition or a style switch: nothing to bring out.
    return plain;
  }
};

/**
 * Renders the MPM of a run with the instructions `ids` exaggerated by `factor` (1 to 1.9) and the
 * other dimensions damped to `attenuation` (0.05 to 1). `mpm` is the `RunResult.mpm` of a recent run.
 */
export const bringOut = (mpm: string, ids: readonly string[], factor: number, attenuation: number): BroughtOut => {
  const score = scores.get(mpm);
  if (score === undefined) throw new Error('bringOut: this MPM is not that of a recent run, so its run is not known');
  keep(mpm, score);
  const emphasized = emphasize(mpm, ids, factor, attenuation);
  const { notes, pedals } = perform(score, emphasized.mpm);
  return {
    notes,
    pedal: pedals
      .filter((move) => move.kind === 'sustain')
      .map(({ ms, value }) => ({ ms, value }))
      .sort((a, b) => a.ms - b.ms),
    spared: emphasized.spared,
  };
};
