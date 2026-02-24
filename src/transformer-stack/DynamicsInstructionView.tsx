import { useMemo } from "react";
import {
    DynamicsWithEndDate,
    volumeAtDate,
    computeInnerControlPointsXPositions,
} from "mpmify";

const CHART_WIDTH = 240;
const CHART_HEIGHT = 100;
const PAD = 6;
const FADE_TICKS = 720;
const SAMPLE_STEP = 10;
const COLOR = "#2980b9";

interface DynamicsInstructionViewProps {
    dynamics: DynamicsWithEndDate[];
    focusedIndex: number;
}

export const DynamicsInstructionView = ({
    dynamics,
    focusedIndex,
}: DynamicsInstructionViewProps) => {
    const focused = dynamics[focusedIndex];
    const prev = focusedIndex > 0 ? dynamics[focusedIndex - 1] : null;
    const next =
        focusedIndex < dynamics.length - 1 ? dynamics[focusedIndex + 1] : null;

    const viewFrom = prev
        ? Math.max(prev.date, focused.date - FADE_TICKS)
        : focused.date;
    const viewTo = next
        ? Math.min(next.endDate, focused.endDate + FADE_TICKS)
        : focused.endDate;

    const { focusedPoints, prevPoints, nextPoints, volMin, volMax } =
        useMemo(() => {
            const sampleCurve = (
                instr: DynamicsWithEndDate,
                from: number,
                to: number
            ) => {
                const withCp = {
                    ...instr,
                    ...computeInnerControlPointsXPositions(
                        instr.curvature ?? 0.5,
                        instr.protraction ?? 0
                    ),
                };
                const pts: { tick: number; vol: number }[] = [];
                const clampedFrom = Math.max(instr.date, from);
                const clampedTo = Math.min(instr.endDate, to);
                for (let t = clampedFrom; t <= clampedTo; t += SAMPLE_STEP) {
                    pts.push({ tick: t, vol: volumeAtDate(withCp, t) });
                }
                if (pts.length > 0 && pts[pts.length - 1].tick < clampedTo) {
                    pts.push({ tick: clampedTo, vol: volumeAtDate(withCp, clampedTo) });
                }
                return pts;
            };

            const fp = sampleCurve(focused, viewFrom, viewTo);
            const pp = prev ? sampleCurve(prev, viewFrom, focused.date) : [];
            const np = next ? sampleCurve(next, focused.endDate, viewTo) : [];

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
        }, [focused, prev, next, viewFrom, viewTo]);

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

    const startVol =
        typeof focused.volume === "number"
            ? focused.volume
            : parseFloat(focused.volume);

    return (
        <svg width={CHART_WIDTH} height={CHART_HEIGHT} style={{ display: "block" }}>
            {/* Focused range background */}
            <rect
                x={tickToX(focused.date)}
                y={PAD}
                width={tickToX(focused.endDate) - tickToX(focused.date)}
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
                        x={tickToX(focused.date)}
                        y={volToY(startVol) - 6}
                        textAnchor="start"
                        fontSize={10}
                        fontWeight={600}
                        fill={COLOR}
                    >
                        {startVol.toFixed(0)}
                    </text>
                    {focused["transition.to"] != null && (
                        <text
                            x={tickToX(focused.endDate)}
                            y={volToY(focused["transition.to"]) - 6}
                            textAnchor="end"
                            fontSize={10}
                            fontWeight={600}
                            fill={COLOR}
                        >
                            {focused["transition.to"].toFixed(0)}
                        </text>
                    )}
                </>
            )}
        </svg>
    );
};
