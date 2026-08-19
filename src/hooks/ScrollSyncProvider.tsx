import React, { createContext, useContext, useRef, useMemo, useCallback } from 'react';
import { useLatest } from './useLatest';

interface ScrollSyncContextValue {
    register: (id: string, element: HTMLElement) => void;
    unregister: (id: string) => void;
    scrollToDate: (date: number) => void;
    adjustScrollForZoom: (clientX: number, ratio: number) => void;
}

const ScrollSyncContext = createContext<ScrollSyncContextValue | undefined>(undefined);

interface ScrollSyncProviderProps {
    children: React.ReactNode;
    zoom: number;
}

/**
 * Keeps every registered horizontal scroller on the same tick.
 *
 * All positions live in symbolic time: scrollLeft is `tick * zoom` everywhere,
 * so syncing is a copy and `scrollToDate` is a multiplication.
 *
 * PERFORMANCE: This provider uses NO React state for scroll position.
 * All synchronization happens via direct DOM manipulation to avoid re-renders
 * of heavy SVG components during scrolling.
 */
export const ScrollSyncProvider: React.FC<ScrollSyncProviderProps> = ({ children, zoom }) => {
    const registryRef = useRef<Map<string, HTMLElement>>(new Map());

    // Records the scrollLeft value we programmatically set on each element.
    // When an echo scroll event fires, we match against this to suppress it.
    const expectedScrollRef = useRef<Map<string, number>>(new Map());

    // Stores requestAnimationFrame ID for cleanup
    const rafIdRef = useRef<number | null>(null);

    const zoomRef = useLatest(zoom);

    // Tolerance in pixels to avoid floating-point precision issues
    const SCROLL_TOLERANCE = 2;

    const syncScroll = useCallback((sourceId: string, scrollLeft: number) => {
        // Cancel any pending sync
        if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
        }

        rafIdRef.current = requestAnimationFrame(() => {
            registryRef.current.forEach((element, id) => {
                if (id === sourceId) return;

                // Only update if difference exceeds tolerance
                if (Math.abs(element.scrollLeft - scrollLeft) > SCROLL_TOLERANCE) {
                    expectedScrollRef.current.set(id, scrollLeft);
                    element.scrollLeft = scrollLeft;
                }
            });

            rafIdRef.current = null;
        });
    }, []);

    const handleScroll = useCallback((sourceId: string, element: HTMLElement) => {
        const expected = expectedScrollRef.current.get(sourceId);
        if (expected !== undefined) {
            // This scroll event matches what we programmatically set — it's an echo
            if (Math.abs(element.scrollLeft - expected) <= SCROLL_TOLERANCE) {
                expectedScrollRef.current.delete(sourceId);
                return;
            }
            // Position differs from expected — real user scroll, clear and proceed
            expectedScrollRef.current.delete(sourceId);
        }

        syncScroll(sourceId, element.scrollLeft);
    }, [syncScroll]);

    const scrollToDate = useCallback((date: number) => {
        if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
        }

        rafIdRef.current = requestAnimationFrame(() => {
            registryRef.current.forEach((element, id) => {
                const targetScrollLeft = Math.max(0, date * zoomRef.current - element.clientWidth / 2);

                if (Math.abs(element.scrollLeft - targetScrollLeft) > SCROLL_TOLERANCE) {
                    expectedScrollRef.current.set(id, targetScrollLeft);
                    element.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
                }
            });

            rafIdRef.current = null;
        });
    }, [zoomRef]);

    const adjustScrollForZoom = useCallback((clientX: number, ratio: number) => {
        registryRef.current.forEach((element, id) => {
            const rect = element.getBoundingClientRect();
            const localX = clientX - rect.left;
            const newScrollLeft = (element.scrollLeft + localX) * ratio - localX;
            expectedScrollRef.current.set(id, newScrollLeft);
            element.scrollLeft = newScrollLeft;
        });
    }, []);

    const register = useCallback((id: string, element: HTMLElement) => {
        // Adopt the scroll position of whatever is already registered
        for (const other of registryRef.current.values()) {
            element.scrollLeft = other.scrollLeft;
            break;
        }

        registryRef.current.set(id, element);

        // Attach passive scroll listener
        const scrollHandler = () => handleScroll(id, element);
        element.addEventListener('scroll', scrollHandler, { passive: true });

        // Store the handler on the element for cleanup
        (element as HTMLElement & { __scrollSyncHandler?: () => void }).__scrollSyncHandler = scrollHandler;
    }, [handleScroll]);

    const unregister = useCallback((id: string) => {
        const element = registryRef.current.get(id);
        if (element) {
            const handler = (element as HTMLElement & { __scrollSyncHandler?: () => void }).__scrollSyncHandler;
            if (handler) {
                element.removeEventListener('scroll', handler);
                delete (element as HTMLElement & { __scrollSyncHandler?: () => void }).__scrollSyncHandler;
            }
        }
        registryRef.current.delete(id);
    }, []);

    // Context value is stable - never changes after initial render
    const contextValue = useMemo(() => ({
        register,
        unregister,
        scrollToDate,
        adjustScrollForZoom,
    }), [register, unregister, scrollToDate, adjustScrollForZoom]);

    return (
        <ScrollSyncContext value={contextValue}>
            {children}
        </ScrollSyncContext>
    );
};

export const useScrollSync = (): ScrollSyncContextValue => {
    const context = useContext(ScrollSyncContext);
    if (!context) {
        throw new Error('useScrollSync must be used within a ScrollSyncProvider');
    }
    return context;
};
