import { useMemo } from "react";
import { spanEnd, tempoAt, type Neighbourhood, type Tempo } from "../utils/mpm";
import type { Meter } from "../utils/score";

const CHART_WIDTH = 240;
const CHART_HEIGHT = 100;
const PAD = 6;
const FADE_TICKS = 720;
const SAMPLE_STEP = 10;

interface TempoInstructionViewProps {
    tempi: Neighbourhood<Tempo>;
    meter: Meter;
}

export const TempoInstructionView = ({ tempi, meter }: TempoInstructionViewProps) => {
    const { focused, previous, next } = tempi;

    const focusedEnd = spanEnd(focused, meter);

    // Determine the visible tick range: focused instruction + fade zones for adjacent
    const viewFrom = previous
        ? Math.max(previous.startDate, focused.startDate - FADE_TICKS)
        : focused.startDate;
    const viewTo = next
        ? Math.min(spanEnd(next, meter), focusedEnd + FADE_TICKS)
        : focusedEnd;

    // Sample BPM curves. `tempoAt` is the renderer's own evaluator, so what is drawn here
    // and what is heard cannot come apart — including the case where a last instruction's
    // `@transition.to` never takes effect because nothing follows to close its span.
    const { focusedPoints, prevPoints, nextPoints, bpmMin, bpmMax } = useMemo(() => {
        const sampleCurve = (tempo: Tempo, from: number, to: number) => {
            const pts: { tick: number; bpm: number }[] = [];
            const clampedFrom = Math.max(tempo.startDate, from);
            const clampedTo = Math.min(spanEnd(tempo, meter), to);
            for (let t = clampedFrom; t <= clampedTo; t += SAMPLE_STEP) {
                pts.push({ tick: t, bpm: tempoAt(tempo, t) });
            }
            if (pts.length > 0 && pts[pts.length - 1].tick < clampedTo) {
                pts.push({ tick: clampedTo, bpm: tempoAt(tempo, clampedTo) });
            }
            return pts;
        };

        const fp = sampleCurve(focused, viewFrom, viewTo);
        const pp = previous ? sampleCurve(previous, viewFrom, focused.startDate) : [];
        const np = next ? sampleCurve(next, focusedEnd, viewTo) : [];

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
    }, [focused, previous, next, viewFrom, viewTo, focusedEnd, meter]);

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

    // The endpoints as performed, not as written: a trailing `@transition.to` is inert, and
    // labelling it would name the most audible gesture in the file where there is none.
    const startBpm = tempoAt(focused, focused.startDate);
    const endBpm = tempoAt(focused, focusedEnd);

    return (
        <svg width={CHART_WIDTH} height={CHART_HEIGHT} style={{ display: "block" }}>
            {/* Focused instruction range background */}
            <rect
                x={tickToX(focused.startDate)}
                y={PAD}
                width={tickToX(focusedEnd) - tickToX(focused.startDate)}
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
                        x={tickToX(focused.startDate)}
                        y={bpmToY(startBpm) - 6}
                        textAnchor="start"
                        fontSize={10}
                        fontWeight={600}
                        fill="#16a085"
                    >
                        {startBpm.toFixed(1)}
                    </text>
                    {endBpm !== startBpm && (
                        <text
                            x={tickToX(focusedEnd)}
                            y={bpmToY(endBpm) - 6}
                            textAnchor="end"
                            fontSize={10}
                            fontWeight={600}
                            fill="#16a085"
                        >
                            {endBpm.toFixed(1)}
                        </text>
                    )}
                </>
            )}
        </svg>
    );
};
