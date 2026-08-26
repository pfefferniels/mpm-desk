import { useMemo } from "react";
import { dynamicsAt, spanEnd, type Dynamics, type Neighbourhood } from "../utils/mpm";
import type { Meter } from "../utils/score";

const CHART_WIDTH = 240;
const CHART_HEIGHT = 100;
const PAD = 6;
const FADE_TICKS = 720;
const SAMPLE_STEP = 10;
const COLOR = "#2980b9";

interface DynamicsInstructionViewProps {
    dynamics: Neighbourhood<Dynamics>;
    meter: Meter;
}

export const DynamicsInstructionView = ({
    dynamics,
    meter,
}: DynamicsInstructionViewProps) => {
    const { focused, previous, next } = dynamics;

    const focusedEnd = spanEnd(focused, meter);

    const viewFrom = previous
        ? Math.max(previous.startDate, focused.startDate - FADE_TICKS)
        : focused.startDate;
    const viewTo = next
        ? Math.min(spanEnd(next, meter), focusedEnd + FADE_TICKS)
        : focusedEnd;

    // `dynamicsAt` is the renderer's evaluator and the Bézier control points are already
    // derived and clamped onto the record (`x1`/`x2`), so `@curvature` and `@protraction`
    // need no interpretation here.
    const { focusedPoints, prevPoints, nextPoints, volMin, volMax } =
        useMemo(() => {
            const sampleCurve = (instr: Dynamics, from: number, to: number) => {
                const pts: { tick: number; vol: number }[] = [];
                const clampedFrom = Math.max(instr.startDate, from);
                const clampedTo = Math.min(spanEnd(instr, meter), to);
                for (let t = clampedFrom; t <= clampedTo; t += SAMPLE_STEP) {
                    pts.push({ tick: t, vol: dynamicsAt(instr, t) });
                }
                if (pts.length > 0 && pts[pts.length - 1].tick < clampedTo) {
                    pts.push({ tick: clampedTo, vol: dynamicsAt(instr, clampedTo) });
                }
                return pts;
            };

            const fp = sampleCurve(focused, viewFrom, viewTo);
            const pp = previous ? sampleCurve(previous, viewFrom, focused.startDate) : [];
            const np = next ? sampleCurve(next, focusedEnd, viewTo) : [];

            const allVols = [...fp, ...pp, ...np].map((p) => p.vol);
            const min = allVols.length > 0 ? Math.min(...allVols) : 60;
            const max = allVols.length > 0 ? Math.max(...allVols) : 80;

            return {
                focusedPoints: fp,
                prevPoints: pp,
                nextPoints: np,
                volMin: min,
                volMax: max,
            };
        }, [focused, previous, next, viewFrom, viewTo, focusedEnd, meter]);

    const volPadding = Math.max(2, (volMax - volMin) * 0.15);
    const yMin = volMin - volPadding;
    const yMax = volMax + volPadding;

    const plotW = CHART_WIDTH - PAD * 2;
    const plotH = CHART_HEIGHT - PAD * 2;

    const tickToX = (tick: number) =>
        PAD + ((tick - viewFrom) / (viewTo - viewFrom)) * plotW;
    const volToY = (vol: number) =>
        PAD + (1 - (vol - yMin) / (yMax - yMin)) * plotH;

    const toPolyline = (pts: { tick: number; vol: number }[]) =>
        pts
            .map(
                (p) =>
                    `${tickToX(p.tick).toFixed(1)},${volToY(p.vol).toFixed(1)}`
            )
            .join(" ");

    // As performed, not as written — see TempoInstructionView.
    const startVol = dynamicsAt(focused, focused.startDate);
    const endVol = dynamicsAt(focused, focusedEnd);

    return (
        <svg width={CHART_WIDTH} height={CHART_HEIGHT} style={{ display: "block" }}>
            {/* Focused range background */}
            <rect
                x={tickToX(focused.startDate)}
                y={PAD}
                width={tickToX(focusedEnd) - tickToX(focused.startDate)}
                height={plotH}
                fill={COLOR}
                fillOpacity={0.06}
            />

            <defs>
                {prevPoints.length > 0 && (
                    <linearGradient id="dyn-prev-fade" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor={COLOR} stopOpacity={0} />
                        <stop offset="100%" stopColor={COLOR} stopOpacity={0.4} />
                    </linearGradient>
                )}
                {nextPoints.length > 0 && (
                    <linearGradient id="dyn-next-fade" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor={COLOR} stopOpacity={0.4} />
                        <stop offset="100%" stopColor={COLOR} stopOpacity={0} />
                    </linearGradient>
                )}
            </defs>

            {/* Previous dynamics curve (fading) */}
            {prevPoints.length > 1 && (
                <polyline
                    points={toPolyline(prevPoints)}
                    fill="none"
                    stroke="url(#dyn-prev-fade)"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            )}

            {/* Next dynamics curve (fading) */}
            {nextPoints.length > 1 && (
                <polyline
                    points={toPolyline(nextPoints)}
                    fill="none"
                    stroke="url(#dyn-next-fade)"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            )}

            {/* Focused dynamics curve */}
            {focusedPoints.length > 1 && (
                <polyline
                    points={toPolyline(focusedPoints)}
                    fill="none"
                    stroke={COLOR}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            )}

            {/* Volume labels */}
            {focusedPoints.length > 0 && (
                <>
                    <text
                        x={tickToX(focused.startDate)}
                        y={volToY(startVol) - 6}
                        textAnchor="start"
                        fontSize={10}
                        fontWeight={600}
                        fill={COLOR}
                    >
                        {startVol.toFixed(0)}
                    </text>
                    {endVol !== startVol && (
                        <text
                            x={tickToX(focusedEnd)}
                            y={volToY(endVol) - 6}
                            textAnchor="end"
                            fontSize={10}
                            fontWeight={600}
                            fill={COLOR}
                        >
                            {endVol.toFixed(0)}
                        </text>
                    )}
                </>
            )}
        </svg>
    );
};
