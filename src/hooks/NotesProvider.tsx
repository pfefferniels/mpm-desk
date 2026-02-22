// NotesContext.tsx
import { MsmNote } from 'mpmify';
import React, { createContext, useContext, ReactNode, useMemo, useCallback } from 'react';

interface NotesContextValue {
    notes: MsmNote[];
    slice: (start: number, end?: number) => MsmNote[];
}

const NotesContext = createContext<NotesContextValue | undefined>(undefined);

interface NotesProviderProps {
    notes: MsmNote[]
    children: ReactNode;
}

// Binary search to find first index where note.date >= target
function lowerBound(sortedNotes: MsmNote[], target: number): number {
    let lo = 0, hi = sortedNotes.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (sortedNotes[mid].date < target) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

export const NotesProvider: React.FC<NotesProviderProps> = ({ notes, children }) => {
    // Sort once when notes change, not on every slice call
    const sortedNotes = useMemo(() => {
        return notes.slice().sort((a, b) => a.date - b.date);
    }, [notes]);

    const slice = useCallback((start: number, end?: number) => {
        if (end && start > end) return [];

        // Use binary search instead of linear findIndex
        const firstIndex = lowerBound(sortedNotes, start);
        const lastIndex = end !== undefined
            ? lowerBound(sortedNotes, end)
            : sortedNotes.length;

        return sortedNotes.slice(firstIndex, lastIndex);
    }, [sortedNotes]);

    const value = useMemo(() => ({ notes, slice }), [notes, slice]);

    return (
        <NotesContext value={value}>
            {children}
        </NotesContext>
    );
};

// Custom hook to use the notes context
export const useNotes = (): NotesContextValue => {
    const context = useContext(NotesContext);
    if (!context) {
        throw new Error('useNotes must be used within a NotesProvider');
    }
    return context;
};
