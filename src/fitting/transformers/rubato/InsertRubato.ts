import type { AddRubatoOptions } from 'espressivo';
import { Mpm, requireMap } from '../../instructions/index';
import { Alignment, type AlignedNote } from '../../alignment';
import {
  AbstractTransformer,
  generateId,
  type ScopedTransformationOptions,
} from '../Transformer';
import { clamp } from '../../utils';
import { PULSES_PER_QUARTER } from '../../ppq';
import { TranslatePhysicalTimeToTicks } from '../tempo/index';
import { determineIntensity } from '../ornamentation/index';
import { deriveResidual, type Residual } from '../../residual';
import { head, isNonEmpty, numberAt } from 'espressivo';

// Re-exported: `calculateRubatoOnDate` is part of this module's public surface, and the rubato
// desk imports it from here.
export { calculateRubatoOnDate } from './rubatoMath';

/**
 * Where a chord fell under the tempo, averaged over its notes — or `undefined` when the
 * residual has no position for one of them. A note no `<tempo>` covers has no tick date at all
 * (see `residual/index.ts`), and one of those summed into the mean turns it, every scaled date
 * derived from it and the fitted @intensity into NaN.
 */
const avarageTickDate = (notes: AlignedNote[], residual: Residual) => {
  let sum = 0;
  for (const note of notes) {
    const time = residual.of(note);
    // Both are the tempo interpolation's output, and this transformer needs it to have run.
    if (time?.tickDate === undefined || time.tickDuration === undefined) return undefined;
    sum += time.tickDate;
  }
  return sum / notes.length;
};

export interface InsertRubatoOptions extends ScopedTransformationOptions {
  date: number;
  length: number;
}

/**
 * Interpolates <rubato> elements.
 */
export class InsertRubato extends AbstractTransformer<InsertRubatoOptions> {
  name = 'InsertRubato';
  requires = [TranslatePhysicalTimeToTicks];

  constructor(options?: InsertRubatoOptions) {
    super(
      options || {
        scope: 'global',
        date: 0,
        length: PULSES_PER_QUARTER,
      },
    );
  }

  protected transform(msm: Alignment, mpm: Mpm): void {
    // Where the notes fell under the tempo, with rubato held out — this is what fits it.
    // Holding it out also means a second call over a looping frame reads the same raw
    // positions the first one did, rather than positions the first call has compensated.
    const residual = deriveResidual(msm, mpm, { without: ['rubato'] });

    const frame = { date: this.options.date, length: this.options.length };
    const chords = [...msm.in(this.options.scope).chords().entries()].filter(
      ([date]) => date >= frame.date && date < frame.date + frame.length,
    );

    if (!isNonEmpty(chords)) return;

    // The rubato transformation can only be placed
    // after a tempo interpolation. Make sure that
    // all notes have a tick date and a tick duration.
    const meanTickDates: number[] = [];
    for (const [, notes] of chords) {
      const mean = avarageTickDate(notes, residual);
      if (mean === undefined) {
        console.error(
          'InsertRubato: some note has no tick date or duration — run a tempo interpolation first.',
        );
        return;
      }
      meanTickDates.push(mean);
    }

    // if there are notes on the first date, we can use their
    // average tick date to determine a late start. Otherwise,
    // there is no late start.
    // one mean per chord, and the loop above returns rather than skipping, so a first chord
    // means a first mean.
    const [firstChordDate] = head(chords);
    const startDate =
      firstChordDate === this.options.date
        ? numberAt(meanTickDates, 0, 'the chord mean tick dates')
        : this.options.date;
    // A @lateStart of 0 is the renderer's default (espressivo `resolveRubato`), so the
    // frame that starts on time says nothing rather than saying nothing new.
    let lateStart: number | undefined = clamp((startDate - frame.date) / frame.length, 0, 0.9);
    if (lateStart === 0) lateStart = undefined;

    const endDate = this.options.date + this.options.length;

    const scaledDates = meanTickDates.map(
      (realDate) => (realDate - startDate) / (endDate - startDate),
    );

    if (!scaledDates.includes(0)) {
      scaledDates.unshift(0);
    }
    if (!scaledDates.includes(1)) {
      scaledDates.push(1);
    }

    const intensity = determineIntensity(scaledDates);

    const rubato: AddRubatoOptions = {
      id: generateId('rubato', frame.date, mpm),
      date: frame.date,
      frameLength: frame.length,
      intensity,
      loop: false,
      lateStart,
    };

    requireMap(mpm, 'rubato', this.options.scope).addRubato(rubato);
  }
}
