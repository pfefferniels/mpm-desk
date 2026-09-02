/**
 * Drawing a `<dynamics>` or `<movement>` transition: where to sample it, and the area path that
 * comes out of the samples. Shared by the dynamics and pedal desks, which draw the same curve
 * against different baselines.
 */

/** One sampled point of a transition: where it sits on screen, and what the curve holds there. */
export interface TransitionSample {
  /** The sample's x, in pixels. */
  readonly x: number;
  /** The transition's value there, in the instruction's own units. */
  readonly value: number;
}

/** A point of the drawn outline, both coordinates in pixels. */
export interface AreaPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The points a transition needs in order to be drawn at `stretchX` pixels per tick.
 *
 * The step is a property of the zoom rather than of the score's grid. Sampling once per tick put
 * between 3 and 200 points on every screen pixel across the symbolic zoom range, and 144,183
 * points on the pedal desk over the shipped fixture; nothing finer than a pixel can be shown.
 * See issue #31.
 *
 * A span whose endpoints agree is constant — `transitionValueAt` answers `from` for the whole of
 * it — and the curve is monotone between two differing endpoints, so equal ones are an exact test
 * for a flat stretch and two points describe it. That is the gap between one pedal's release and
 * the next one's press, which is most of what the pedal desk draws.
 */
export const sampleTransition = (
  span: { date: number; endDate: number },
  valueAt: (date: number) => number,
  stretchX: number,
): TransitionSample[] => {
  if (!(span.endDate > span.date)) return [];

  const ticks = span.endDate - span.date;
  const ends = [
    { x: span.date * stretchX, value: valueAt(span.date) },
    { x: span.endDate * stretchX, value: valueAt(span.endDate) },
  ];

  const width = ticks * stretchX;
  if (ends[0].value === ends[1].value || !(width > 1)) return ends;

  const steps = Math.ceil(width);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const date = span.date + (ticks * i) / steps;
    return { x: date * stretchX, value: valueAt(date) };
  });
};

/**
 * The filled area between a sampled transition and its baseline.
 *
 * `closed` decides whether the outline runs back along the baseline: the dynamics desk strokes
 * that edge, the pedal desk leaves it to the rail its lane already draws.
 */
export const areaPath = (
  points: readonly AreaPoint[],
  baselineY: number,
  { closed = false }: { closed?: boolean } = {},
): string => {
  const first = points.at(0);
  const last = points.at(-1);
  if (!first || !last) return '';

  return [
    `M ${first.x} ${baselineY}`,
    ...points.map((point) => `L ${point.x} ${point.y}`),
    `L ${last.x} ${baselineY}`,
    ...(closed ? ['Z'] : []),
  ].join(' ');
};
