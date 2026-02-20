import React, { createContext, useContext, useRef, useMemo, useCallback } from 'react';
import { useLatest } from './useLatest';

type ScrollDomain ='symbolic' | 'physical';

interface ScrollSyncContextValue {
    register: (id: string, element: HTMLElement, domain: ScrollDomain) => void;
    unregister: (id: string) => void;
    scrollToDate: (date: number) => void;
}

const ScrollSyncContext = createContext<ScrollSyncContextValue | undefined>(undefined);

interface ScrollSyncProviderProps {
    children: React.ReactNode;
    symbolicZoom: number;
    physicalZoom: number;
    tickToSeconds: ((tick: number) => number) | null;
    secondsToTick: ((seconds: number) => number) | null;
}

interface RegistryEntry {
    element: HTMLElement;
    domain: ScrollDomain;
}

/**
 * ScrollSyncProvider synchronizes horizontal scroll position between registered elements.
 * Supports two scroll domains (symbolic/physical) with non-linear cross-domain conversion.
 *
 * PERFORMANCE: This provider uses NO React state for scroll position.
 * All synchronization happens via direct DOM manipulation to avoid re-renders
 * of heavy SVG components during scrolling.
 */
export const ScrollSyncProvider: React.FC<ScrollSyncProviderProps> = ({
    children,
    symbolicZoom,
    physicalZoom,
    tickToSeconds,
    secondsToTick,
}) => {
    // Registry of scrollable elements - Map<id, { element, domain }>
    const registryRef = useRef<Map<string, RegistryEntry>>(new Map());

    // Records the scrollLeft value we programmatically set on each element.
    // When an echo scroll event fires, we match against this to suppress it.
    const expectedScrollRef = useRef<Map<string, number>>(new Map());

    // Stores requestAnimationFrame ID for cleanup
    const rafIdRef = useRef<number | null>(null);

    // Store converter props in refs so syncScroll always reads latest values
    const symbolicZoomRef = useLatest(symbolicZoom);
    const physicalZoomRef = useLatest(physicalZoom);
    const tickToSecondsRef = useLatest(tickToSeconds);
    const secondsToTickRef = useLatest(secondsToTick);

    // Tolerance in pixels to avoid floating-point precision issues
    const SCROLL_TOLERANCE = 2;

    const syncScroll = useCallback((sourceId: string, scrollLeft: number) => {
        // Cancel any pending sync
        if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
        }

        rafIdRef.current = requestAnimationFrame(() => {
            const sourceEntry = registryRef.current.get(sourceId);
            if (!sourceEntry) return;

            const sourceDomain = sourceEntry.domain;

            registryRef.current.forEach((entry, id) => {
                if (id === sourceId) return;

                let targetScrollLeft: number;

                if (entry.domain === sourceDomain) {
                    // Same domain: 1:1 copy
                    targetScrollLeft = scrollLeft;
                } else if (sourceDomain === 'symbolic' && tickToSecondsRef.current) {
                    // Symbolic → Physical
                    const tick = scrollLeft / symbolicZoomRef.current;
                    const seconds = tickToSecondsRef.current(tick);
                    targetScrollLeft = seconds * physicalZoomRef.current;
                } else if (sourceDomain === 'physical' && secondsToTickRef.current) {
                    // Physical → Symbolic
                    const seconds = scrollLeft / physicalZoomRef.current;
                    const tick = secondsToTickRef.current(seconds);
                    targetScrollLeft = tick * symbolicZoomRef.current;
                } else {
                    // No converter available: skip cross-domain sync
                    return;
                }

                // Only update if difference exceeds tolerance
                if (Math.abs(entry.element.scrollLeft - targetScrollLeft) > SCROLL_TOLERANCE) {
                    expectedScrollRef.current.set(id, targetScrollLeft);
                    entry.element.scrollLeft = targetScrollLeft;
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
            registryRef.current.forEach((entry, id) => {
                let targetScrollLeft: number;

                if (entry.domain === 'symbolic') {
                    targetScrollLeft = date * symbolicZoomRef.current - entry.element.clientWidth / 2;
                } else if (tickToSecondsRef.current) {
                    const seconds = tickToSecondsRef.current(date);
                    targetScrollLeft = seconds * physicalZoomRef.current - entry.element.clientWidth / 2;
                } else {
                    return;
                }

                targetScrollLeft = Math.max(0, targetScrollLeft);

                if (Math.abs(entry.element.scrollLeft - targetScrollLeft) > SCROLL_TOLERANCE) {
                    expectedScrollRef.current.set(id, targetScrollLeft);
                    entry.element.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
                }
            });

            rafIdRef.current = null;
        });
    }, []);

    const register = useCallback((id: string, element: HTMLElement, domain: ScrollDomain) => {
        // If other elements in the same domain are registered, sync to their scroll position
        for (const entry of registryRef.current.values()) {
            if (entry.domain === domain) {
                element.scrollLeft = entry.element.scrollLeft;
                break;
            }
        }

        registryRef.current.set(id, { element, domain });

        // Attach passive scroll listener
        const scrollHandler = () => handleScroll(id, element);
        element.addEventListener('scroll', scrollHandler, { passive: true });

        // Store the handler on the element for cleanup
        (element as HTMLElement & { __scrollSyncHandler?: () => void }).__scrollSyncHandler = scrollHandler;
    }, [handleScroll]);

    const unregister = useCallback((id: string) => {
        const entry = registryRef.current.get(id);
        if (entry) {
            const handler = (entry.element as HTMLElement & { __scrollSyncHandler?: () => void }).__scrollSyncHandler;
            if (handler) {
                entry.element.removeEventListener('scroll', handler);
                delete (entry.element as HTMLElement & { __scrollSyncHandler?: () => void }).__scrollSyncHandler;
            }
        }
        registryRef.current.delete(id);
    }, []);

    // Context value is stable - never changes after initial render
    const contextValue = useMemo(() => ({
        register,
        unregister,
        scrollToDate,
    }), [register, unregister, scrollToDate]);

    return (
        <ScrollSyncContext value={contextValue}>
            {children}
        </ScrollSyncContext>
    );
};

/**
 * Hook to participate in scroll synchronization.
 * Returns stable register/unregister functions that don't change between renders.
 */
export const useScrollSync = (): ScrollSyncContextValue => {
    const context = useContext(ScrollSyncContext);
    if (!context) {
        throw new Error('useScrollSync must be used within a ScrollSyncProvider');
    }
    return context;
};
