import { Alignment } from '../../alignment';
import type { Range } from '../range';
import { AbstractTransformer, type TransformationOptions } from '../Transformer';

/** What a remark was made about: the whole piece, a passage, a set of notes, or a direction. */
export interface DescribedPlace {
  kind: 'piece' | 'span' | 'notes' | 'box' | 'arrow';
  /** Ticks. `to` is exclusive: the next onset after the last note described. */
  from: number;
  to: number;
  /** The notes named: all of a set, the two ends of an arrow, none for a passage or the piece. */
  notes: string[];
}

export interface DescribeOptions extends TransformationOptions {
  /** The remark, in the words it was made in. */
  text: string;
  about: DescribedPlace;
  /** The model that turned the remark into calls; null where they were written by hand. */
  model: string | null;
  /** When the remark was made, ISO 8601. */
  date: string | null;
  /** The ids of the calls the remark became. */
  calls: string[];
}

const NOTHING: DescribeOptions = {
  text: '',
  about: { kind: 'piece', from: 0, to: 0, notes: [] },
  model: null,
  date: null,
  calls: [],
};

/**
 * A remark in words, and the calls it was turned into.
 *
 * It writes nothing: the calls it names do. It is a step of the chain so that the list of calls
 * stays flat and still says which of them came from which remark, by whom and when.
 */
export class Describe extends AbstractTransformer<DescribeOptions> {
  readonly name = 'Describe';
  requires = [];

  constructor(options?: DescribeOptions) {
    super(options ?? NOTHING);
  }

  range(): Range | undefined {
    const { kind, from, to } = this.options.about;
    return kind === 'piece' ? undefined : { from, to };
  }

  /** The notes the remark was made about, the end of its passage excluded. */
  evidence(msm: Alignment): string[] {
    const { kind, from, to, notes } = this.options.about;
    if (kind === 'piece') return [];
    if (kind === 'notes' || kind === 'box') return notes;
    return msm.allNotes.filter((note) => note.date >= from && note.date < to).map((note) => note['xml:id']);
  }

  protected transform(): void {
    // Nothing to write.
  }
}
