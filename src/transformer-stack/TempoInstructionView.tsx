import { useMemo } from "react";
import { getTempoAt, TempoWithEndDate } from "mpmify";

const CHART_WIDTH = 240;
const CHART_HEIGHT = 100;
const PAD = 6;
const FADE_TICKS = 720;
const SAMPLE_STEP = 10;

interface TempoInstructionViewProps {
    tempos: TempoWithEndDate[];
    focusedIndex: number;
}

export const TempoInstructionView = ({ tempos, focusedIndex }: TempoInstructionViewProps) => {
    const focused = tempos[focusedIndex];
    const prev = focusedIndex > 0 ? tempos[focusedIndex - 1] : null;
    const next = focusedIndex < tempos.length - 1 ? tempos[focusedIndex + 1] : null;

    // Determine the visible tick range: focused instruction + fade zones for adjacent
    const viewFrom = prev
        ? Math.max(prev.date, focused.date - FADE_TICKS)
        : focused.date;
    const viewTo = next
        ? Math.min(next.endDate, focused.endDate + FADE_TICKS)
        : focused.endDate;

    // Sample BPM curves
    const { focusedPoints, prevPoints, nextPoints, bpmMin, bpmMax } = useMemo(() => {
        const sampleCurve = (tempo: TempoWithEndDate, from: number, to: number) => {
            const pts: { tick: number; bpm: number }[] = [];
            const clampedFrom = Math.max(tempo.date, from);
            const clampedTo = Math.min(tempo.endDate, to);
            for (let t = clampedFrom; t <= clampedTo; t += SAMPLE_STEP) {
                pts.push({ tick: t, bpm: getTempoAt(t, tempo) });
            }
            if (pts.length > 0 && pts[pts.length - 1].tick < clampedTo) {
                pts.push({ tick: clampedTo, bpm: getTempoAt(clampedTo, tempo) });
            }
            return pts;
        };

        const fp = sampleCurve(focused, viewFrom, viewTo);
        const pp = prev ? sampleCurve(prev, viewFrom, focused.date) : [];
        const np = next ? sampleCurve(next, focused.endDate, viewTo) : [];

        const allBpms = [...fp, ...pp, ...np].map(p => p.bpm);
        const min = allBpms.length > 0 ? Math.min(...allBpms) : 100;
        const max = allBpms.length > 0 ? Math.max(...allBpms) : 120;

        return {
            focusedPoints: fp,
            prevPoints: pp,
            nextPoints: np,
            bpmMin: min,
            bpmMax: max,
        };
    }, [focused, prev, next, viewFrom, viewTo]);

    const bpmPadding = Math.max(2, (bpmMax - bpmMin) * 0.15);
    const yMin = bpmMin - bpmPadding;
    const yMax = bpmMax + bpmPadding;

    const plotW = CHART_WIDTH - PAD * 2;
    const plotH = CHART_HEIGHT - PAD * 2;

    const tickToX = (tick: number) => PAD + ((tick - viewFrom) / (viewTo - viewFrom)) * plotW;
    const bpmToY = (bpm: number) => PAD + (1 - (bpm - yMin) / (yMax - yMin)) * plotH;

    const toPolyline = (pts: { tick: number; bpm: number }[]) =>
        pts.map(p => `${tickToX(p.tick).toFixed(1)},${bpmToY(p.bpm).toFixed(1)}`).join(" ");

    const prevGradientId = "prev-fade";
    const nextGradientId = "next-fade";

    return (
        <svg width={CHART_WIDTH} height={CHART_HEIGHT} style={{ display: "block" }}>
            {/* Focused instruction range background */}
            <rect
                x={tickToX(focused.date)}
                y={PAD}
                width={tickToX(focused.endDate) - tickToX(focused.date)}
                height={plotH}
                fill="#16a085"
                fillOpacity={0.06}
            />

            {/* Gradient definitions for fading adjacent curves */}
            <defs>
                {prevPoints.length > 0 && (
                    <linearGradient id={prevGradientId} x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#16a085" stopOpacity={0} />
                        <stop offset="100%" stopColor="#16a085" stopOpacity={0.4} />
                    </linearGradient>
                )}
                {nextPoints.length > 0 && (
                    <linearGradient id={nextGradientId} x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#16a085" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#16a085" stopOpacity={0} />
                    </linearGradient>
                )}
            </defs>

            {/* Previous tempo curve (fading) */}
            {prevPoints.length > 1 && (
                <polyline
                    points={toPolyline(prevPoints)}
                    fill="none"
                    stroke={`url(#${prevGradientId})`}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            )}

            {/* Next tempo curve (fading) */}
            {nextPoints.length > 1 && (
                <polyline
                    points={toPolyline(nextPoints)}
                    fill="none"
                    stroke={`url(#${nextGradientId})`}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            )}

            {/* Focused tempo curve */}
            {focusedPoints.length > 1 && (
                <polyline
                    points={toPolyline(focusedPoints)}
                    fill="none"
                    stroke="#16a085"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            )}

            {/* Start/end BPM labels on focused curve */}
            {focusedPoints.length > 0 && (
                <>
                    <text
                        x={tickToX(focused.date)}
                        y={bpmToY(focused.bpm) - 6}
                        textAnchor="start"
                        fontSize={10}
                        fontWeight={600}
                        fill="#16a085"
                    >
                        {focused.bpm.toFixed(1)}
                    </text>
                    {focused["transition.to"] && (
                        <text
                            x={tickToX(focused.endDate)}
                            y={bpmToY(focused["transition.to"]) - 6}
                            textAnchor="end"
                            fontSize={10}
                            fontWeight={600}
                            fill="#16a085"
                        >
                            {focused["transition.to"].toFixed(1)}
                        </text>
                    )}
                </>
            )}
        </svg>
    );
};
