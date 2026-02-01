import { createContext, useContext, useMemo, useCallback, ReactNode } from 'react';
import { Transformer } from 'mpmify/lib/transformers/Transformer';

interface SelectionContextValue {
    activeTransformer: Transformer | undefined;
    activeElements: string[];
    setActiveTransformer: (transformer: Transformer | undefined) => void;
    setActiveElement: (elementId: string) => void;
    removeTransformer: (transformer: Transformer) => void;
    replaceTransformer: (transformer: Transformer) => void;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

interface SelectionProviderProps {
    children: ReactNode;
    activeTransformer: Transformer | undefined;
    setActiveTransformer: (transformer: Transformer | undefined) => void;
    transformers: Transformer[];
    setTransformers: (transformers: Transformer[]) => void;
}

export const SelectionProvider = ({
    children,
    activeTransformer,
    setActiveTransformer,
    transformers,
    setTransformers,
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

    const removeTransformer = useCallback((transformer: Transformer) => {
        const filtered = transformers.filter(t => t.id !== transformer.id);
        setTransformers(filtered);
        if (activeTransformer?.id === transformer.id) {
            setActiveTransformer(undefined);
        }
    }, [transformers, setTransformers, activeTransformer, setActiveTransformer]);

    const replaceTransformer = useCallback((transformer: Transformer) => {
        const index = transformers.findIndex(t => t.id === transformer.id);
        if (index === -1) return;
        const updated = [...transformers];
        updated[index] = transformer;
        setTransformers(updated);
    }, [transformers, setTransformers]);

    const value = useMemo(() => ({
        activeTransformer,
        activeElements,
        setActiveTransformer,
        setActiveElement,
        removeTransformer,
        replaceTransformer,
    }), [activeTransformer, activeElements, setActiveTransformer, setActiveElement, removeTransformer, replaceTransformer]);

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
