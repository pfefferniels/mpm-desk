import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react';
import { useZoom } from './ZoomProvider';
import { useScrollSync } from './ScrollSyncProvider';

const MIN_STRETCH = 1;
const MAX_STRETCH = 60;

function usePinchZoom() {
    const { stretchX, setStretchX } = useZoom();
    const { adjustScrollForZoom } = useScrollSync();

    const pendingAdjustment = useRef<{ clientX: number; ratio: number } | null>(null);

    // Apply scroll adjustment after React updates DOM with new zoom, before browser paints
    useLayoutEffect(() => {
        const adj = pendingAdjustment.current;
        if (!adj) return;
        pendingAdjustment.current = null;
        adjustScrollForZoom(adj.clientX, adj.ratio);
    }, [stretchX, adjustScrollForZoom]);

    // useEffectEvent: always reads latest stretchX without re-attaching listeners
    const applyZoom = useEffectEvent((zoomFactor: number, clientX: number) => {
        const newStretch = Math.min(MAX_STRETCH, Math.max(MIN_STRETCH, stretchX * zoomFactor));
        if (newStretch === stretchX) return;
        pendingAdjustment.current = { clientX, ratio: newStretch / stretchX };
        setStretchX(newStretch);
    });

    useEffect(() => {
        // Trackpad pinch: ctrlKey + wheel (macOS/Windows)
        const handleWheel = (e: WheelEvent) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            applyZoom(Math.exp(-e.deltaY * 0.01), e.clientX);
        };

        // Touch pinch: two-finger distance tracking
        let lastDistance: number | null = null;
        let lastCenterX: number | null = null;

        const getDistance = (t: TouchList) => {
            if (t.length < 2) return null;
            const dx = t[1].clientX - t[0].clientX;
            const dy = t[1].clientY - t[0].clientY;
            return Math.sqrt(dx * dx + dy * dy);
        };

        const getCenterX = (t: TouchList) =>
            t.length < 2 ? null : (t[0].clientX + t[1].clientX) / 2;

        const handleTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                lastDistance = getDistance(e.touches);
                lastCenterX = getCenterX(e.touches);
            } else {
                lastDistance = null;
                lastCenterX = null;
            }
        };

        const handleTouchMove = (e: TouchEvent) => {
            if (e.touches.length !== 2 || lastDistance === null) return;
            const d = getDistance(e.touches);
            if (d === null) return;
            e.preventDefault();
            const cx = getCenterX(e.touches) ?? lastCenterX ?? 0;
            applyZoom(d / lastDistance, cx);
            lastDistance = d;
            lastCenterX = cx;
        };

        const resetTouch = () => {
            lastDistance = null;
            lastCenterX = null;
        };

        document.addEventListener('wheel', handleWheel, { passive: false });
        document.addEventListener('touchstart', handleTouchStart, { passive: true });
        document.addEventListener('touchmove', handleTouchMove, { passive: false });
        document.addEventListener('touchend', resetTouch);
        document.addEventListener('touchcancel', resetTouch);

        return () => {
            document.removeEventListener('wheel', handleWheel);
            document.removeEventListener('touchstart', handleTouchStart);
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('touchend', resetTouch);
            document.removeEventListener('touchcancel', resetTouch);
        };
    }, [applyZoom]);
}

export const PinchZoomHandler = (): null => {
    usePinchZoom();
    return null;
};
