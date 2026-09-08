import type { MovementMap, Normalized } from 'espressivo';
import { Mpm, requireMap } from '../../instructions/index';
import { Alignment, type AlignedPedal } from '../../alignment';
import { AbstractTransformer, type TransformationOptions } from '../Transformer';
import { TranslatePhysicalTimeToTicks } from '../tempo/index';
import { deriveResidual, type Residual } from '../../residual';
import { filterMap } from 'espressivo';
import type { TickVertex } from '../tempo/tickTimes';
import { approximateMovements, movementIds, type FittedMovement } from './approximateMovement';

/**
 * A pedal depth as `@position` and `@transition.to` are typed: espressivo's `Normalized`.
 *
 * The brand is compile-time only — `units.ts` is required to emit no JavaScript, so there is no
 * `asNormalized(n)` to call and a plain number reaches the option through an assertion. This is
 * the one place it is made. Nothing is checked here that was not already the caller's to promise:
 * a position is documented `[0..1]` on the record and on the options.
 */
const normalized = (value: number) => value as Normalized;

/** The press whose line is written; every press the residual can place, when absent. */
export interface FitPedalOptions extends TransformationOptions {
  pedal?: string;
}

/**
 * The shortcut, kept for calls already written: a ramp of stated length hung on one end of the
 * press, at a depth typed rather than read off the record.
 */
export interface PedalRampOptions extends FitPedalOptions {
  /** Relative to the end the ramp hangs off, in ticks. */
  start: number;
  /** In ticks. */
  duration: number;
  direction: 'up' | 'down';
  /** [0..1], default 1 */
  depth?: number;
}

export type InsertPedalOptions = FitPedalOptions | PedalRampOptions;

/** A press the residual could place on the score grid, line and all. */
interface PlacedPress {
  pedal: AlignedPedal;
  tickDate: number;
  tickDuration: number;
  tickTravel: readonly TickVertex[] | undefined;
}

const placedPresses = (
  msm: Alignment,
  residual: Residual,
  only: string | undefined,
): readonly PlacedPress[] =>
  filterMap(msm.pedals, (pedal) => {
    if (only && pedal['xml:id'] !== only) return null;
    const placed = residual.ofPedal(pedal);
    if (placed?.tickDate === undefined || placed.tickDuration === undefined) return null;
    return { pedal, tickDate: placed.tickDate, tickDuration: placed.tickDuration, tickTravel: placed.tickTravel };
  });

/**
 * Write a press's line as the movements the fit makes of it.
 *
 * A movement's `xml:id` names what it does to the pedal, so the narrative's chips read
 * `_down`, `_held`, `_up`, `_rest` rather than a count.
 */
const writeLine = (map: MovementMap, press: PlacedPress, line: readonly TickVertex[]) => {
  const fitted = approximateMovements(line);
  const ids = movementIds(press.pedal['xml:id'], fitted);
  fitted.forEach((movement: FittedMovement, i) => {
    map.addMovement({
      id: ids[i],
      date: movement.date,
      position: normalized(movement.position),
      ...(movement.transitionTo !== undefined && { transitionTo: normalized(movement.transitionTo) }),
      ...(movement.curvature !== undefined && { curvature: movement.curvature }),
      ...(movement.protraction !== undefined && { protraction: movement.protraction }),
      controller: press.pedal.type,
    });
  });
};

/** The shortcut's two movements: the ramp and the position it arrives at. */
const writeRamp = (map: MovementMap, press: PlacedPress, options: PedalRampOptions) => {
  // `??`, so a caller asking for a depth of `0` gets one. `||` reads it as "not given" and
  // substitutes a fully depressed pedal — the opposite of what was asked for (issue #46).
  const depth = normalized(options.depth ?? 1);
  const released = normalized(0);
  const id = press.pedal['xml:id'];
  const controller = press.pedal.type;

  if (options.direction === 'down') {
    map.addMovement({
      id: `${id}_start`,
      date: press.tickDate + options.start,
      position: released,
      transitionTo: depth,
      controller,
    });
    map.addMovement({
      id: `${id}_moveDown`,
      date: press.tickDate + options.start + options.duration,
      position: depth,
      controller,
    });
  } else {
    const endDate = press.tickDate + press.tickDuration;
    map.addMovement({
      id: `${id}_moveUp`,
      date: endDate + options.start,
      position: depth,
      transitionTo: released,
      controller,
    });
    map.addMovement({
      id: `${id}_end`,
      date: endDate + options.start + options.duration,
      position: released,
      controller,
    });
  }
};

/**
 * The pedalling, as `<movement>` elements fitted to the line each press recorded.
 *
 * The line is the record (`AlignedPedal.travel`, since `1dec582`), corrected where the roll got
 * it wrong on the corrections desk, and placed on the score grid by the residual. What is fitted
 * is only the bend of each traversal: where a press starts, how deep it goes, where it holds and
 * where it lifts are all read off the line. A press without a line is a switch, and is written
 * as the two constants a switch is.
 *
 * A call stating `direction` is one written before the line existed, and keeps the ramp it asked
 * for.
 */
export class InsertPedal extends AbstractTransformer<InsertPedalOptions> {
  name = 'InsertPedal';
  requires = [TranslatePhysicalTimeToTicks];

  constructor(options?: InsertPedalOptions) {
    super(options ?? {});
  }

  protected transform(msm: Alignment, mpm: Mpm): void {
    // Where each pedal fell on the score grid, under the MPM as it stands. `movement` is held
    // out for the same reason every other fitter holds its own dimension out, though it changes
    // nothing here: a movementMap moves controllers, not the pedal marks this reads. The tick
    // figures for pedals carry no rubato compensation — the warp is taken off notes only, which
    // `removeRubatoDistortion` records as a standing @todo.
    const residual = deriveResidual(msm, mpm, { without: ['movement'] });
    const map = requireMap(mpm, 'movement', 'global');
    const options = this.options;

    for (const press of placedPresses(msm, residual, options.pedal)) {
      if ('direction' in options) writeRamp(map, press, options);
      else if (press.tickTravel) writeLine(map, press, press.tickTravel);
    }
  }
}
