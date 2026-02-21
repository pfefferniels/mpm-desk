import type { ReactNode, SVGAttributes } from "react";

interface CounterScaledXGroupProps {
    x: number;
    y: number;
    stretchX: number;
    pointerEvents?: SVGAttributes<SVGGElement>["pointerEvents"];
    children: ReactNode;
}

/**
 * Keep child geometry visually stable while the parent SVG is stretched in X.
 */
export function CounterScaledXGroup({
    x,
    y,
    stretchX,
    pointerEvents,
    children,
}: CounterScaledXGroupProps) {
    const invStretchX = stretchX === 0 ? 1 : 1 / stretchX;
    return (
        <g
            pointerEvents={pointerEvents}
            transform={`translate(${x}, ${y}) scale(${invStretchX}, 1)`}
        >
            {children}
        </g>
    );
}
