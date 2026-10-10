import {
  auditInstructions,
  fingerprintInstructions,
  getInstructions,
  type InstructionType,
  type Scope,
} from '../instructions/index';
import { Alignment } from '../alignment';
import type { Residual } from '../residual';
import type { Range } from './range';
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
export type TransformerConstructor = new (...args: never[]) => Transformer;

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
  /**
   * The span of score this call acts on, or `undefined` for one that is about no place in it.
   *
   * @param residual where the recording falls on the score grid. Only a call about a recorded
   * press needs it, since a press has no symbolic date of its own; every other call answers
   * from its own options.
   */
  range(msm: Alignment, residual?: Residual): Range | undefined;
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

  /**
   * Stated by every transformer, as `requires` is: a call about no place in the score says so
   * rather than being taken for one.
   */
  abstract range(msm: Alignment, residual?: Residual): Range | undefined;

  protected abstract transform(msm: Alignment, mpm: Mpm): void;
}

/**
 * An `xml:id` for a new instruction of `type` at `date` that nothing in `mpm` already uses.
 *
 * The suffix is the first free index rather than the count of instructions at the date. The two
 * agree only while nothing has been removed: once `tempo_0` is gone and `tempo_0_1`, `tempo_0_2`
 * remain, the count is 2 and `tempo_0_2` is taken (issue #30). Removal is ordinary operation, and
 * a duplicate id is not cosmetic: {@link AbstractTransformer.run} derives `created` by
 * fingerprinting instructions *by id*, so two elements sharing one look like one element and only
 * the second can be attributed.
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
