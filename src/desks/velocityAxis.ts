/**
 * The vertical extent of a plot of MIDI velocity, and where a velocity sits in it.
 *
 * Three plots draw velocity upwards: the dynamics desk, the corrections desk's velocity plot and
 * the dynamics gradient desk. Each drew it against a scale fixed in advance — the first two at
 * three pixels a step down from 127 at the head of a 320 pixel chart, the third from 0 to 100 —
 * and labelled a stretch of it chosen just as far in advance. On WM 225 that put the head of the
 * chart over velocities the recording never reaches, and the floor above the softest notes it
 * has: `Modify` takes some of them down to 8, so 59 of the 430 dots were drawn below
 * the chart and never seen, and the gradient desk ran its line past the end of its axis.
 *
 * So the extent is read off what the plot draws, and the axis labels the whole of it.
 */

/** Ticks are this many steps apart, and the range starts and ends on one. */
export const VELOCITY_TICK = 5;

/**
 * How many steps, at least, the range reaches past the softest and the loudest value drawn.
 *
 * A dot on the corrections desk is dragged within the range, so this is also how far the
 * outermost one can be taken in one drag.
 */
const PADDING = 5;

/**
 * The fewest steps a range spans, so a part struck at one velocity throughout is not magnified
 * until a single step is a hundred pixels.
 */
const MIN_SPAN = 30;

/**
 * Pixels kept clear at the head and the foot of the plot. A value on the very edge of the range
 * (velocity 0 or 127, which the range cannot reach past) still has its whole dot, and the label
 * on the outermost tick is not cut in half by the edge.
 */
const INSET = 8;

/** Where a plot of velocity puts what it draws. */
export interface VelocityAxis {
    /** The softest velocity shown, at the foot of the plot. */
    readonly min: number;
    /** The loudest velocity shown, at its head. */
    readonly max: number;
    /** How far apart two velocities one step apart are drawn, in the plot's units. */
    readonly perStep: number;
    /** Where `velocity` is drawn, measured down from the top of the plot. */
    readonly y: (velocity: number) => number;
    /** The velocity drawn at `y`; the inverse of {@link y}, for reading a pointer. */
    readonly velocityAt: (y: number) => number;
}

/**
 * The axis that shows every one of `velocities` on a plot `height` high.
 *
 * `velocities` is everything the plot draws, not just the dots: a ghost at the value the roll scan
 * read, a curve's ends, a guide pencilled in. Two plots handed the same values draw them at the
 * same heights. Values that are not finite numbers are passed over, and with none left the axis
 * is the whole MIDI range.
 */
export const velocityAxis = (velocities: Iterable<number>, height: number): VelocityAxis => {
    let low = Infinity;
    let high = -Infinity;
    for (const velocity of velocities) {
        if (!Number.isFinite(velocity)) continue;
        low = Math.min(low, velocity);
        high = Math.max(high, velocity);
    }
    if (low > high) {
        low = 0;
        high = 127;
    }

    low -= PADDING;
    high += PADDING;
    const short = MIN_SPAN - (high - low);
    if (short > 0) {
        low -= short / 2;
        high += short / 2;
    }

    // Past 0 or 127 there is nothing a velocity can be, and a tick labelled -5 would say there is.
    const min = Math.max(0, Math.floor(low / VELOCITY_TICK) * VELOCITY_TICK);
    const max = Math.min(127, Math.ceil(high / VELOCITY_TICK) * VELOCITY_TICK);
    const perStep = (height - 2 * INSET) / (max - min);

    return {
        min,
        max,
        perStep,
        y: (velocity) => INSET + (max - velocity) * perStep,
        velocityAt: (y) => max - (y - INSET) / perStep,
    };
};
