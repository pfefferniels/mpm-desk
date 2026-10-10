import type { Alignment } from '../alignment';
import type { Residual } from '../residual';

/** A span of the score, in ticks. Without a `to`, a single date. */
export interface Range {
  from: number;
  to?: number;
}

/** The span from a date over a length, or the date alone where the call states none. */
export const rangeAt = (date: number, length?: number): Range =>
  length === undefined ? { from: date } : { from: date, to: date + length };

/** From the earliest to the latest of the notes the score knows by these ids. */
export const rangeOfNotes = (noteIDs: readonly string[], msm: Alignment): Range | undefined => {
  const dates = noteIDs
    .map((id) => msm.getByID(id)?.date)
    .filter((date): date is number => date !== undefined);
  if (dates.length === 0) return undefined;
  return { from: Math.min(...dates), to: Math.max(...dates) };
};

/** A stretch hung on one end of a press, in ticks off that end. */
interface PressRamp {
  start: number;
  duration: number;
  direction: 'up' | 'down';
}

/**
 * The span of a recorded press, or of a ramp hung on it. Without a `pedal`, the span of every
 * press the residual can place.
 *
 * A press is measured in ticks off the score grid, so it has no place until the residual gives it
 * one. Without a residual, while the readings still stand side by side, a press has no range, as
 * a press no tempo covers does.
 */
export const rangeOfPress = (
  pedal: string | undefined,
  msm: Alignment,
  residual: Residual | undefined,
  ramp?: PressRamp,
): Range | undefined => {
  if (!residual) return undefined;

  const ranges = msm.pedals
    .filter((p) => pedal === undefined || p['xml:id'] === pedal)
    .map((p) => {
      const placed = residual.ofPedal(p);
      if (placed?.tickDate === undefined || placed.tickDuration === undefined) return undefined;
      if (!ramp) return { from: placed.tickDate, to: placed.tickDate + placed.tickDuration };
      const end = ramp.direction === 'up' ? placed.tickDate + placed.tickDuration : placed.tickDate;
      return { from: end + ramp.start, to: end + ramp.start + ramp.duration };
    })
    .filter((r): r is { from: number; to: number } => r !== undefined);

  if (ranges.length === 0) return undefined;
  return {
    from: Math.min(...ranges.map((r) => r.from)),
    to: Math.max(...ranges.map((r) => r.to)),
  };
};
