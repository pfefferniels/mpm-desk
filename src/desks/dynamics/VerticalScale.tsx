/**
 * The velocity axis for the dynamics plot.
 *
 * It draws in the plot's own coordinates — y = (127 - velocity) * stretchY — so the desk can put
 * it in a gutter beside the chart and the ticks still line up with the curves.
 *
 * Two things keep it inside that gutter. Everything but the axis line is drawn to the *left* of
 * x = 0, so a viewBox ending at 0 puts the axis flush against the chart and nothing spills over
 * it. And `height` is the plot's height: the axis stops there instead of running off the bottom,
 * and a tick outside the plot is not drawn at all — the old scale ran from velocity 10, which at
 * the desk's stretch is some 30px below the last row it could label.
 */
export const VerticalScale = ({
    min, max, step, height, stretchY = 1,
}: {
    min: number;
    max: number;
    step: number;
    /** The height of the plot this labels, in pixels. */
    height: number;
    stretchY?: number;
}) => {
    const y = (velocity: number) => (127 - velocity) * stretchY;

    const ticks = [];
    for (let val = min; val <= max; val += step) {
        if (y(val) >= 0 && y(val) <= height) ticks.push(val);
    }

    const tickWidth = 10;
    const labelGap = 4;

    return (
        <>
            <line
                x1={0}
                y1={Math.min(y(min), height)}
                x2={0}
                y2={Math.max(y(max), 0)}
                stroke="black"
                strokeWidth={1.5}
            />

            {ticks.map((val) => {
                const tickY = y(val);
                return (
                    <g key={val}>
                        <line x1={-tickWidth} y1={tickY} x2={0} y2={tickY} stroke="black" />
                        {/* Anchored at the end, so a three-digit velocity grows away from the
                            tick instead of into it. */}
                        <text
                            x={-tickWidth - labelGap}
                            y={tickY}
                            dy=".32em"
                            textAnchor="end"
                            fontSize="8"
                        >
                            {Math.round(val)}
                        </text>
                    </g>
                );
            })}
        </>
    );
};
