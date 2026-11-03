import { articulationCharacter, type Articulated } from "./instructionShapes";
import { Caption } from "./Caption";

const CHART_WIDTH = 240;
const CHART_HEIGHT = 56;
const BAR_FROM = 50;
const BAR_TO = CHART_WIDTH - 10;
const WRITTEN_Y = 16;
const PLAYED_Y = 40;
const BAR = 10;
const MUTED = "#9ca3af";

interface ArticulationInstructionViewProps {
    /** The note's duration as written, in ticks. */
    written: number;
    played: Articulated;
    /** For a duration the articulation states in milliseconds. */
    msPerTick: number | null;
    color: string;
}

/**
 * A note as written and as the articulation plays it: two bars from the same onset, the played
 * one shifted by any delay, as long as it is held and as thick as it is loud.
 */
export const ArticulationInstructionView = ({ written, played, msPerTick, color }: ArticulationInstructionViewProps) => {
    const duration = played.durationMs !== null && msPerTick ? played.durationMs / msPerTick : played.duration;
    const from = Math.min(0, played.delay);
    const to = Math.max(written, played.delay + duration) * 1.04;
    const x = (tick: number) => BAR_FROM + ((tick - from) / (to - from || 1)) * (BAR_TO - BAR_FROM);
    const thickness = BAR * Math.min(1.8, Math.max(0.4, played.velocity));

    return (
        <>
            <svg width={CHART_WIDTH} height={CHART_HEIGHT} style={{ display: "block" }} role="img" aria-label="The note as written and as played">
                <text x={BAR_FROM - 8} y={WRITTEN_Y + 3.5} textAnchor="end" fontSize={10} fill={MUTED}>written</text>
                <text x={BAR_FROM - 8} y={PLAYED_Y + 3.5} textAnchor="end" fontSize={10} fill={color}>played</text>

                <rect x={x(0)} y={WRITTEN_Y - BAR / 2} width={x(written) - x(0)} height={BAR} rx={2} fill="none" stroke={MUTED} strokeWidth={1.2} />
                <line x1={x(written)} x2={x(written)} y1={WRITTEN_Y - BAR / 2} y2={PLAYED_Y + BAR / 2 + 3} stroke={MUTED} strokeDasharray="2 2" />
                <rect
                    x={x(played.delay)}
                    y={PLAYED_Y - thickness / 2}
                    width={Math.max(1.5, x(played.delay + duration) - x(played.delay))}
                    height={thickness}
                    rx={2}
                    fill={color}
                    fillOpacity={0.85}
                />
            </svg>
            <Caption color={color}>{articulationCharacter(played, written)}</Caption>
        </>
    );
};
