import React, { createContext, useContext, useRef, useMemo, useCallback } from 'react';

interface ScrollSyncContextValue {
    register: (id: string, element: HTMLElement) => void;
    unregister: (id: string) => void;
}

const ScrollSyncContext = createContext<ScrollSyncContextValue | undefined>(undefined);

interface ScrollSyncProviderProps {
    children: React.ReactNode;
}

/**
 * ScrollSyncProvider synchronizes horizontal scroll position between registered elements.
 *
 * PERFORMANCE: This provider uses NO React state for scroll position.
 * All synchronization happens via direct DOM manipulation to avoid re-renders
 * of heavy SVG components during scrolling.
 */
export const ScrollSyncProvider: React.FC<ScrollSyncProviderProps> = ({ children }) => {
    // Registry of scrollable elements - Map<id, element>
    const registryRef = useRef<Map<string, HTMLElement>>(new Map());

    // Tracks which component initiated the current sync to prevent loops
    const scrollingSourceRef = useRef<string | null>(null);

    // Stores requestAnimationFrame ID for cleanup
    const rafIdRef = useRef<number | null>(null);

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
                    element.scrollLeft = scrollLeft;
                }
            });

            scrollingSourceRef.current = null;
            rafIdRef.current = null;
        });
    }, []);

    const handleScroll = useCallback((sourceId: string, element: HTMLElement) => {
        // If this scroll was triggered programmatically by us, ignore it
        if (scrollingSourceRef.current !== null) {
            return;
        }

        // Mark that we're the source of this sync
        scrollingSourceRef.current = sourceId;

        syncScroll(sourceId, element.scrollLeft);
    }, [syncScroll]);

    const register = useCallback((id: string, element: HTMLElement) => {
        // If other elements are registered, sync to their scroll position
        if (registryRef.current.size > 0) {
            const firstElement = registryRef.current.values().next().value;
            if (firstElement) {
                element.scrollLeft = firstElement.scrollLeft;
            }
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
    }), [register, unregister]);

    return (
        <ScrollSyncContext.Provider value={contextValue}>
            {children}
        </ScrollSyncContext.Provider>
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
