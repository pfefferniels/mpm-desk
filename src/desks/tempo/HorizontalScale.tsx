import React from 'react';

interface HorizontalScaleProps {
    stretchX: number;
    offset: number;
}

const HorizontalScale: React.FC<HorizontalScaleProps> = ({ stretchX, offset }) => {
    const width = 2;

    const ticks = [];
    const tickLength = 5;

    const adjustedTickInterval = 80 / stretchX;

    for (let i = 0; i <= offset; i += adjustedTickInterval) {
        const xPosition = stretchX * i;

        ticks.push(
            <g key={i} className='horizontalTick'>
                <line
                    x1={xPosition}
                    y1={0}
                    x2={xPosition}
                    y2={tickLength}
                    stroke='black'
                    strokeWidth={width}
                />
                <text
                    x={xPosition}
                    y={tickLength + 10}
                    fontSize='10'
                    textAnchor='middle'
                >
                    {i.toFixed(1)}s
                </text>
            </g>
        );
    }

    return (
        <>
            <line
                className='horizontalScale'
                x1={0}
                y1={0}
                x2={stretchX * offset}
                y2={0}
                stroke='black'
                strokeWidth={width}
            />
            {ticks}
        </>
    );
};

export default HorizontalScale;
