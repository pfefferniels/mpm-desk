import { DynamicsSegment } from "../dynamics/DynamicsDesk";
import { MouseEventHandler } from "react";
import { convexHull } from "../utils/convexHull";
import { InsertMetricalAccentuationOptions } from "mpmify";

interface PreviewProps {
    cell: Omit<InsertMetricalAccentuationOptions, 'scope'>;
    stretchX: number;
    getScreenY: (velocity: number) => number;
    segments: DynamicsSegment[];
    onClick: MouseEventHandler;
}

export const Preview = ({ cell, stretchX, getScreenY, segments, onClick }: PreviewProps) => {
    const cellPoints = segments
        .filter(s => s.date.start >= cell.start && s.date.start <= cell.end)
        .map(s => ({ x: s.date.start * stretchX, y: getScreenY(s.velocity) }));

    if (cellPoints.length === 1) {
        return (
            <circle
                cx={cellPoints[0].x}
                cy={cellPoints[0].y}
                r={5}
                fill="red"
                fillOpacity={0.5}
                onClick={onClick}
            />
        )
    }

    // Add boundaries at the cell's start and end with an estimated velocity.
    const leftVelocity = segments.find(s => s.date.start >= cell.start)?.velocity ?? 0.5;
    const rightVelocity = segments.slice().reverse().find(s => s.date.start <= cell.end)?.velocity ?? 0.5;

    cellPoints.unshift({ x: cell.start * stretchX, y: getScreenY(leftVelocity) });
    cellPoints.push({ x: cell.end * stretchX, y: getScreenY(rightVelocity) });

    const hull = convexHull(cellPoints);
    const pointsStr = hull.map(p => `${p.x},${p.y}`).join(" ");

    return (
        <polygon
            className='accentuationPreview'
            points={pointsStr}
            fill='red'
            fillOpacity={0.5}
            onClick={onClick}
        />
    );
}
