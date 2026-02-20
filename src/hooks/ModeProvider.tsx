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
        <ModeContext value={{ isEditorMode }}>
            {children}
        </ModeContext>
    );
};

export const useMode = (): ModeContextValue => {
    return useContext(ModeContext);
};
