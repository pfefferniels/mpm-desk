import { createContext, useContext, useMemo, useCallback, useState, ReactNode, SetStateAction } from 'react';

interface SelectionContextValue {
    /** Ids of the selected spans — i.e. of the MPM elements they lead with. */
    activeSpanIds: Set<string>;
    setActiveSpanIds: (ids: SetStateAction<Set<string>>) => void;
    toggleActiveSpan: (id: string) => void;
    focusSpan: (id: string) => void;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

/**
 * Which spans are selected.
 *
 * Kept in a context rather than threaded down because the lanes that set it sit
 * one component below every segment onion, and there are ~128 of those: the
 * callbacks here are stable so a selection change re-renders the onions that
 * contain the span, not all of them.
 */
export const SelectionProvider = ({ children }: { children: ReactNode }) => {
    const [activeSpanIds, setActiveSpanIds] = useState<Set<string>>(new Set());

    const toggleActiveSpan = useCallback((id: string) => {
        setActiveSpanIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const focusSpan = useCallback((id: string) => {
        setActiveSpanIds(new Set([id]));
    }, []);

    const value = useMemo<SelectionContextValue>(() => ({
        activeSpanIds,
        setActiveSpanIds,
        toggleActiveSpan,
        focusSpan,
    }), [activeSpanIds, toggleActiveSpan, focusSpan]);

    return (
        <SelectionContext value={value}>
            {children}
        </SelectionContext>
    );
};

export const useSelection = (): SelectionContextValue => {
    const context = useContext(SelectionContext);
    if (!context) {
        throw new Error('useSelection must be used within a SelectionProvider');
    }
    return context;
};
