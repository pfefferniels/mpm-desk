import { useState } from "react";
import { DynamicsSegment } from "./DynamicsDesk";

interface DynamicsCircleProps {
    segment: DynamicsSegment;
    datePlayed: number | undefined;
    stretchX: number;
    screenY: (velocity: number) => number;
    handlePlay: (from: number, to?: number) => void;
    handleClick: (e: MouseEvent, segment: DynamicsSegment) => void;
    cursor?: string;
}
export const DynamicsCircle = ({ segment, datePlayed, stretchX, screenY, handlePlay, handleClick, cursor }: DynamicsCircleProps) => {
    const [hovered, setHovered] = useState(false);

    const y = screenY(segment.velocity);

    return (
        <>
            {hovered && (
                <>
                    <line
                        x1={segment.date.start * stretchX}
                        x2={segment.date.start * stretchX}
                        y1={y}
                        y2={screenY(0)}
                        stroke='gray'
                        strokeWidth={1} />
                    <line 
                        x1={0}
                        x2={segment.date.start * stretchX}
                        y1={y}
                        y2={y}
                        stroke='gray'
                        strokeWidth={1} />
                    <text
                        x={segment.date.start * stretchX}
                        y={y - 30}
                        textAnchor='start'
                        fill='black'
                        fontSize={10}
                    >
                        date: {segment.date.start}
                    </text>
                    <text
                        x={segment.date.start * stretchX}
                        y={y - 20}
                        textAnchor='start'
                        fill='black'
                        fontSize={10}
                    >
                        velocity: {segment.velocity}
                    </text>
                </>
            )}

            <circle
                data-date={segment.date.start}
                cx={segment.date.start * stretchX}
                cy={y}
                r={3}
                fill={datePlayed === segment.date.start ? 'blue' : 'black'}
                fillOpacity={0.4}
                stroke={'black'}
                strokeWidth={segment.active ? 3 : 1}
                style={cursor ? { cursor } : undefined}
                onMouseOver={() => {
                    setHovered(true);
                    handlePlay(segment.date.start, segment.date.start + 1);
                }}
                onMouseOut={() => setHovered(false)}
                onClick={(e) => {
                    handlePlay(segment.date.start);
                    handleClick(e as unknown as MouseEvent, segment);
                }} />
        </>
    );
};
