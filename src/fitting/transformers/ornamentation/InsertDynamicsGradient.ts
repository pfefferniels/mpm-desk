import {
  type InstructionOptions,
  Mpm,
  fillInAt,
  requireMap,
  setOrnamentDraft,
} from '../../instructions/index';
import { Alignment, type AlignedNote } from '../../alignment';
import { isDefined } from '../../utils';
import {
  AbstractTransformer,
  generateId,
  type ScopedTransformationOptions,
} from '../Transformer';
import { head, isNonEmpty, last, numberAt } from 'espressivo';
import { noteOrderOf } from './noteOrder';

/**
 * The velocity ramp across an arpeggio, in the units a `<dynamicsGradient>`'s
 * `transition.from`/`transition.to` use: relative, and no further out than -1 and 1, the bounds
 * MPM puts on both attributes. The `<ornament>`'s `@scale` is what turns them into velocities.
 * Named apart from espressivo's `DynamicsGradient`, the `<ornamentDef>` child it is fitted into
 * but is not.
 */
export interface GradientRange {
  from: number;
  to: number;
}

interface SingleGradient {
  date: number;
  gradient: GradientRange;
}

interface DefaultGradients {
  crescendo: GradientRange;
  decrescendo: GradientRange;
}

const isSingleGradient = (
  gradient: SingleGradient | DefaultGradients,
): gradient is SingleGradient => 'date' in gradient && 'gradient' in gradient;

export type InsertDynamicsGradientOptions = ScopedTransformationOptions &
  (SingleGradient | DefaultGradients) & {
    /**
     * Whether to redeal the chord's velocities so that they rise or fall monotonically along
     * the roll before the ramp is fitted. The recording is rewritten to say so.
     */
    sortVelocities: boolean;
  };

export type ArpeggioDirection = 'crescendo' | 'decrescendo';

/** The chord's sounded notes in the order they were struck. A copy: the chord is the map's. */
const struckOrder = (chord: readonly AlignedNote[]): AlignedNote[] =>
  chord
    .filter((note) => isDefined(note['milliseconds.date']))
    .sort((a, b) => a['milliseconds.date'] - b['milliseconds.date']);

/**
 * Whether a chord's velocities lean up or down across the roll: up if its loudest note comes
 * after its quietest, the first of several equally loud ones standing for them.
 */
const directionOf = (struck: readonly AlignedNote[]): ArpeggioDirection => {
  const velocities = struck.map((note) => note.velocity);
  const loudestAt = velocities.indexOf(Math.max(...velocities));
  const quietestAt = velocities.indexOf(Math.min(...velocities));
  return loudestAt > quietestAt ? 'crescendo' : 'decrescendo';
};

/**
 * The velocities the ramp is fitted along: those of the chord's sounded notes in the order they
 * were struck, or, with `sortVelocities`, the same velocities redealt so that they rise or fall
 * monotonically in the chord's own direction, which is what the fit then writes onto the notes.
 * The first and the last entry are the two ends the ramp is measured between.
 *
 * Exported for the Dynamics Gradient desk, whose handles choose a standard velocity on this ramp
 * and have to know where its ends lie; see {@link gradientThrough}.
 */
export const rampVelocities = (
  chord: readonly AlignedNote[],
  sortVelocities: boolean,
): number[] => {
  const struck = struckOrder(chord);
  const velocities = struck.map((note) => note.velocity);
  if (!sortVelocities) return velocities;
  const direction = directionOf(struck);
  return velocities.sort((a, b) => (direction === 'crescendo' ? a - b : b - a));
};

/** Where a velocity lies between two others, 0 at the first and 1 at the second, held within. */
const positionBetween = (velocity: number, first: number, second: number): number =>
  first === second ? 0 : Math.min(1, Math.max(0, (velocity - first) / (second - first)));

/**
 * The gradient that leaves a chord's standard velocity, the one every note carries once the ramp
 * explains the rest, at `standard` on a ramp between the first and the last of these velocities.
 *
 * Unit width, so that `@scale` becomes the velocity difference itself and the two ends decide
 * only where on the ramp the standard sits: `{ from: 0, to: 1 }` keeps the first note's velocity,
 * `{ from: -1, to: 0 }` the last note's. A standard beyond either end lands on that end, which is
 * what keeps both attributes within the -1…1 MPM allows.
 */
export const gradientThrough = (standard: number, ramp: readonly number[]): GradientRange => {
  const position = isNonEmpty(ramp) ? positionBetween(standard, head(ramp), last(ramp)) : 0;
  // The unit ramp, slid so that the standard's position on it lands at 0.
  return { from: 0 - position, to: 1 - position };
};

/**
 * Refuse a ramp MPM cannot hold. A `<dynamicsGradient>` runs between -1 and 1, and one whose two
 * ends coincide has no slope for `@scale` to stretch, so nothing finite could be written.
 */
