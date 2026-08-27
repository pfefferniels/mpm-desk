interface DeltaGhostProps {
    /** Where the recording had the event before it was corrected. The hollow dot goes here. */
    x1: number;
    y1: number;
    /** Where it sits now. */
    x2: number;
    y2: number;
    color: string;
    opacity?: number;
}

/**
 * The mark that says an event was moved by hand: a hollow dot where the recording had it, and a
 * dashed leader to where it is now.
 *
 * Drawn from two points rather than from a delta so that it serves both orientations — a velocity
 * correction displaces the dot vertically, an onset correction horizontally.
 *
 * Grey for a correction the chain has already run, blue for one that has been sent and is waiting
 * on the fit. Never interactive: it is evidence, and the event itself is the thing to click.
 */
export const DeltaGhost = ({ x1, y1, x2, y2, color, opacity = 0.6 }: DeltaGhostProps) => (
    <g pointerEvents="none">
        <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={color}
            strokeWidth={1}
            strokeDasharray="3 2"
            strokeOpacity={opacity * 0.85}
        />
        <circle
            cx={x1}
            cy={y1}
            r={3}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeOpacity={opacity}
        />
    </g>
);

/** A correction the chain has run. */
export const COMMITTED_GHOST = '#999';
/** A correction sent but not yet answered by a fit. */
export const PENDING_GHOST = 'hsl(220, 60%, 50%)';
