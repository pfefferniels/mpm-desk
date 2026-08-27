import { createContext, useContext } from 'react';

/**
 * How far the horizontal zoom goes, and in what steps.
 *
 * One quantity, so one place. These were four separate sets of literals — the pinch handler's own
 * `MIN_STRETCH`/`MAX_STRETCH`, the viewer toolbar's zoom slider, and the fit-to-window clamp the
 * viewer applies once on load — which meant a pinch could reach a zoom the slider had no position
 * for, and a widened range would have had to be found in four files by grepping for `60`.
 *
 * The unit is the raw `stretchX` the context carries: pixels per 200 ticks, the physical zoom.
 * `ZOOM_STEP` is the slider's granularity only; pinching is continuous within the bounds.
 */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 60;
export const ZOOM_STEP = 0.5;

interface ZoomContextValue {
    symbolic: {
        stretchX: number
    },
    physical: {
        stretchX: number
    },
    setStretchX: (value: number) => void
}

export const ZoomContext = createContext<ZoomContextValue>({
    symbolic: {
        stretchX: 20
    },
    physical: {
        stretchX: 20
    },
    setStretchX: () => {}
});

// Helper hooks

export const useSymbolicZoom = (): number => {
    const context = useContext(ZoomContext);
    if (!context) {
        throw new Error('useZoom must be used within a ZoomProvider');
    }
    return context.symbolic.stretchX;
};

export const usePhysicalZoom = (): number => {
    const context = useContext(ZoomContext);
    if (!context) {
        throw new Error('useZoom must be used within a ZoomProvider');
    }
    return context.physical.stretchX;
};

export const useZoom = () => {
    const context = useContext(ZoomContext);
    if (!context) {
        throw new Error('useZoom must be used within a ZoomProvider');
    }
    return { stretchX: context.physical.stretchX, setStretchX: context.setStretchX };
};

