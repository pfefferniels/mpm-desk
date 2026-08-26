import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    type ReactNode,
    type SetStateAction,
} from 'react';
import { useLatest } from './useLatest';
import type { Call } from '../model/Work';
import type { CallOutcome } from '../model/Reconstruction';

/**
 * What the editor has selected: calls, and the MPM elements they wrote.
 *
 * The editor's selection, and deliberately not the viewer's. `SelectionProvider` selects *spans*
 * and only reads; this selects *calls* and can remove and replace them. They look similar and are
 * not the same thing — a span is a run of elements of one type as the tree draws it, a call is
 * something a person did. Folding them into one provider would mean a mode flag in the middle of
 * a hot path, which is what keeping the two trees apart avoids.
 *
 * ## The one coupling between a desk and the rest of the editor
 *
 * `activeElements` is how a desk lights up the instructions belonging to the selected call, and
 * `setActiveElement` is how clicking a drawn instruction selects the call that wrote it. That
 * round trip only works because the fit reports, per call, the `xml:id`s it is answerable for —
 * `CallOutcome.elements`, derived from the document before and after rather than declared. Lose
 * that and a desk can draw the performance but not say which decision produced any part of it.
 *
 * The callbacks are stable across chain changes (`useLatest`), because everything a desk draws
 * sits under this and a fresh callback per render would re-render all of it.
 */
export interface CallSelectionValue {
    /** The calls of the chain, in the order the file records them. */
    calls: readonly Call[];
    activeCallIds: Set<string>;
    /** The `xml:id`s the selected calls wrote — what a desk highlights. */
    activeElements: string[];
    setActiveCallIds: (ids: SetStateAction<Set<string>>) => void;
    toggleActiveCall: (id: string) => void;
    /** Select the call answerable for this MPM element. How clicking a drawn instruction works. */
    setActiveElement: (elementId: string) => void;
    /**
     * Which call is answerable for this element, without selecting it.
     *
     * For the callers that need to light up *several* at once — following the playhead lights
     * every call whose instructions are sounding, which `setActiveElement` cannot express
     * because it selects exactly one.
     */
    callForElement: (elementId: string) => string | undefined;
    removeCall: (id: string) => void;
    removeActiveCalls: () => void;
    /** Scroll the narrative desk to a call, so selecting in one place shows it in the other. */
    focusCall: (id: string) => void;
}

const CallSelectionContext = createContext<CallSelectionValue | null>(null);

export const useCallSelection = (): CallSelectionValue => {
    const context = useContext(CallSelectionContext);
    if (!context) throw new Error('useCallSelection must be used within a CallSelectionProvider');
    return context;
};

interface CallSelectionProviderProps {
    children: ReactNode;
    calls: readonly Call[];
    /** Per call, what it wrote and where — the last fit's report. */
    outcomes: readonly CallOutcome[];
    activeCallIds: Set<string>;
    setActiveCallIds: (ids: SetStateAction<Set<string>>) => void;
    onRemoveCalls: (ids: readonly string[]) => void;
    focusCall: (id: string) => void;
}

export const CallSelectionProvider = ({
    children,
    calls,
    outcomes,
    activeCallIds,
    setActiveCallIds,
    onRemoveCalls,
    focusCall,
}: CallSelectionProviderProps) => {
    const callsRef = useLatest(calls);
    const outcomesRef = useLatest(outcomes);
    const activeRef = useLatest(activeCallIds);
    const removeRef = useLatest(onRemoveCalls);

    const elementsByCall = useMemo(() => {
        const map = new Map<string, readonly string[]>();
        for (const outcome of outcomes) map.set(outcome.id, outcome.elements);
        return map;
    }, [outcomes]);

    const activeElements = useMemo(() => {
        if (activeCallIds.size === 0) return [];
        return [...activeCallIds].flatMap((id) => [...(elementsByCall.get(id) ?? [])]);
    }, [activeCallIds, elementsByCall]);
    const activeElementsRef = useLatest(activeElements);

    const toggleActiveCall = useCallback(
        (id: string) => {
            const next = new Set(activeRef.current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            setActiveCallIds(next);
        },
        [activeRef, setActiveCallIds],
    );

    const setActiveElement = useCallback(
        (elementId: string) => {
            const owner = outcomesRef.current.find((outcome) =>
                outcome.elements.includes(elementId),
            );
            if (owner) setActiveCallIds(new Set([owner.id]));
        },
        [outcomesRef, setActiveCallIds],
    );

    const callForElement = useCallback(
        (elementId: string) =>
            outcomesRef.current.find((outcome) => outcome.elements.includes(elementId))?.id,
        [outcomesRef],
    );

    const removeCall = useCallback(
        (id: string) => {
            removeRef.current([id]);
            if (activeRef.current.has(id)) {
                const next = new Set(activeRef.current);
                next.delete(id);
                setActiveCallIds(next);
            }
        },
        [removeRef, activeRef, setActiveCallIds],
    );

    const removeActiveCalls = useCallback(() => {
        if (activeRef.current.size === 0) return;
        removeRef.current([...activeRef.current]);
        setActiveCallIds(new Set());
    }, [removeRef, activeRef, setActiveCallIds]);

    // Only `activeCallIds` should re-render consumers. `calls` and `activeElements` are read
    // through getters so that a chain edit — which happens on every gesture — does not.
    const value = useMemo<CallSelectionValue>(
        () => ({
            get calls() {
                return callsRef.current;
            },
            get activeElements() {
                return activeElementsRef.current;
            },
            activeCallIds,
            setActiveCallIds,
            toggleActiveCall,
            setActiveElement,
            callForElement,
            removeCall,
            removeActiveCalls,
            focusCall,
        }),
        [
            callsRef,
            activeElementsRef,
            activeCallIds,
            setActiveCallIds,
            toggleActiveCall,
            setActiveElement,
            callForElement,
            removeCall,
            removeActiveCalls,
            focusCall,
        ],
    );

    return <CallSelectionContext value={value}>{children}</CallSelectionContext>;
};
