import type { TemporalSpread } from "espressivo";

/** A spread's frame as plain numbers in one unit. */
export interface SpreadFrame {
    start: number;
    length: number;
}

/**
 * The frame of `spread` in `unit`, or undefined when its length is counted in another one.
 *
 * An offset in a unit other than the length's is dropped, as the renderer drops it.
 */
export const frameIn = (spread: TemporalSpread, unit: 'ticks' | 'milliseconds'): SpreadFrame | undefined => {
    const { offset, length } = spread.getFrame();
    if (length.domain !== unit) return undefined;
    return { start: offset.domain === unit ? offset.value : 0, length: length.value };
};
