import { v4 } from 'uuid';
import { Alignment, redrawPress, type AlignedPedal } from '../../alignment';
import { isPressTravel, returnToRest, type Travel } from '../../../performance/pedalTravel';
import { AbstractTransformer, type TransformationOptions } from '../Transformer';

/** The press the correction is about, by the `xml:id` the alignment knows it under. */
interface AboutPress extends TransformationOptions {
  pedal: string;
}

/** The press's line replaced wholesale. The onset stays; the release follows the line. */
export interface RedrawnPress extends AboutPress {
  travel: Travel;
}

/** A press the pianist did not make. */
export interface RemovedPress extends AboutPress {
  remove: true;
}

/** A press the roll lacks. Its `pedal` is minted by {@link newPressId} when the draft begins. */
export interface AddedPress extends AboutPress {
  type: AlignedPedal['type'];
  /** The take it is counted under, where one is known. Descriptive: nothing after this call selects by it. */
  source?: string;
  /** Its `milliseconds.date`. Not spelled `date`, which `getRange` would read as a tick. */
  onsetMs: number;
  travel: Travel;
}

export type CorrectPedalOptions = RedrawnPress | RemovedPress | AddedPress;

/** An id for a press the roll lacks, of a shape `asMSM` never mints. */
export const newPressId = (): string => `pedal-${v4()}`;

const isRemoval = (options: CorrectPedalOptions): options is RemovedPress => 'remove' in options;
const isAddition = (options: CorrectPedalOptions): options is AddedPress => 'onsetMs' in options;

/** The record an added press becomes, which the desk also draws before the chain has made it. */
export const pressOf = (added: AddedPress): AlignedPedal => ({
  'xml:id': added.pedal,
  type: added.type,
  ...(added.source !== undefined && { source: added.source }),
  'milliseconds.date': added.onsetMs,
  'milliseconds.date.end': added.onsetMs + returnToRest(added.travel),
  travel: added.travel,
});

/**
 * A correction to a recorded pedal's line.
 *
 * `Modify` moves a press or its release; this redraws the line between them, adds a press the
 * roll lacks, or removes one the pianist did not make. Like `Modify` it writes no instruction: it
 * corrects the recording the performance is fitted to. It runs after `MakeChoice`, so a press it
 * adds is not a reading for the choice to discard, and before `Modify`, so a displacement can
 * reach a press it added.
 *
 * A line is replaced, never written into: `Alignment.deepClone` shares the travel arrays with
 * the copy the worker keeps between fits.
 */
export class CorrectPedal extends AbstractTransformer<CorrectPedalOptions> {
  name = 'CorrectPedal';
  requires = [];

  constructor(options?: CorrectPedalOptions) {
    // About no press at all: the registry instantiates once to read `name`.
    super(options ?? { pedal: '', remove: true });
  }

  protected transform(msm: Alignment): void {
    const options = this.options;

    if (isRemoval(options)) {
      msm.pedals = msm.pedals.filter((pedal) => pedal['xml:id'] !== options.pedal);
      return;
    }

    if (!isPressTravel(options.travel)) {
      console.error(`CorrectPedal: not the line of a press, for ${options.pedal}`);
      return;
    }

    if (isAddition(options)) {
      if (msm.pedals.some((pedal) => pedal['xml:id'] === options.pedal)) {
        console.error(`CorrectPedal: there is a press ${options.pedal} already`);
        return;
      }
      msm.pedals = [...msm.pedals, pressOf(options)];
      return;
    }

    for (const pedal of msm.pedals.filter((p) => p['xml:id'] === options.pedal)) {
      redrawPress(pedal, options.travel);
    }
  }
}
