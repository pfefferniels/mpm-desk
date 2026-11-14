import { VELOCITY_TICK, type VelocityAxis } from '../velocityAxis';

/**
 * The velocity axis for the dynamics plot and the corrections desk's velocity plot.
 *
 * It draws in the plot's own coordinates, through the same {@link VelocityAxis} the plot draws
 * its dots with, so the desk can put it in a gutter beside the chart and the ticks still line up
 * with the curves.
 *
 * Everything but the axis line is drawn to the *left* of x = 0, so a viewBox ending at 0 puts the
 * axis flush against the chart and nothing spills over it. The axis runs the whole range the plot
 * shows and labels every tick in it. It ran from 10 to 80 whatever the plot held, and the notes of
 * WM 225 that the corrections took below 20 were drawn under the last tick and off the chart.
 */
export const VerticalScale = ({ axis, step = VELOCITY_TICK }: {
    axis: VelocityAxis;
    step?: number;
}) => {
    const ticks = [];
    for (let val = Math.ceil(axis.min / step) * step; val <= axis.max; val += step) {
        ticks.push(val);
    }

    const tickWidth = 10;
    const labelGap = 4;

    return (
        <>
            <line
                x1={0}
                y1={axis.y(axis.min)}
                x2={0}
                y2={axis.y(axis.max)}
                stroke="black"
                strokeWidth={1.5}
            />

            {ticks.map((val) => {
                const tickY = axis.y(val);
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
