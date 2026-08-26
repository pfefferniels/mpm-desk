import { memo } from "react";

const TICKS_PER_BEAT = 720;
const ANACRUSIS_OFFSET = TICKS_PER_BEAT; // upbeat of one quarter note
const TICKS_PER_BAR = 4 * TICKS_PER_BEAT; // hardcoded 4/4 for now
const TICKS_PER_EIGHTH = TICKS_PER_BEAT / 2;

const MIN_SPACING_PX = 20;
const FADE_SPACING_PX = 50;

/** Where the number sits under the graduation it belongs to. */
const LABEL_BASELINE = 15;

function lodOpacity(pixelSpacing: number): number {
    return Math.min(1, Math.max(0, (pixelSpacing - MIN_SPACING_PX) / (FADE_SPACING_PX - MIN_SPACING_PX)));
}

interface BarLinesProps {
    maxDate: number;
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

export const BarLines = memo(function BarLines({ maxDate, stretchX, centreY, anchorRef }: BarLinesProps) {
    // LOD opacity for finer subdivisions
    const beatOpacity = lodOpacity(TICKS_PER_BEAT * stretchX);
    const subbeatOpacity = lodOpacity(TICKS_PER_EIGHTH * stretchX);

    // Finest visible interval determines iteration step
    const finestInterval = subbeatOpacity > 0 ? TICKS_PER_EIGHTH
                         : beatOpacity > 0 ? TICKS_PER_BEAT
                         : TICKS_PER_BAR;

    // Adaptive bar label frequency based on spacing
    const barPx = TICKS_PER_BAR * stretchX;
    const labelEvery = barPx < 50 ? 8 : barPx < 100 ? 4 : barPx < 200 ? 2 : 1;

    // Generate tick marks
    const ticks: { tick: number; lineH: number; opacity: number; label?: number }[] = [];

    for (let tick = ANACRUSIS_OFFSET; tick <= maxDate; tick += finestInterval) {
        const offset = tick - ANACRUSIS_OFFSET;
        const isBar = offset % TICKS_PER_BAR === 0;
        const isBeat = !isBar && offset % TICKS_PER_BEAT === 0;

        if (isBar) {
            const barIndex = offset / TICKS_PER_BAR + 1;
            ticks.push({
                tick,
                lineH: 6,
                opacity: 1,
                label: barIndex % labelEvery === 0 ? barIndex : undefined,
            });
        } else if (isBeat) {
            ticks.push({ tick, lineH: 3, opacity: beatOpacity });
        } else {
            ticks.push({ tick, lineH: 2, opacity: subbeatOpacity });
        }
    }

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
