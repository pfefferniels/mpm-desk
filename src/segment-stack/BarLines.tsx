import { memo } from "react";
import { bars, type Bar } from "../fitting/timeSignature";
import { beatTicksAt, type Meter } from "../utils/score";

const MIN_SPACING_PX = 20;
const FADE_SPACING_PX = 50;

/** Where the number sits under the graduation it belongs to. */
const LABEL_BASELINE = 15;

function lodOpacity(pixelSpacing: number): number {
    return Math.min(1, Math.max(0, (pixelSpacing - MIN_SPACING_PX) / (FADE_SPACING_PX - MIN_SPACING_PX)));
}

interface Graduation {
    tick: number;
    lineH: number;
    opacity: number;
    label?: number;
}

/**
 * One bar's marks: its own line, then the beats and half-beats of the signature governing it,
 * as far down as the zoom can show them apart.
 *
 * Measured from the bar's own start rather than from tick 0, so an anacrusis needs no origin of
 * its own and a metre change needs no arithmetic — a bar knows where it begins and how long it
 * is, and the marks inside it follow.
 *
 * The beat is a denominator-note, which is what MSM states. In compound time that graduates 6/8
 * in eighths rather than in its two dotted beats; a ruler says where the notes fall, and which of
 * them are felt as beats is a reading the tree above it is already making.
 */
const marksIn = (bar: Bar, meter: Meter, stretchX: number, until: number): Graduation[] => {
    const beat = beatTicksAt(meter, bar.date);
    const subbeat = beat / 2;
    const beatOpacity = lodOpacity(beat * stretchX);
    const subbeatOpacity = lodOpacity(subbeat * stretchX);
    const step = subbeatOpacity > 0 ? subbeat : beatOpacity > 0 ? beat : bar.ticks;

    // Adaptive label frequency: the closer the bars, the fewer of them are named.
    const barPx = bar.ticks * stretchX;
    const labelEvery = barPx < 50 ? 8 : barPx < 100 ? 4 : barPx < 200 ? 2 : 1;
    const named = bar.number >= 1 && bar.number % labelEvery === 0;

    const marks = Math.max(0, Math.ceil((Math.min(bar.date + bar.ticks, until) - bar.date) / step));

    return Array.from({ length: marks }, (_, index) => {
        const tick = bar.date + index * step;
        if (index === 0) {
            return { tick, lineH: 6, opacity: 1, ...(named && { label: bar.number }) };
        }
        return (tick - bar.date) % beat === 0
            ? { tick, lineH: 3, opacity: beatOpacity }
            : { tick, lineH: 2, opacity: subbeatOpacity };
    });
};

interface BarLinesProps {
    maxDate: number;
    /**
     * The score's metre, which is what the ruler graduates: the bars are the map's own, counted
     * from where each signature takes effect.
     */
    meter: Meter;
    /**
     * The packing rung, not the live zoom — the ruler's own level of detail only
     * has to be right for roughly this zoom, and holding it still between rungs
     * is what keeps a drag from re-rendering a couple of hundred tick marks a
     * step. The numbers themselves ride {@link anchorRef}, so they stay true.
     */
    stretchX: number;
    /** The line the ruler graduates — the trunk, which the ticks straddle. */
    centreY: number;
    /** Pins a bar number to its tick; see `useTickAnchors`. */
    anchorRef: (tick: number) => (node: SVGGraphicsElement | null) => void;
}

export const BarLines = memo(function BarLines({ maxDate, meter, stretchX, centreY, anchorRef }: BarLinesProps) {
    const ticks = bars(meter.signatures, maxDate, 4 * meter.ppq)
        .flatMap(bar => marksIn(bar, meter, stretchX, maxDate));

    return (
        <g className="barLines" pointerEvents="none">
            {ticks.map(({ tick, lineH, opacity, label }) => (
                <g key={tick} opacity={opacity}>
                    <line
                        x1={tick}
                        y1={centreY - lineH / 2}
                        x2={tick}
                        y2={centreY + lineH / 2}
                        stroke="gray"
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                    />
                    {/* The tree grows over the trunk from both sides, so a number
                        carries its own bit of paper to be read on. */}
                    {label !== undefined && (
                        <text
                            ref={anchorRef(tick)}
                            x={0}
                            y={centreY + LABEL_BASELINE}
                            fontSize={12}
                            fill="gray"
                            textAnchor="middle"
                            stroke="white"
                            strokeWidth={3}
                            paintOrder="stroke"
                        >
                            {label}
                        </text>
                    )}
                </g>
            ))}
        </g>
    );
});
