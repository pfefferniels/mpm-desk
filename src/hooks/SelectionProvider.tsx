import { createContext, useContext, useMemo, useCallback, ReactNode, SetStateAction } from 'react';
import { Transformer } from 'mpmify/lib/transformers/Transformer';

interface SelectionContextValue {
    transformers: Transformer[];
    activeTransformerIds: Set<string>;
    activeElements: string[];
    setActiveTransformerIds: (ids: SetStateAction<Set<string>>) => void;
    toggleActiveTransformer: (id: string) => void;
    setActiveElement: (elementId: string) => void;
    removeTransformer: (transformer: Transformer) => void;
    removeActiveTransformers: () => void;
    replaceTransformer: (transformer: Transformer) => void;
    focusTransformer: (id: string) => void;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

interface SelectionProviderProps {
    children: ReactNode;
    activeTransformerIds: Set<string>;
    setActiveTransformerIds: (ids: SetStateAction<Set<string>>) => void;
    transformers: Transformer[];
    setTransformers: (transformers: Transformer[]) => void;
    focusTransformer: (id: string) => void;
}

export const SelectionProvider = ({
    children,
    activeTransformerIds,
    setActiveTransformerIds,
    transformers,
    setTransformers,
    focusTransformer,
}: SelectionProviderProps) => {
    const activeElements = useMemo(() => {
        if (activeTransformerIds.size === 0) return [];
        return transformers
            .filter(t => activeTransformerIds.has(t.id))
            .flatMap(t => t.created);
    }, [activeTransformerIds, transformers]);

    const toggleActiveTransformer = useCallback((id: string) => {
        const next = new Set(activeTransformerIds);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        setActiveTransformerIds(next);
    }, [activeTransformerIds, setActiveTransformerIds]);

    const setActiveElement = useCallback((elementId: string) => {
        const correspondingTransformer = transformers.find(t => t.created.includes(elementId));
        if (correspondingTransformer) {
            setActiveTransformerIds(new Set([correspondingTransformer.id]));
        }
    }, [transformers, setActiveTransformerIds]);

    const removeTransformer = useCallback((transformer: Transformer) => {
        const filtered = transformers.filter(t => t.id !== transformer.id);
        setTransformers(filtered);
        if (activeTransformerIds.has(transformer.id)) {
            const next = new Set(activeTransformerIds);
            next.delete(transformer.id);
            setActiveTransformerIds(next);
        }
    }, [transformers, setTransformers, activeTransformerIds, setActiveTransformerIds]);

    const removeActiveTransformers = useCallback(() => {
        if (activeTransformerIds.size === 0) return;
        const filtered = transformers.filter(t => !activeTransformerIds.has(t.id));
        setTransformers(filtered);
        setActiveTransformerIds(new Set());
    }, [transformers, setTransformers, activeTransformerIds, setActiveTransformerIds]);

    const replaceTransformer = useCallback((transformer: Transformer) => {
        const index = transformers.findIndex(t => t.id === transformer.id);
        if (index === -1) return;
        const updated = [...transformers];
        updated[index] = transformer;
        setTransformers(updated);
    }, [transformers, setTransformers]);

    const value = useMemo(() => ({
        transformers,
        activeTransformerIds,
        activeElements,
        setActiveTransformerIds,
        toggleActiveTransformer,
        setActiveElement,
        removeTransformer,
        removeActiveTransformers,
        replaceTransformer,
        focusTransformer,
    }), [transformers, activeTransformerIds, activeElements, setActiveTransformerIds, toggleActiveTransformer, setActiveElement, removeTransformer, removeActiveTransformers, replaceTransformer, focusTransformer]);

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
