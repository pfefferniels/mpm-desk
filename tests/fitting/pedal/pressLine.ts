import type { Travel } from '../../../src/performance/pedalTravel';
import type { TickVertex } from '../../../src/fitting/transformers/tempo/tickTimes';

/**
 * The first sustain press of WM 225 A as linked-rolls 0.7.0 renders it, thinned the way the
 * record is written: up in 191 ms, held, and down again from 2846 ms. The vertex at 2846 is the
 * one that ends the hold, kept for that reason and not for its step.
 */
export const MODELLED_PRESS: Travel = [
  [0, 0.04], [3, 0.11], [7, 0.17], [10, 0.24], [14, 0.29], [17, 0.35], [21, 0.4], [26, 0.46],
  [31, 0.53], [36, 0.58], [43, 0.65], [50, 0.7], [59, 0.76], [70, 0.82], [83, 0.87],
  [103, 0.93], [146, 0.98], [191, 1],
  [2846, 0.99], [2849, 0.93], [2853, 0.86], [2856, 0.8], [2860, 0.73], [2863, 0.68],
  [2867, 0.62], [2872, 0.55], [2877, 0.49], [2882, 0.43], [2889, 0.37], [2896, 0.31],
  [2905, 0.25], [2914, 0.2], [2926, 0.14], [2943, 0.09], [2976, 0.03], [3039, 0],
].map(([ms, position]) => ({ ms, position }));

/** A line on the tick grid at a steady tempo, `ticksPerMs` ticks to the millisecond. */
export const onGrid = (travel: Travel, ticksPerMs: number, fromTick = 0): TickVertex[] =>
  travel.map(({ ms, position }) => ({ date: fromTick + ms * ticksPerMs, ms, position }));
