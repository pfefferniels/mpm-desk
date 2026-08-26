import {
  AccentuationPatternDef,
  ensureDefaultStyle,
  getDefinitions,
  getInstructions,
  insertDefinition,
  Mpm,
  requireMap,
  unwrap,
} from '../../instructions/index';
import { Alignment } from '../../alignment';
import { deriveResidual, type Residual } from '../../residual';
import {
  AbstractTransformer,
  generateId,
  type ScopedTransformationOptions,
} from '../Transformer';
import { v4 } from 'uuid';
import { InsertDynamicsInstructions } from '../dynamics/index';
import { PULSES_PER_WHOLE } from '../../ppq';
import { filterMap } from 'espressivo';

export interface InsertMetricalAccentuationOptions extends ScopedTransformationOptions {
  name: string;
  from: number;
  to: number;
  beatLength: number;
  neutralEnd?: boolean;
  scaleTolerance: number;
}

interface Velocity {
  beat: number;
  avgVelocityChange: number;
}

/**
 * One fitted accentuation, before it is an `<accentuation>` child of anything.
 *
 * espressivo's `AccentuationPatternDef.addAccentuation` takes the four numbers positionally and
 * owns the element from then on, so the fit passes this record around and the def is built in
 * exactly one place ({@link InsertMetricalAccentuation.buildDef}). `id` is optional because the
 * neutral pattern's single accentuation has never carried one.
 */
interface FittedAccentuation {
  id?: string;
  beat: number;
  value: number;
  transitionFrom: number;
  transitionTo: number;
}

export class InsertMetricalAccentuation extends AbstractTransformer<InsertMetricalAccentuationOptions> {
  name = 'InsertMetricalAccentuation';
  requires = [InsertDynamicsInstructions];

  constructor(options?: InsertMetricalAccentuationOptions) {
    super(
      options || {
        scope: 'global',
        name: 'my-accentuation',
        from: 0,
        to: 0,
        beatLength: 0.25,
        neutralEnd: false,
        scaleTolerance: 0,
      },
    );
  }

  /**
   * The residual velocity at each beat of one cell, numbered the way the renderer numbers
   * beats.
   *
   * `denominator * beat + 1` is the same grid espressivo's `MetricalAccentuationMap` reads the
   * pattern back on: it computes `1 + (date − tsDate) % measureTicks / ticksPerBeat` with
   * `ticksPerBeat = 4 * ppq / denominator`, so one beat is one denominator-note in both
   * directions. (Issue #42 reported the two halves disagreeing. The half that read them back
   * in quarters, `removeAccentuationDistortion`, no longer exists — the residual is derived by
   * rendering the document through espressivo now, so the reader *is* the renderer and there
   * is only one grid left to agree with.)
   *
   * The loop counts beats as integers and converts each to ticks once, rather than
   * accumulating `beat += beatLength`. A triplet basis is not representable in binary, so the
   * accumulated position drifted — and `notesAtDate` compares dates with `===`, so a drifted
   * date silently matched no note at all. Rounding to the tick is exact for every basis,
   * because score dates are integers in ticks.
   */
  private extractVelocities(
    { from: start, to: end, beatLength }: InsertMetricalAccentuationOptions,
    msm: Alignment,
    residual: Residual,
  ): Velocity[] {
    const velocities: Velocity[] = [];
    if (beatLength <= 0) return velocities;

    for (let index = 0; ; index++) {
      const beat = index * beatLength;
      const date = start + Math.round(beat * PULSES_PER_WHOLE);
      if (date > end) break;

      const velocityChanges = filterMap(
        msm.notesAtDate(date, this.options.scope),
        (note) => residual.of(note)?.velocity ?? null,
      );
      if (velocityChanges.length === 0) continue;

      const avgVelocityChange =
        velocityChanges.reduce((acc, change) => acc + change, 0) / velocityChanges.length;

      velocities.push({
        // A score may carry no time signature, and `Alignment.build()` writes out 4/4 when it
        // does not. Beat numbers here have to be counted in the same bar the score will
        // be published in, or the pattern would be indexed against a meter nobody sees.
        beat: (msm.timeSignature?.denominator || 4) * beat + 1,
        avgVelocityChange,
      });
    }
    return velocities;
  }

  private calculateScale(velocities: Velocity[]) {
    return Math.max(...velocities.map((v) => Math.abs(v.avgVelocityChange)));
  }

  private calculateAccentuations(
    velocities: Velocity[],
    neutralEnd?: boolean,
  ): FittedAccentuation[] {
    const scale = this.calculateScale(velocities);
    if (scale === 0) return [];

    return velocities
      .map((v, i, arr) => {
        const next = arr[i + 1];
        if (next === undefined) return null;

        const transitionTo =
          i === arr.length - 2 && neutralEnd ? 0 : next.avgVelocityChange / scale;

        const scaled = v.avgVelocityChange / scale;
        return {
          id: `accentuation_${v4()}`,
          beat: v.beat,
          value: scaled,
          transitionFrom: scaled,
          transitionTo,
        };
      })
      .filter((a) => a !== null);
  }

