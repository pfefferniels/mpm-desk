import type { AddDynamicsOptions } from 'espressivo';
import {
  getInstructions,
  type InstructionOptions,
  Mpm,
  requireMap,
  type Scope,
  fillInAt,
} from '../../instructions/index';
import { Alignment } from '../../alignment';
import {
  AbstractTransformer,
  generateId,
  type ScopedTransformationOptions,
} from '../Transformer';
import { approximateDynamics, type DynamicsPoints } from './Approximation';
import type { WithEndDate } from '../tempo/tempoCalculations';

/**
 * A fitted `<dynamics>` plus the window it was fitted over.
 *
 * `endDate` is not an MPM attribute and is not in `AddDynamicsOptions`; it travels with the fit
 * only as far as {@link InsertDynamicsInstructions.transform}, which takes it back off before the
 * record reaches the document.
 */
export type DynamicsWithEndDate = AddDynamicsOptions & WithEndDate;

export interface InsertDynamicsInstructionsOptions extends ScopedTransformationOptions {
  from: number;
  to: number;
  phantomVelocities: Map<number, number>;
}

export class InsertDynamicsInstructions extends AbstractTransformer<InsertDynamicsInstructionsOptions> {
  name = 'InsertDynamicsInstructions';
  requires = [];

  constructor(options?: InsertDynamicsInstructionsOptions) {
    super(
      options || {
        scope: 'global',
        from: 0,
        to: 0,
        phantomVelocities: new Map(),
      },
    );
  }

  protected transform(msm: Alignment, mpm: Mpm): void {
    const points = this.asPoints(msm, this.options.scope);
    const { from, to } = this.options;

    const relevantPoints = points.filter((p) => p.date >= from && p.date <= to);
    const fitted = approximateDynamics(relevantPoints);
    if (!fitted) return;

    // `endDate` is the window the curve was fitted over — a working field, not an MPM
    // attribute. It must not reach the document; a reader gets the span from the next
    // <dynamics> instead.
    //
    // This destructuring is the *only* thing keeping it out: espressivo writes what its
    // options type names, so a field left on the object here would be written. Taking it off
    // is load-bearing, not belt-and-braces.
    const { endDate: fittingWindow, ...fit } = fitted;
    const instruction: InstructionOptions<'dynamics'> = {
      ...fit,
      id: generateId('dynamics', fit.date, mpm),
    };

    // `fillInAt`, not `addDynamics`: in a chain, each segment's fit lands on the date the
    // previous segment's `closeTransition` already wrote a closing `<dynamics>` at. One
    // element has to carry both — the closing volume and this curve — or the closer sits in
    // front of the curve and shadows it.
    const map = requireMap(mpm, 'dynamics', this.options.scope);
    fillInAt(map, instruction, {
      localName: 'dynamics',
      add: (o) => map.addDynamics(o),
      read: (i) => map.getDynamicsOptionsOf(i),
      update: (i, patch) => map.updateDynamicsAt(i, patch),
    });
    this.closeTransition(mpm, instruction, fittingWindow);
  }

  /**
   * Write the instruction that ends the fitted transition.
   *
   * A `transition.to` with no successor is not a curve stretched to the end of the piece —
   * the renderer drops the transition and holds `volume`, so a fit that nothing happens to
   * follow describes nothing at all. Closing the span at the last point the curve was fitted
   * over is what makes the transition render, and it makes the rendered span the fitted one —
   * which is what the renderer needs, and with it every later fitter, since the residual is
   * derived from the rendered document.
   *
   * An instruction already at that date already closes the span — in a chain each segment is
   * closed by the next — and is left alone.
   */
  private closeTransition(mpm: Mpm, instruction: AddDynamicsOptions, endDate: number) {
    const target = instruction.transitionTo;
    if (target === undefined || endDate <= instruction.date) return;

    const existing = getInstructions(mpm, 'dynamics', this.options.scope);
    if (existing.some((dynamics) => dynamics.date === endDate)) return;

    requireMap(mpm, 'dynamics', this.options.scope).addDynamics({
      id: generateId('dynamics', endDate, mpm),
      date: endDate,
      volume: target,
    });
  }

  private asPoints(msm: Alignment, part: Scope): DynamicsPoints[] {
    const chords = msm.asChords(part);
    const { phantomVelocities } = this.options;

    // A phantom velocity is not tied to a chord. Pencilled in over a rest or inside a held note
    // it is a date the recording has nothing to say about, and the curve is to pass through it
    // all the same — so the two sets of dates are merged rather than the chords being walked.
    const dates = [...new Set([...chords.keys(), ...phantomVelocities.keys()])].sort(
      (a, b) => a - b,
    );

    return dates.flatMap((date) => {
      // Not dead, though the type says so: `AlignedNote.velocity` is declared `number` and
      // nothing in this package builds a note, so the declaration is the aligner's promise
      // rather than a fact. A note that arrives without one reaches the mean below as `NaN`.
      const notesWithVolume = (chords.get(date) ?? []).filter((n) => n.velocity !== undefined);

      // Where a chord sounds too, the phantom stands in for its mean whether or not it happens
      // to be `0` — `||` read a phantom of 0 as no phantom at all (issue #46). Where there is
      // neither, the mean is `0 / 0`: no chord to measure is not a velocity of NaN, and a point
      // with no velocity is not a point.
      const phantomVelocity = phantomVelocities.get(date);
      if (phantomVelocity === undefined && notesWithVolume.length === 0) return [];

      const velocity =
        phantomVelocity ??
        notesWithVolume.reduce((sum, curr) => sum + curr.velocity, 0) / notesWithVolume.length;

      return [{ date, velocity }];
    });
  }
}
