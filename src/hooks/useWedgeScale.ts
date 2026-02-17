import { useMemo } from 'react';
import { useSymbolicZoom } from './ZoomProvider';

/**
 * Configuration for wedge element scaling.
 * Base sizes are used at reference zoom (stretchX = 20, symbolic = 0.1).
 * Minimum sizes prevent elements from becoming too small at extreme zoom out.
 */
const WEDGE_SCALE_CONFIG = {
    referenceZoom: 0.1,
    bellowsStroke: { base: 2, min: 0.5 },
    tipRadius: { base: 8, min: 3 },
    tipRadiusExpanded: { base: 30, min: 12 },
    tipStroke: { base: 1, min: 0.5 },
    transformerRadius: { base: 10, min: 4 },
};

interface WedgeScale {
    /** Current scale factor (0 to 1) */
    scale: number;
    /** Bellows path stroke width */
    bellowsStroke: number;
    /** Tip circle radius when collapsed */
    tipRadius: number;
    /** Tip circle radius when expanded */
    tipRadiusExpanded: number;
    /** Tip circle stroke width */
    tipStroke: number;
    /** Transformer circle radius inside expanded tip */
    transformerRadius: number;
}

/**
 * Hook that provides zoom-scaled sizes for wedge visual elements.
 * Uses sqrt scaling for gentle reduction when zoomed out.
 * Scale is capped at 1.0 (elements never grow beyond base size).
 * All values are clamped to minimums to remain visible/interactive.
 */
export function useWedgeScale(): WedgeScale {
    const symbolicZoom = useSymbolicZoom();

    return useMemo(() => {
        // Sqrt scaling, capped at 1.0
        const scale = Math.min(1.0, Math.sqrt(symbolicZoom / WEDGE_SCALE_CONFIG.referenceZoom));

        // Helper to apply scaling with minimum clamp
        const scaled = (config: { base: number; min: number }) =>
            Math.max(config.min, config.base * scale);

        return {
            scale,
            bellowsStroke: scaled(WEDGE_SCALE_CONFIG.bellowsStroke),
            tipRadius: scaled(WEDGE_SCALE_CONFIG.tipRadius),
            tipRadiusExpanded: scaled(WEDGE_SCALE_CONFIG.tipRadiusExpanded),
            tipStroke: scaled(WEDGE_SCALE_CONFIG.tipStroke),
            transformerRadius: scaled(WEDGE_SCALE_CONFIG.transformerRadius),
        };
    }, [symbolicZoom]);
}