  /** An `accentuationPatternDef` carrying these accentuations. */
  private buildDef(
    name: string,
    length: number,
    accentuations: readonly FittedAccentuation[],
  ): AccentuationPatternDef {
    const def = unwrap(AccentuationPatternDef.fromNameLength(name, length));
    for (const accentuation of accentuations) {
      def.addAccentuation(
        accentuation.beat,
        accentuation.value,
        accentuation.transitionFrom,
        accentuation.transitionTo,
        accentuation.id,
      );
    }
    return def;
  }

  protected transform(msm: Alignment, mpm: Mpm): void {
    if (
      !getDefinitions(mpm, 'accentuationPatternDef', this.options.scope).find(
        (def) => def.getName() === 'neutral',
      )
    ) {
      insertDefinition(
        mpm,
        'accentuationPatternDef',
        this.buildDef('neutral', 0.25, [{ beat: 1, value: 0, transitionFrom: 0, transitionTo: 0 }]),
        this.options.scope,
      );
    }

    const cell = {
      start: this.options.from,
      end: this.options.to,
      name: this.options.name,
      neutralEnd: this.options.neutralEnd,
    };

    const nextCell = getInstructions(mpm, 'accentuationPattern', this.options.scope).find(
      (c) => c.date > this.options.from,
    );

    // What the dynamics curve leaves unexplained, per note. Accentuation is held out because
    // it is what this fits.
    const residual = deriveResidual(msm, mpm, { without: ['accentuationPattern'] });

    const velocities = this.extractVelocities(this.options, msm, residual);

    // The cell the pattern is derived from, and the reference every acceptance test below
    // measures against. `hasSameBeatStructure` already compares each repeat's values with
    // the prototype's; measuring the scale against the running mean instead would let the
    // window drift with the data, since each repeat moves the thing it is judged by. With a
    // tolerance of 5 the scales 10, 14, 18, 22 each pass against the mean so far, and the
    // cell finally admitted is twice the strength of the one that defined the pattern.
    const prototypeScale = this.calculateScale(velocities);
    const accentuations = this.calculateAccentuations(velocities, this.options.neutralEnd);

    if (accentuations.length === 0 || prototypeScale === 0) return;

    // The reported `@scale` is the mean of the scales of every cell the pattern covers —
    // the prototype's included. `cellsInMean` is how many it already stands for, so it
    // starts at 1 rather than 0: the prototype is a sample, not an empty accumulator.
    let scale = prototypeScale;
    let cellsInMean = 1;

    // Where the run of accepted repetitions stopped, and the date the closing neutral
    // belongs on. It cannot be read off `currentCell` afterwards, because the two exit
    // paths leave that in different states: the body advances the cell *before* judging
    // it, so on a `break` the cell is the rejected one — its start being the end of the
    // last accepted repeat by coincidence — while on the `while` condition going false
    // the last repeat was accepted and the cell is still that one, a whole cell short.
    // Inferring from `currentCell.start` put the neutral on top of a repetition that had
    // just been validated and cancelled it. See issue #43.
    let acceptedThrough = cell.end;

    // try to loop until we cannot fit the data into the
    // pattern anymore or we reach the next cell
    const currentCell = { ...cell };
    while (currentCell.end < (nextCell?.date || msm.end)) {
      const cellLength = currentCell.end - currentCell.start;
      currentCell.start += cellLength;
      currentCell.end += cellLength;

      const currentVelocities = this.extractVelocities(
        {
          ...this.options,
          from: currentCell.start,
          to: currentCell.end,
          beatLength: this.options.beatLength,
        },
        msm,
        residual,
      );
      const currentScale = this.calculateScale(currentVelocities);
      if (currentScale === 0) break;

      const currentAccentuations = this.calculateAccentuations(
        currentVelocities,
        this.options.neutralEnd,
      );

      const hasSameBeatStructure = currentAccentuations.every((a) => {
        // not finding any corresponding accentuation
        // does not contradict to continue looping
        const corresp = accentuations.find((other) => other.beat === a.beat);
        if (!corresp) return true;

        return Math.round(a.value) === Math.round(corresp.value);
      });

      const scaleWithinRange =
        Math.abs(currentScale - prototypeScale) <= this.options.scaleTolerance;

      if (!hasSameBeatStructure || !scaleWithinRange) {
        break;
      }

      scale = (scale * cellsInMean + currentScale) / (cellsInMean + 1);
      cellsInMean++;
      acceptedThrough = currentCell.end;
    }

    const accentuationPatternDef = this.buildDef(
      this.options.name,
      ((cell.end - cell.start) / PULSES_PER_WHOLE) * (msm.timeSignature?.denominator || 4),
      accentuations,
    );

    insertDefinition(mpm, 'accentuationPatternDef', accentuationPatternDef, this.options.scope);

    const loop = acceptedThrough > cell.end;
    const map = requireMap(mpm, 'accentuationPattern', this.options.scope);
    map.addAccentuationPattern({
      accentuationPatternDefName: accentuationPatternDef.getName(),
      id: generateId('accentuationPattern', cell.start, mpm),
      date: cell.start,
      scale,
      loop: loop || undefined,
    });

    if (loop) {
      map.addAccentuationPattern({
        accentuationPatternDefName: 'neutral',
        date: acceptedThrough,
        id: generateId('accentuationPattern', acceptedThrough, mpm),
        scale: 0,
        loop: undefined,
      });
    }

    ensureDefaultStyle(mpm, 'accentuationPattern', this.options.scope);
  }
}
