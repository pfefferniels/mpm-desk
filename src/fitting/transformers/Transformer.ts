import {
  auditInstructions,
  fingerprintInstructions,
  getInstructions,
  type InstructionType,
  type Scope,
} from '../instructions/index';
import { Alignment } from '../alignment';
import type { Residual } from '../residual';
import { Mpm } from 'espressivo';
import { v4 } from 'uuid';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TransformationOptions {}

/**
 * The part on which the transformer is to be applied to.
 */
export interface ScopedTransformationOptions extends TransformationOptions {
  scope: Scope;
}

/**
 * The Transformer interface declares a method for building the chain of transformations.
 * It also declares a method for executing a transformation.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TransformerConstructor = new (...args: any[]) => Transformer;

export interface Transformer {
  id: string;
  readonly name: string;
  options: TransformationOptions;
  /**
   * The `xml:id`s of the MPM elements this call is answerable for, as of its last run.
   *
   * Derived, never declared — see {@link AbstractTransformer.run}. It is what a work file's
   * segments name, and what the bake turns into spans.
   */
  created: string[];
  run(msm: Alignment, mpm: Mpm): void;
  readonly requires: TransformerConstructor[];
}

/**
 * The default chaining behavior.
 */
export abstract class AbstractTransformer<
  OptionsType extends TransformationOptions,
> implements Transformer {
  id: string = v4();
  abstract readonly name: string;
  options: OptionsType;
  created: string[] = [];

  abstract readonly requires: TransformerConstructor[];

  protected constructor(options: OptionsType) {
    this.options = options;
  }

  /**
   * Run the transformer and record which MPM elements it is answerable for.
   *
   * `created` is **derived**, by fingerprinting every instruction before and after — the same
   * move `src/fitting/residual.ts` made, and for the same reason. Nothing intercepts a write, which is
   * what lets `transform` write straight through espressivo's own maps.
   *
   * "Answerable for", not "inserted": the diff sees an instruction a transformer *changed* as
   * well as one it added, so `StylizeArticulation` naming an articulation and
   * `CombineAdjacentRubatos` folding two frames together are both attributed.
   *
   * Not to be overridden. A transformer that must not be credited with something it wrote says
   * so through {@link AbstractTransformer.disowned}.
   */
  public run(msm: Alignment, mpm: Mpm): void {
    const before = fingerprintInstructions(mpm);
    this.transform(msm, mpm);

    const { fingerprints, unnamed, nonFinite } = auditInstructions(mpm);

    if (unnamed.length > 0) {
      throw new Error(
        `${this.name} left ${String(unnamed.length)} instruction(s) with no xml:id ` +
          `(${unnamed.slice(0, 3).join(', ')}). One without an id cannot be attributed ` +
          'to the transformer that wrote it — pass `id` in the options.',
      );
    }
    if (nonFinite.length > 0) {
      throw new Error(
        `${this.name} wrote ${nonFinite.slice(0, 3).join(', ')}: an MPM attribute must be ` +
          'a finite number. Whatever computed it produced NaN or an infinity — look ' +
          'there, not here.',
      );
    }

    const disowned = new Set(this.disowned());
    this.created = [...fingerprints]
      .filter(([id, xml]) => before.get(id) !== xml && !disowned.has(id))
      .map(([id]) => id);
  }

  /**
   * The `xml:id`s this call wrote but is not answerable for, as of the `transform` that just ran.
   *
   * The diff cannot tell a restoration from an insertion: an instruction written only to put back
   * what the call displaced looks exactly like one the call meant to add. Naming it here keeps it
   * out of `created`.
   */
  protected disowned(): readonly string[] {
    return [];
  }

  protected abstract transform(msm: Alignment, mpm: Mpm): void;
}

/**
 * An `xml:id` for a new instruction of `type` at `date` that nothing in `mpm` already uses.
 *
 * The suffix is the first free index, not the count of instructions at the date. Counting is
 * only the same thing while nothing has ever been removed: once `tempo_0` is gone and
 * `tempo_0_1`, `tempo_0_2` remain, the count is 2 and `tempo_0_2` is taken (issue #30).
 * `ApproximateLogarithmicTempo` removes and re-inserts its instructions on every refit, so that
 * is ordinary operation rather than a corner case — and a duplicate id is not a cosmetic
 * problem: {@link AbstractTransformer.run} derives `created` by fingerprinting instructions *by
 * id*, so two elements sharing one id look like one element, and whichever of them was written
 * second is the only one anything can be answerable for.
 *
 * The scan is over every instruction of the type rather than only those at the date, because an
 * id is only unique if it is unique in the document.
 */
