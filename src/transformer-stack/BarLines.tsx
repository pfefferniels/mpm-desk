const TICKS_PER_BEAT = 720;
const ANACRUSIS_OFFSET = TICKS_PER_BEAT; // upbeat of one quarter note
const TICKS_PER_BAR = 4 * TICKS_PER_BEAT; // hardcoded 4/4 for now

interface BarLinesProps {
    maxDate: number;
    stretchX: number;
    height: number;
}

export function BarLines({ maxDate, stretchX, height }: BarLinesProps) {
    const bars: { tick: number; index: number }[] = [];
    let index = 1;
    for (let tick = ANACRUSIS_OFFSET; tick <= maxDate; tick += TICKS_PER_BAR) {
        bars.push({ tick, index: index++ });
    }

    return (
        <g className="barLines">
            {bars.map(({ tick, index }) => {
                const x = tick * stretchX;
                return (
                    <g key={tick}>
                        <line
                            x1={x}
                            y1={0}
                            x2={x}
                            y2={height}
                            stroke="gray"
                            strokeWidth={1}
                        />
                        <text
                            x={x + 4}
                            y={height - 8}
                            fontSize={12}
                            fill="gray"
                        >
                            b. {index}
                        </text>
                    </g>
                );
            })}
        </g>
    );
}