const requireWithinSpec = ({ from, to }: GradientRange): void => {
  const within = (end: number) => end >= -1 && end <= 1;
  if (!within(from) || !within(to))
    throw new Error(
      'InsertDynamicsGradient: a <dynamicsGradient> runs between -1 and 1, and this one goes ' +
        `from ${String(from)} to ${String(to)}`,
    );
  if (from === to)
    throw new Error(
      `InsertDynamicsGradient: a <dynamicsGradient> with both ends at ${String(from)} has no ` +
        "slope to carry the chord's velocities",
    );
};

/**
 * Interpolates arpeggiated chords as ornaments, inserts them as physical
 * values into the MPM and substracts accordingly from the recorded onsets, so
 * that after the transformation all notes of the chord will have the same
 * onset.
 *
 * @note Inserting the dynamics gradient should always take place before
 * inserting temporal spread, since temporal spread will destroy the original
 * order of the recorded onsets.
 */
export class InsertDynamicsGradient extends AbstractTransformer<InsertDynamicsGradientOptions> {
  name = 'InsertDynamicsGradient';
  requires = [];

  constructor(options?: InsertDynamicsGradientOptions) {
    super(
      options || {
        scope: 'global',
        crescendo: { from: -1, to: 0 },
        decrescendo: { from: 0, to: -1 },
        sortVelocities: false,
      },
    );
  }

  /**
   * Fit one chord: write the `<ornament>` whose gradient, chosen by `gradientFor` from the
   * chord's direction, explains the velocity difference between the first and the last note
   * struck, and leave every note of the chord at the standard velocity that remains.
   *
   * @note The chord is passed in rather than looked up. Opening with
   * `msm.in(scope).chords().get(date)` would be a full walk-and-group of every note in the score,
   * while the only bulk caller is already iterating exactly that map — so the whole score would
   * be regrouped once per chord in it.
   */
  private readonly applyGradient = (
    mpm: Mpm,
    date: number,
    chord: AlignedNote[],
    gradientFor: (direction: ArpeggioDirection) => GradientRange,
  ) => {
    const struck = struckOrder(chord);
    if (struck.length === 0) return;

    // Read off the recorded velocities, before the sort below makes every chord a crescendo.
    const gradient = gradientFor(directionOf(struck));
    requireWithinSpec(gradient);

    const ramp = rampVelocities(struck, this.options.sortVelocities);
    if (this.options.sortVelocities) {
      struck.forEach((note, i) => {
        note.velocity = numberAt(ramp, i, 'the sorted velocities');
      });
    }

    // The dynamics gradient is the transition between the first and the last note struck.
    const firstVel = numberAt(ramp, 0, 'the ramp');
    const lastVel = numberAt(ramp, ramp.length - 1, 'the ramp');
    const diffVel = lastVel - firstVel;
    if (diffVel === 0) return;

    const scale = diffVel / (gradient.to - gradient.from);
    const standard = firstVel - gradient.from * scale;

    // `fillInAt`, not `addOrnamentV3`: `InsertTemporalSpread` describes the other half of
    // this same `<ornament>`, and whichever runs second has to find the first's element.
    const map = requireMap(mpm, 'ornament', this.options.scope);
    const options: InstructionOptions<'ornament'> = {
      id: generateId('ornament', date, mpm),
      date,
      nameRef: 'neutralArpeggio',
      scale,
      // The ramp above was measured from the first note struck to the last, so the element has
      // to say which notes those were. Left off, espressivo does not abstain: it walks the chord
      // by ascending pitch, rendering the ramp along a sequence nothing fitted it to. Written
      // here as well as by `InsertTemporalSpread`, since a spread is not always asked for over
      // the same chord. See issue #20.
      noteOrder: noteOrderOf(struck),
    };
    const element = fillInAt(map, options, {
      localName: 'ornament',
      add: (o) => map.addOrnamentV3(o),
      read: (i) => map.getOrnamentOptionsOf(i),
      update: (i, patch) => map.updateOrnamentAt(i, patch),
    });

    // The ramp's two ends belong on the `<dynamicsGradient>` of the def this ornament will
    // come to name, and MPM has no place for them on the instruction. They travel parked on
    // the element until `StylizeOrnamentation` decides which ornaments share a definition.
    setOrnamentDraft(element, {
      transitionFrom: gradient.from,
      transitionTo: gradient.to,
    });

    struck.forEach((note) => {
      note.velocity = standard;
    });
  };

  protected transform(msm: Alignment, mpm: Mpm): void {
    const chords = msm.in(this.options.scope).chords();
    const options = this.options;

    if (isSingleGradient(options)) {
      const chord = chords.get(options.date);
      if (!chord) return;
      this.applyGradient(mpm, options.date, chord, () => options.gradient);
    } else {
      for (const [date, chord] of chords) {
        if (chord.length === 1) continue;
        this.applyGradient(mpm, date, chord, (direction) => options[direction]);
      }
    }
  }
}