export const generateId = (type: InstructionType, date: number, mpm: Mpm): string => {
  const taken = new Set(getInstructions(mpm, type).map((instruction) => instruction.id));
  let candidate = `${type}_${date}`;
  for (let n = 1; taken.has(candidate); n++) {
    candidate = `${type}_${date}_${n}`;
  }
  return candidate;
};

const isRangeBased = (
  transformer: TransformationOptions,
): transformer is TransformationOptions & { from: number; to: number } => {
  return 'from' in transformer && 'to' in transformer;
};

const isDateBased = (
  transformer: TransformationOptions,
): transformer is TransformationOptions & { date: number } => {
  return 'date' in transformer;
};

const isNoteBased = (
  transformer: TransformationOptions,
): transformer is TransformationOptions & { noteIDs: string[] } => {
  return 'noteIDs' in transformer;
};

interface Range {
  from: number;
  to?: number;
}

/**
 * The span of score a transformer acts on.
 *
 * @param residual required only for a pedal-based transformer, whose span is measured in ticks
 * off the score grid and so has to be derived. Every other kind answers from its own options.
 * Omitting it where it is needed throws rather than returning `undefined`: the pedal branch used
 * to drop any pedal it could not place and then report no range at all, which reads exactly like
 * a chain that happens not to touch a pedal.
 */
export const getRange = (
  transformer: TransformationOptions | Transformer[],
  msm: Alignment,
  residual?: Residual,
): Range | undefined => {
  if (Array.isArray(transformer)) {
    const ranges = transformer
      .map((t) => {
        return getRange(t.options, msm, residual);
      })
      .filter((d) => !!d);

    if (ranges.length === 0) {
      return undefined;
    }

    const from = Math.min(...ranges.map(({ from }) => from));
    const to = Math.max(...ranges.map(({ from, to }) => Math.max(from, to ?? from)));
    if (to <= from) return { from };
    return { from, to };
  }

  if (isRangeBased(transformer)) {
    return { from: transformer.from, to: transformer.to };
  }
  if (isDateBased(transformer)) {
    if ('length' in transformer && typeof transformer.length === 'number') {
      return { from: transformer.date, to: transformer.date + transformer.length };
    }
    return { from: transformer.date };
  }
  if (isNoteBased(transformer)) {
    const noteids = transformer.noteIDs;
    const dates = noteids
      .map((id) => msm.getByID(id)?.date)
      .filter((d): d is number => d !== undefined);
    if (dates.length === 0) {
      return undefined;
    }
    return { from: Math.min(...dates), to: Math.max(...dates) };
  }
  if ('pedal' in transformer) {
    const pedalId = (transformer as TransformationOptions & { pedal?: string }).pedal;
    const pedals = pedalId ? msm.pedals.filter((p) => p['xml:id'] === pedalId) : msm.pedals;

    const direction =
      'direction' in transformer
        ? (transformer as TransformationOptions & { direction?: string }).direction
        : undefined;
    const start =
      'start' in transformer
        ? ((transformer as TransformationOptions & { start?: number }).start ?? 0)
        : 0;
    const duration =
      'duration' in transformer
        ? ((transformer as TransformationOptions & { duration?: number }).duration ?? 0)
        : 0;

    if (!residual) {
      throw new Error(
        'getRange needs a residual to place a pedal: its position on the score grid is ' +
          'derived from the MPM, not carried on the pedal. Pass deriveResidual(msm, mpm).',
      );
    }

    const ranges = pedals
      .map((p) => {
        const placed = residual.ofPedal(p);
        if (placed?.tickDate === undefined || placed.tickDuration === undefined) return undefined;
        const base = direction === 'up' ? placed.tickDate + placed.tickDuration : placed.tickDate;
        return { from: base + start, to: base + start + duration };
      })
      .filter((r): r is { from: number; to: number } => r !== undefined);

    if (ranges.length === 0) {
      return undefined;
    }
    return {
      from: Math.min(...ranges.map((r) => r.from)),
      to: Math.max(...ranges.map((r) => r.to)),
    };
  }

  return undefined;
};
