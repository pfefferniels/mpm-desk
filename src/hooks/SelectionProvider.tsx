import { createContext, useContext, useMemo, useCallback, ReactNode, SetStateAction } from 'react';
import { Transformer } from 'mpmify';
import { useLatest } from './useLatest';

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
    // Use refs so callbacks stay stable across transformer state changes,
    // preventing unnecessary context value updates and cascading re-renders
    // in all useSelection() consumers (including ~48 RegionOnion instances).
    const transformersRef = useLatest(transformers);
    const activeTransformerIdsRef = useLatest(activeTransformerIds);
    const setTransformersRef = useLatest(setTransformers);

    const activeElements = useMemo(() => {
        if (activeTransformerIds.size === 0) return [];
        return transformers
            .filter(t => activeTransformerIds.has(t.id))
            .flatMap(t => t.created);
    }, [activeTransformerIds, transformers]);

    const toggleActiveTransformer = useCallback((id: string) => {
        const next = new Set(activeTransformerIdsRef.current);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        setActiveTransformerIds(next);
    }, [activeTransformerIdsRef, setActiveTransformerIds]);

    const setActiveElement = useCallback((elementId: string) => {
        const correspondingTransformer = transformersRef.current.find(t => t.created.includes(elementId));
        if (correspondingTransformer) {
            setActiveTransformerIds(new Set([correspondingTransformer.id]));
        }
    }, [transformersRef, setActiveTransformerIds]);

    const removeTransformer = useCallback((transformer: Transformer) => {
        const filtered = transformersRef.current.filter(t => t.id !== transformer.id);
        setTransformersRef.current(filtered);
        if (activeTransformerIdsRef.current.has(transformer.id)) {
            const next = new Set(activeTransformerIdsRef.current);
            next.delete(transformer.id);
            setActiveTransformerIds(next);
        }
    }, [transformersRef, setTransformersRef, activeTransformerIdsRef, setActiveTransformerIds]);

    const removeActiveTransformers = useCallback(() => {
        if (activeTransformerIdsRef.current.size === 0) return;
        const filtered = transformersRef.current.filter(t => !activeTransformerIdsRef.current.has(t.id));
        setTransformersRef.current(filtered);
        setActiveTransformerIds(new Set());
    }, [transformersRef, setTransformersRef, activeTransformerIdsRef, setActiveTransformerIds]);

    const replaceTransformer = useCallback((transformer: Transformer) => {
        const current = transformersRef.current;
        const index = current.findIndex(t => t.id === transformer.id);
        if (index === -1) return;
        const updated = [...current];
        updated[index] = transformer;
        setTransformersRef.current(updated);
    }, [transformersRef, setTransformersRef]);

    // Only recompute context value when activeTransformerIds changes.
    // Callbacks are stable (useLatest refs). transformers/activeElements
    // are read via getter to avoid triggering consumer re-renders when
    // only transformers change (common during argumentation edits).
    const activeElementsRef = useLatest(activeElements);

    const value = useMemo<SelectionContextValue>(() => ({
        get transformers() { return transformersRef.current; },
        get activeElements() { return activeElementsRef.current; },
        activeTransformerIds,
        setActiveTransformerIds,
        toggleActiveTransformer,
        setActiveElement,
        removeTransformer,
        removeActiveTransformers,
        replaceTransformer,
        focusTransformer,
    }), [activeTransformerIds, setActiveTransformerIds, toggleActiveTransformer, setActiveElement, removeTransformer, removeActiveTransformers, replaceTransformer, focusTransformer, transformersRef, activeElementsRef]);

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
