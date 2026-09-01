import { DynamicsSegment } from "../dynamics/DynamicsDesk";
import { MouseEventHandler } from "react";
import { convexHull } from "../../utils/convexHull";
import { rangeOf, type Candidate } from "./candidate";

interface PreviewProps {
    candidate: Candidate;
    /** The date under the pointer, while the candidate's far end is still following it. */
    cursor?: number;
    height: number;
    stretchX: number;
    getScreenY: (velocity: number) => number;
    segments: DynamicsSegment[];
    onClick: MouseEventHandler;
}

/**
 * What the candidate covers, over the dots it is fitted to.
 *
 * Pending — one click made, the far end still on the cursor — it is drawn dashed and untouchable,
 * a promise about the next click rather than something to click on. The anchor keeps a solid line
 * of its own, so a candidate that covers a single date is on screen at all: a hull of one column
 * of dots has no area to fill.
 */
export const Preview = ({ candidate, cursor, height, stretchX, getScreenY, segments, onClick }: PreviewProps) => {
    const pending = candidate.to === undefined;
    const { from, to } = rangeOf(candidate, cursor);

    const cellPoints = segments
        .filter(s => s.date.start >= from && s.date.start <= to)
        .map(s => ({ x: s.date.start * stretchX, y: getScreenY(s.velocity) }));

    // Boundaries at the cell's own ends, with an estimated velocity: the outermost dots are
    // inside the range, so without these the drawn region stops short of what it covers.
    if (cellPoints.length > 1) {
        const leftVelocity = segments.find(s => s.date.start >= from)?.velocity ?? 0.5;
        const rightVelocity = segments.slice().reverse().find(s => s.date.start <= to)?.velocity ?? 0.5;
        cellPoints.unshift({ x: from * stretchX, y: getScreenY(leftVelocity) });
        cellPoints.push({ x: to * stretchX, y: getScreenY(rightVelocity) });
    }

    const hull = convexHull(cellPoints);
    const region = cellPoints.length === 1
        ? (
            <circle
                cx={cellPoints[0].x}
                cy={cellPoints[0].y}
                r={5}
                fill='red'
                fillOpacity={pending ? 0.25 : 0.5}
                onClick={pending ? undefined : onClick}
            />
        )
        : (
            <polygon
                className='accentuationPreview'
                points={hull.map(p => `${p.x},${p.y}`).join(' ')}
                fill='red'
                fillOpacity={pending ? 0.2 : 0.5}
                stroke={pending ? 'red' : undefined}
                strokeDasharray={pending ? '4 4' : undefined}
                onClick={pending ? undefined : onClick}
            />
        );

    if (!pending) return region;

    // The end still on the cursor. Where the pointer has gone the other way, that is the range's
    // start rather than its end.
    const free = candidate.from === from ? to : from;
    // Above the dots, but never above the plot: a loud enough residual puts a dot off the top,
    // and the readout is no use where it follows it out of view.
    const top = Math.max(cellPoints.reduce((highest, p) => Math.min(highest, p.y), getScreenY(0)), 10);

    return (
        <g className='pendingCandidate' pointerEvents='none'>
            {region}
            <line
                x1={candidate.from * stretchX}
                x2={candidate.from * stretchX}
                y1={0}
                y2={height}
                stroke='red'
                strokeOpacity={0.6}
                strokeWidth={1.5}
            />
            {to > from && (
                <>
                    <line
                        x1={free * stretchX}
                        x2={free * stretchX}
                        y1={0}
                        y2={height}
                        stroke='red'
                        strokeOpacity={0.6}
                        strokeWidth={1}
                        strokeDasharray='4 4'
                    />
                    <text
                        x={((from + to) / 2) * stretchX}
                        y={top - 8}
                        fontSize={10}
                        textAnchor='middle'
                        fill='gray'
                    >
                        {to - from}
                    </text>
                </>
            )}
        </g>
    );
}
