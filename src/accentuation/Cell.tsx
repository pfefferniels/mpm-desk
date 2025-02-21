import { AccentuationCell } from "mpmify";
import { DynamicsSegment } from "../dynamics/DynamicsDesk";

// Convex Hull using the Monotone Chain algorithm
const convexHull = (points: { x: number, y: number }[]): { x: number, y: number }[] => {
    if (points.length <= 1) return points.slice();
    // sort points by x, then y
    const pts = points.slice().sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
    const cross = (o: { x: number, y: number }, a: { x: number, y: number }, b: { x: number, y: number }) =>
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower: { x: number, y: number }[] = [];
    for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
            lower.pop();
        }
        lower.push(p);
    }
    const upper: { x: number, y: number }[] = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
            upper.pop();
        }
        upper.push(p);
    }
    // Remove duplicate endpoints
    lower.pop();
    upper.pop();
    return lower.concat(upper);
};

interface CellProps {
    cell: AccentuationCell;
    i: number;
    stretchX: number;
    getScreenY: (velocity: number) => number;
    segments: DynamicsSegment[];
    setCells: React.Dispatch<React.SetStateAction<AccentuationCell[]>>;
    setCurrentCell: React.Dispatch<React.SetStateAction<AccentuationCell | undefined>>;
}

export const Cell = ({ cell, stretchX, getScreenY, segments, setCells, setCurrentCell }: CellProps) => {
    const cellPoints = segments
        .filter(s => s.date.start >= cell.start && s.date.start <= cell.end)
        .map(s => ({ x: s.date.start * stretchX, y: getScreenY(s.velocity) }));

    // Add boundaries at the cell's start and end with an estimated velocity.
    const leftVelocity = segments.find(s => s.date.start >= cell.start)?.velocity ?? 0.5;
    const rightVelocity = segments.slice().reverse().find(s => s.date.start <= cell.end)?.velocity ?? 0.5;

    cellPoints.unshift({ x: cell.start * stretchX, y: getScreenY(leftVelocity) });
    cellPoints.push({ x: cell.end * stretchX, y: getScreenY(rightVelocity) });

    const hull = convexHull(cellPoints);
    const pointsStr = hull.map(p => `${p.x},${p.y}`).join(" ");

    return (
        <polygon
            points={pointsStr}
            fill="gray"
            fillOpacity={0.5}
            onClick={(e) => {
                if (e.altKey && e.shiftKey) {
                    setCells(prevCells => prevCells.filter(c => c !== cell));
                } else {
                    setCurrentCell(cell);
                }
            }}
        />
    );
}
