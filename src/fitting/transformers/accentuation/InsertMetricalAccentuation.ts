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
   * The beat is espressivo's own expression, `1 + (date − tsDate) % patternTicks / ticksPerBeat`
   * with `ticksPerBeat = 4 · ppq / denominator`, computed on the same tick — so the two agree
   * bit for bit, which matters: `AccentuationPatternDef.getAccentuationAt` tests a beat position
   * with `===` and interpolates where it misses. (Issue #42 reported the two halves disagreeing,
   * one of them reading beats back in quarters. The residual is derived by rendering the document
   * through espressivo, so the reader *is* the renderer and there is one grid to agree with.)
   *
   * The loop counts beats as integers and converts each to ticks once, rather than
   * accumulating `beat += beatLength`. A triplet basis is not representable in binary, so an
   * accumulated position drifts — and `notesAtDate` compares dates with `===`, so a drifted
   * date silently matches no note at all. Rounding to the tick is exact for every basis,
   * because score dates are integers in ticks.
   *
   * ## The phase is the time signature's, not the cell's
   *
   * The renderer counts from the date of the signature in force, in steps of the pattern's own
   * length (`@stickToMeasures="false"`, which {@link transform} writes) — never from the
   * instruction. So a cell whose start is a whole number of its own lengths from that date has
   * its first sample on beat 1, and one that is not begins mid-cycle: a cell of a dotted quarter
   * starting an eighth into the cycle opens on beat 1.5 and wraps round to beat 1 before it ends.
   *
   * Numbering the samples from the cell instead put the accentuations at beats the renderer
   * indexes elsewhere, which is a pattern sounding rotated against the one that was fitted —
   * 11 of the 50 cells in the shipped reconstruction, all of them the 1.5- and 2.5-beat readings
   * a hemiola is made of (issue #47).
   */
  private extractVelocities(
    { from: start, to: end, beatLength }: InsertMetricalAccentuationOptions,
    msm: Alignment,
    residual: Residual,
  ): Velocity[] {
    const velocities: Velocity[] = [];
    if (beatLength <= 0) return velocities;

    // A score may state no signature, and `Alignment.build()` publishes 4/4 where it does not;
    // espressivo starts a render at 4/4 from tick 0 for the same reason. Beats have to be
    // counted in the same metre the score will be published in, or the pattern would be indexed
    // against one nobody sees.
    const signature = msm.timeSignatureAt(start);
    const beatTicks = PULSES_PER_WHOLE / (signature?.denominator || 4);
    // The pattern's own length, which is the cell's: a cell of no length is no cycle to count in.
    const patternTicks = end - start;
    if (patternTicks <= 0) return velocities;

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
        beat: 1 + (((date - (signature?.date ?? 0)) % patternTicks) / beatTicks),
        avgVelocityChange,
      });
    }
    return velocities;
  }

  private calculateScale(velocities: Velocity[]) {
    return Math.max(...velocities.map((v) => Math.abs(v.avgVelocityChange)));
  }

  /**
   * The samples as one cycle of the pattern: an accentuation per beat, each ramping to the next.
   *
   * Ascending by beat, which is both the order `AccentuationPatternDef.getAccentuationAt` reads
   * them in — it walks the list assuming it ascends — and the order the ramps run along. A cell
   * that starts mid-cycle wraps, so beat order and the order the samples were taken in are not
   * the same, and a cell that starts on the cycle is unaffected: there the two coincide.
   *
   * The closing sample, taken at the cell's end, measures the beat the cycle wraps to one cycle
   * on. It is what the last accentuation ramps towards, which is what MPM does with it: the last
   * segment runs to `length + 1.0`, the same position as beat 1 of the next cycle. Where the cell
   * wraps, that closing sample measures some beat mid-pattern instead, and the wrap target is the
   * first accentuation of the cycle.
   */
  private calculateAccentuations(
    velocities: Velocity[],
    neutralEnd?: boolean,
  ): FittedAccentuation[] {
    const scale = this.calculateScale(velocities);
    if (scale === 0) return [];

    const cycle = velocities.slice(0, -1).sort((a, b) => a.beat - b.beat);
    const closing = velocities[velocities.length - 1];
    const first = cycle[0];
    if (first === undefined || closing === undefined) return [];

    const wrap = closing.beat === first.beat ? closing : first;

    return cycle.map((sample, index) => {
      const last = index === cycle.length - 1;
      const next = cycle[index + 1] ?? wrap;
      const scaled = sample.avgVelocityChange / scale;
      return {
        // The pattern this belongs to and the position in it, rather than a fresh uuid: a def
        // holds one accentuation per beat and no two defs share a name, so this is unique, and
        // it makes the same document twice (issue #48).
        id: `accentuation_${this.options.name}_${String(index)}`,
        beat: sample.beat,
        value: scaled,
        transitionFrom: scaled,
        transitionTo: last && neutralEnd ? 0 : next.avgVelocityChange / scale,
      };
    });
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

  /**
   * `@stickToMeasures="false"`, always, and it has to be said: MPM's default is `true`
   * (`accentuationPattern.xml`, `<defaultVal>true</defaultVal>`), which re-aligns the pattern at
   * every barline.
   *
   * A cell fitted here is not a bar. {@link extractVelocities} numbers the beats from the cell's
   * own start and the loop above repeats the cell on its own length, so what this writes is a
   * pattern cycling on `@length` — which is what `false` means, and what MPM's own remark
   * reserves it for. Left to the default, a pattern of one beat was read against a bar of four
   * and the beat the fitter measured was not the beat the renderer indexed.
   *
   * It is the phase, not the anchor: both branches of espressivo's
   * `renderMetricalAccentuationToMap` count from the date of the time signature in force, never
   * from the instruction. So this makes the two agree wherever a cell's offset from the signature
   * is a whole number of pattern lengths — 43 of the 54 patterns in the shipped performance,
   * against 19 under the default — and the rest are still read at a phase the desk did not fit.
   * See issue #47.
   */
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
      ((cell.end - cell.start) / PULSES_PER_WHOLE) *
        (msm.timeSignatureAt(cell.start)?.denominator || 4),
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
      stickToMeasures: false,
    });

    if (loop) {
      map.addAccentuationPattern({
        accentuationPatternDefName: 'neutral',
        date: acceptedThrough,
        id: generateId('accentuationPattern', acceptedThrough, mpm),
        scale: 0,
        loop: undefined,
        stickToMeasures: false,
      });
    }

    ensureDefaultStyle(mpm, 'accentuationPattern', this.options.scope);
  }
}
