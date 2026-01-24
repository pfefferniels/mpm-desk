type Point = { x: number; y: number };

/**
 * Packs n equal circles inside a circle using a hex (triangular) lattice.
 * Fast, deterministic, and usually quite dense (not guaranteed globally optimal for every n).
 *
 * @param n        number of inner circles
 * @param R        outer circle radius
 * @param center   outer circle center (default {0,0})
 * @param rotation optional rotation in radians (default 0)
 */
export function packCirclesInCircle(
    n: number,
    R: number,
    center: Point = { x: 0, y: 0 },
    rotation: number = 0
) {
    if (!Number.isFinite(n) || n <= 0) return [];
    if (!Number.isFinite(R) || R <= 0) return [];

    if (n === 1) {
        return [{ x: center.x, y: center.y }];
    }

    // 2..6: single ring, equally spaced
    if (n <= 6) {
        const sin = Math.sin(Math.PI / n);
        const r = R / (1 + 1 / sin);
        const d = R - r; // distance from outer center to each inner center

        const centers: Point[] = [];
        for (let i = 0; i < n; i++) {
            const ang = rotation + (i * 2 * Math.PI) / n;
            centers.push({
                x: center.x + d * Math.cos(ang),
                y: center.y + d * Math.sin(ang),
            });
        }
        return centers;
    }

    // Smallest m such that 1 + 3m(m+1) >= n
    let m = 0;
    while (1 + 3 * m * (m + 1) < n) m++;

    // Inner radius that fits m rings: r = R / (2m + 1)
    const r = R / (2 * m + 1);
    const step = 2 * r; // lattice neighbor spacing

    // Hex axial directions (pointy-top axial coords)
    const dirs: Array<[number, number]> = [
        [1, 0],
        [1, -1],
        [0, -1],
        [-1, 0],
        [-1, 1],
        [0, 1],
    ];

    // Convert axial (q, s) to 2D (x, y) in a hex/triangular lattice
    // Using axial-to-pixel mapping (pointy-top):
    // x = step * (sqrt(3) * q + sqrt(3)/2 * s)
    // y = step * (3/2 * s)
    const SQRT3 = Math.sqrt(3);
    function axialToXY(q: number, s: number): Point {
        const x = step * (SQRT3 * q + (SQRT3 / 2) * s);
        const y = step * (1.5 * s);
        return { x, y };
    }

    function rotate(p: Point, ang: number): Point {
        if (ang === 0) return p;
        const c = Math.cos(ang);
        const si = Math.sin(ang);
        return { x: p.x * c - p.y * si, y: p.x * si + p.y * c };
    }

    const centers: Point[] = [];
    // Add center first
    centers.push({ x: center.x, y: center.y });
    if (n === 1) return centers;

    // Build rings 1..m in a spiral
    for (let k = 1; k <= m && centers.length < n; k++) {
        // Start position for ring k: move k steps in direction 4 (arbitrary convention)
        // This creates a consistent ring traversal.
        let q = dirs[4][0] * k;
        let s = dirs[4][1] * k;

        for (let side = 0; side < 6 && centers.length < n; side++) {
            const [dq, ds] = dirs[side];
            for (let i = 0; i < k && centers.length < n; i++) {
                const local = rotate(axialToXY(q, s), rotation);
                centers.push({ x: center.x + local.x, y: center.y + local.y });
                q += dq;
                s += ds;
            }
        }
    }

    // If n was big, m guarantees capacity, so centers should reach n.
    // But keep it safe:
    centers.length = Math.min(centers.length, n);

    return centers
}
