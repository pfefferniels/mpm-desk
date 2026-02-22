import { memo } from "react";

const TICKS_PER_BEAT = 720;
const ANACRUSIS_OFFSET = TICKS_PER_BEAT; // upbeat of one quarter note
const TICKS_PER_BAR = 4 * TICKS_PER_BEAT; // hardcoded 4/4 for now
const TICKS_PER_EIGHTH = TICKS_PER_BEAT / 2;

const MIN_SPACING_PX = 20;
const FADE_SPACING_PX = 50;

function lodOpacity(pixelSpacing: number): number {
    return Math.min(1, Math.max(0, (pixelSpacing - MIN_SPACING_PX) / (FADE_SPACING_PX - MIN_SPACING_PX)));
}

interface BarLinesProps {
    maxDate: number;
    stretchX: number;
    height: number;
}

export const BarLines = memo(function BarLines({ maxDate, stretchX, height }: BarLinesProps) {
    const invStretchX = 1 / stretchX;

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
        <g className="barLines">
            {ticks.map(({ tick, lineH, opacity, label }) => (
                <g key={tick} opacity={opacity}>
                    <line
                        x1={tick}
                        y1={height - lineH}
                        x2={tick}
                        y2={height}
                        stroke="gray"
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                    />
                    {label !== undefined && (
                        <text
                            x={0}
                            y={height - 8}
                            fontSize={12}
                            fill="gray"
                            textAnchor="middle"
                            transform={`translate(${tick}, 0) scale(${invStretchX}, 1)`}
                        >
                            {label}
                        </text>
                    )}
                </g>
            ))}
        </g>
    );
});
