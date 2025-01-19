import { useState } from "react";
import { DynamicsSegment } from "./DynamicsDesk";

interface DynamicsCircleProps {
    segment: DynamicsSegment;
    datePlayed: number | undefined;
    stretchX: number;
    stretchY: number;
    handlePlay: (from: number, to?: number) => void;
    handleClick: (e: MouseEvent, segment: DynamicsSegment) => void;
}
export const DynamicsCircle = ({ segment, datePlayed, stretchX, stretchY, handlePlay, handleClick }: DynamicsCircleProps) => {
    const [hovered, setHovered] = useState(false);

    return (
        <>
            {hovered && (
                <>
                    <line
                        x1={segment.date.start * stretchX}
                        x2={segment.date.start * stretchX}
                        y1={(127 - segment.velocity) * stretchY}
                        y2={127 * stretchY}
                        stroke='gray'
                        strokeWidth={1} />
                    <line 
                        x1={0}
                        x2={segment.date.start * stretchX}
                        y1={(127 - segment.velocity) * stretchY}
                        y2={(127 - segment.velocity) * stretchY}
                        stroke='gray'
                        strokeWidth={1} />
                    <text
                        x={segment.date.start * stretchX}
                        y={(127 - segment.velocity) * stretchY - 30}
                        textAnchor='start'
                        fill='black'
                        fontSize={10}
                    >
                        date: {segment.date.start}
                    </text>
                    <text
                        x={segment.date.start * stretchX}
                        y={(127 - segment.velocity) * stretchY - 20}
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
                cy={(127 - segment.velocity) * stretchY}
                r={3}
                fill={datePlayed === segment.date.start ? 'blue' : 'black'}
                fillOpacity={0.4}
                stroke={'black'}
                strokeWidth={segment.active ? 3 : 1}
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
