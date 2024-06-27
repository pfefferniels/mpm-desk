// NotesContext.tsx
import { MsmNote } from 'mpmify/lib/msm';
import React, { createContext, useContext, ReactNode } from 'react';

interface NotesContextValue {
    notes: MsmNote[];
    slice: (start: number, end?: number) => MsmNote[];
}

const NotesContext = createContext<NotesContextValue | undefined>(undefined);

interface NotesProviderProps {
    notes: MsmNote[]
    children: ReactNode;
}

export const NotesProvider: React.FC<NotesProviderProps> = ({ notes, children }) => {
    const slice = (start: number, end?: number) => {
        if (end && start > end) return []
        
        const sortedNotes = notes
            .slice()
            .sort((a, b) => a.date - b.date)
        const firstIndex = sortedNotes.findIndex(n => n.date >= start)
        const lastIndex = end
            ? sortedNotes.findIndex(n => n.date >= end)
            : sortedNotes.length - 1

        return sortedNotes.slice(firstIndex, lastIndex)
    };

    return (
        <NotesContext.Provider value={{ notes, slice }}>
            {children}
        </NotesContext.Provider>
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
