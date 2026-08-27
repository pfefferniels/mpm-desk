import { useState } from "react";
import type { DynamicsSegment } from "./segments";

interface DynamicsCircleProps {
    segment: DynamicsSegment;
    datePlayed: number | undefined;
    stretchX: number;
    screenY: (velocity: number) => number;
    handlePlay: (from: number, to?: number) => void;
    /**
     * A click on the dot, once it has sounded.
     *
     * Optional, because a plot that acts on the press has nothing left for the click to do — see
     * `onDragStart`.
     */
    handleClick?: (e: MouseEvent, segment: DynamicsSegment) => void;
    cursor?: string;
    /**
     * The press, with the event rather than just its `clientY`.
     *
     * A plot where the dot can be dragged has to act here rather than on the click: a drag that
     * ends off the dot fires no click on it at all, so a selection made on click would be missing
     * for exactly the gesture that needs it. The modifier keys come with the event for the same
     * reason — cmd and shift mean something at the moment of the press.
     */
    onDragStart?: (segment: DynamicsSegment, event: React.MouseEvent<SVGCircleElement>) => void;
    yOffset?: number;
}
export const DynamicsCircle = ({ segment, datePlayed, stretchX, screenY, handlePlay, handleClick, cursor, onDragStart, yOffset = 0 }: DynamicsCircleProps) => {
    const [hovered, setHovered] = useState(false);

    const y = screenY(segment.velocity) + yOffset;

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
                onMouseDown={onDragStart ? (e) => {
                    e.preventDefault();
                    onDragStart(segment, e);
                } : undefined}
                onMouseOver={() => {
                    setHovered(true);
                    handlePlay(segment.date.start, segment.date.start + 1);
                }}
                onMouseOut={() => setHovered(false)}
                onClick={(e) => {
                    handlePlay(segment.date.start);
                    handleClick?.(e as unknown as MouseEvent, segment);
                }} />
        </>
    );
};
