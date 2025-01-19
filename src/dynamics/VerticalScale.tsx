
export const VerticalScale = ({
    min, max, step, stretchY = 1,
}: {
    min: number;
    max: number;
    step: number;
    stretchY?: number;
}) => {
    const ticks = [];
    for (let val = min; val <= max; val += step) {
        ticks.push(val);
    }

    const tickWidth = 10;

    return (
        <>
            <line
                x1={0}
                y1={(127 - min) * stretchY}
                x2={0}
                y2={(127 - max) * stretchY}
                stroke="black"
                strokeWidth={1.5} />
            {ticks.map((val, i) => {
                const y = (127 - val) * stretchY;
                return (
                    <g key={i}>
                        <line x1={-tickWidth} y1={y} x2={0} y2={y} stroke="black" />
                        <text x={-tickWidth * 2} y={y + 3} fontSize="8">
                            {Math.round(val)}
                        </text>
                    </g>
                );
            })}
        </>
    );
};
