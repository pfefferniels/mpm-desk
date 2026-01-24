import { createContext, useContext, ReactNode } from 'react';

interface ModeContextValue {
    isEditorMode: boolean;
}

const ModeContext = createContext<ModeContextValue>({ isEditorMode: false });

interface ModeProviderProps {
    children: ReactNode;
}

export const ModeProvider = ({ children }: ModeProviderProps) => {
    const isEditorMode = window.location.pathname === '/editor';

    return (
        <ModeContext.Provider value={{ isEditorMode }}>
            {children}
        </ModeContext.Provider>
    );
};

export const useMode = (): ModeContextValue => {
    return useContext(ModeContext);
};
