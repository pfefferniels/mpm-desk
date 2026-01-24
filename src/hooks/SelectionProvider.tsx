import { createContext, useContext, useMemo, ReactNode } from 'react';
import { Transformer } from 'mpmify/lib/transformers/Transformer';

interface SelectionContextValue {
    activeTransformer: Transformer | undefined;
    activeElements: string[];
    setActiveTransformer: (transformer: Transformer | undefined) => void;
    setActiveElement: (elementId: string) => void;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

interface SelectionProviderProps {
    children: ReactNode;
    activeTransformer: Transformer | undefined;
    setActiveTransformer: (transformer: Transformer | undefined) => void;
    transformers: Transformer[];
}

export const SelectionProvider = ({
    children,
    activeTransformer,
    setActiveTransformer,
    transformers,
}: SelectionProviderProps) => {
    const activeElements = useMemo(() => {
        return activeTransformer?.created || [];
    }, [activeTransformer]);

    const setActiveElement = useMemo(() => {
        return (elementId: string) => {
            const correspondingTransformer = transformers.find(t => t.created.includes(elementId));
            if (correspondingTransformer) {
                setActiveTransformer(correspondingTransformer);
            }
        };
    }, [transformers, setActiveTransformer]);

    const value = useMemo(() => ({
        activeTransformer,
        activeElements,
        setActiveTransformer,
        setActiveElement,
    }), [activeTransformer, activeElements, setActiveTransformer, setActiveElement]);

    return (
        <SelectionContext.Provider value={value}>
            {children}
        </SelectionContext.Provider>
    );
};

export const useSelection = (): SelectionContextValue => {
    const context = useContext(SelectionContext);
    if (!context) {
        throw new Error('useSelection must be used within a SelectionProvider');
    }
    return context;
};
