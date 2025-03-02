import React from 'react';

interface VerticalScaleProps {
    stretchY: number;
    maxTempo: number;
}
export const VerticalScale: React.FC<VerticalScaleProps> = ({ stretchY, maxTempo }) => {
    const width = 2;

    const ticks = [];
    for (let i = 0; i <= maxTempo; i += Math.max(1, 20 / stretchY)) {
        ticks.push(
            <React.Fragment key={i}>
                <line
                    className='tick'
                    x1={-5}
                    y1={-i * stretchY}
                    x2={0}
                    y2={-i * stretchY}
                    stroke='black'
                    strokeWidth={1} />
                <text
                    x={-10}
                    y={-i * stretchY}
                    dy=".35em"
                    textAnchor="end"
                    fontSize="10"
                    fill="black"
                    fillOpacity={0.25}
                >
                    {i.toFixed(0)}
                </text>
            </React.Fragment>
        );
    }

    return (
        <>
            <line
                className='verticalScale'
                x1={0}
                y1={0}
                x2={0}
                y2={-maxTempo * stretchY}
                stroke='black'
                strokeWidth={width} />
            {ticks}
        </>
    );
};
