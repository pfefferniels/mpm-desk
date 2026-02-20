import { memo } from "react";

const TICKS_PER_BEAT = 720;
const ANACRUSIS_OFFSET = TICKS_PER_BEAT; // upbeat of one quarter note
const TICKS_PER_BAR = 4 * TICKS_PER_BEAT; // hardcoded 4/4 for now

interface BarLinesProps {
    maxDate: number;
    stretchX: number;
    height: number;
}

export const BarLines = memo(function BarLines({ maxDate, stretchX, height }: BarLinesProps) {
    const bars: { tick: number; index: number }[] = [];
    let index = 1;
    for (let tick = ANACRUSIS_OFFSET; tick <= maxDate; tick += TICKS_PER_BAR) {
        bars.push({ tick, index: index++ });
    }

    // Compute inverse scale for counter-scaling text in the non-uniform viewBox
    const invStretchX = 1 / stretchX;

    return (
        <g className="barLines">
            {bars.map(({ tick, index }) => (
                <g key={tick}>
                    <line
                        x1={tick}
                        y1={height - 6}
                        x2={tick}
                        y2={height}
                        stroke="gray"
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                    />
                    {index % 2 === 0 && (
                        <text
                            x={0}
                            y={height - 8}
                            fontSize={12}
                            fill="gray"
                            textAnchor="middle"
                            transform={`translate(${tick}, 0) scale(${invStretchX}, 1)`}
                        >
                            {index}
                        </text>
                    )}
                </g>
            ))}
        </g>
    );
});
