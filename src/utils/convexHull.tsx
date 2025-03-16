// Convex Hull using the Monotone Chain algorithm
export const convexHull = (points: { x: number; y: number; }[]): { x: number; y: number; }[] => {
    if (points.length <= 1) return points.slice();
    // sort points by x, then y
    const pts = points.slice().sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
    const cross = (o: { x: number; y: number; }, a: { x: number; y: number; }, b: { x: number; y: number; }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower: { x: number; y: number; }[] = [];
    for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
            lower.pop();
        }
        lower.push(p);
    }
    const upper: { x: number; y: number; }[] = [];
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
