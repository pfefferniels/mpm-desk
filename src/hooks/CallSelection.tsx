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
 * Several calls can be answerable for one element, and the round trip needs exactly one:
 * {@link ownersOf} says which.
 *
 * The callbacks are stable across chain changes (`useLatest`), because everything a desk draws
 * sits under this and a fresh callback per render would re-render all of it.
 */
interface CallSelectionValue {
    /** The calls of the chain, in the order the file records them. */
    calls: readonly Call[];
    activeCallIds: Set<string>;
    /** The `xml:id`s that answer to the selected calls — what a desk highlights. */
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

/**
 * Which call each element answers to.
 *
 * The fit credits every call that wrote or changed an element, and in a chain of dynamics curves
 * that is two calls at every joint: the first closes its curve with a `<dynamics>` at the date
 * the second then fills its own curve into. Taking the first call credited lit both curves on a
 * click on either, and left the second call unselectable from the plot.
 *
 * Three rules, each outranking the next, and the later call winning among equals since its run
 * is the one the document shows:
 *
 * - A call that names a place outranks one that names none. The placeless calls are the passes —
 *   a style over every ornament, a merge over every pattern — and a pass touches what a
 *   per-chord call placed.
 * - A call that *leads* with the element outranks one that merely lists it. A gesture begins
 *   with the first element it reports, so the joint of a chain is the second curve's, and the
 *   first curve's closer only until then.
 * - Later wins. A curve redrawn over its own date reports the same id twice, and the earlier
 *   report is stale.
 *
 * Each layer below overrides the one before it, which is what a `Map` does with a later entry
 * for the same key.
 */
const ownersOf = (outcomes: readonly CallOutcome[]): ReadonlyMap<string, string> => {
    const claims = (
        by: readonly CallOutcome[],
        pick: (elements: readonly string[]) => readonly string[],
    ) => by.flatMap((outcome) => pick(outcome.elements).map((id) => [id, outcome.id] as const));
    const placed = outcomes.filter((outcome) => outcome.range !== null);
    const all = (elements: readonly string[]) => elements;
    const lead = (elements: readonly string[]) => elements.slice(0, 1);

    return new Map([...claims(outcomes, all), ...claims(placed, all), ...claims(placed, lead)]);
};

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
    const activeRef = useLatest(activeCallIds);
    const removeRef = useLatest(onRemoveCalls);

    const owners = useMemo(() => ownersOf(outcomes), [outcomes]);
    const ownersRef = useLatest(owners);

    const activeElements = useMemo(() => {
        if (activeCallIds.size === 0) return [];
        return [...owners].filter(([, owner]) => activeCallIds.has(owner)).map(([id]) => id);
    }, [activeCallIds, owners]);
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
            const owner = ownersRef.current.get(elementId);
            if (owner !== undefined) setActiveCallIds(new Set([owner]));
        },
        [ownersRef, setActiveCallIds],
    );

    const callForElement = useCallback(
        (elementId: string) => ownersRef.current.get(elementId),
        [ownersRef],
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
