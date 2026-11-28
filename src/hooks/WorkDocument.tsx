import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import {
    alignmentsOf,
    canRedo as historyCanRedo,
    canUndo as historyCanUndo,
    metadataOf,
    voicesOf,
    type MetadataUpdate,
    type VoicesUpdate,
    type WorkAlignment,
    type WorkHistory,
    type WorkHistoryAction,
    type WorkMetadata,
    type WorkVoices,
} from '../model/workReducer';
import type { Call } from '../model/Work';

/**
 * The document, and the ways it changes.
 *
 * Some desks need more than `ViewProps`, which is what the *fit* produced. The metadata desk
 * edits the title and author and counts the calls, the voices desk the voice layout, the
 * alignment desk what was decided about each take.
 *
 * Widening `ViewProps` with each of those would push one desk's business onto all of them. So the
 * document goes in a context of its own, beside the two already there, and every desk is handed
 * the same bag.
 *
 * ## What is deliberately *not* here
 *
 * - **`addTransformer`.** A desk's gesture becoming a call also *selects* that call, and
 *   selection is `CallSelection`'s business. `App` composes the two and passes the result down
 *   as the prop every desk already takes.
 * - **`secondary`.** It is per-desk working state that never reaches the chain, and it already
 *   travels in `ViewProps` where the desks that own it can find it.
 * - **Selection.** `CallSelection` selects calls and can remove them; this holds what there is
 *   to select. They stay apart for the reason recorded there.
 *
 * The value is memoised. Everything a desk draws sits under this, so an object literal rebuilt
 * each render would re-render all of it on every keystroke. The operations depend on `dispatch`
 * alone, which `useReducer` guarantees is stable, so the value changes only when the document
 * does.
 */
interface WorkDocumentValue {
    /** The calls of the chain, in the order the file records them. */
    calls: readonly Call[];
    /** Title and author, read off the chain's own `InsertMetadata` call. */
    metadata: WorkMetadata;
    /** The voice layout, read off the chain's own `ProcessVoices` call. */
    voices: WorkVoices;
    /** What was decided about each take that has been aligned, one entry per `<recording>`. */
    alignments: readonly WorkAlignment[];

    removeCalls: (ids: readonly string[]) => void;
    /**
     * Take the calls with the ids `remove` out and put `add` at the end, as one edit: one step of
     * undo, and none at all where the document comes out as it went in.
     */
    replaceCalls: (remove: readonly string[], add: readonly Call[]) => void;
    setMetadata: (update: MetadataUpdate) => void;
    setVoices: (update: VoicesUpdate) => void;
    /**
     * Record what was decided about one take, on the `AlignSource` call that names its `@source`.
     * `readings` are the readings just written into the score for it, where any were.
     */
    setAlignment: (alignment: WorkAlignment, readings?: readonly string[]) => void;

    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
}

const WorkDocumentContext = createContext<WorkDocumentValue | null>(null);

export const useWorkDocument = (): WorkDocumentValue => {
    const context = useContext(WorkDocumentContext);
    if (!context) throw new Error('useWorkDocument must be used within a WorkDocumentProvider');
    return context;
};

interface WorkDocumentProviderProps {
    history: WorkHistory;
    dispatch: (action: WorkHistoryAction) => void;
    children: ReactNode;
}

export const WorkDocumentProvider = ({
    history,
    dispatch,
    children,
}: WorkDocumentProviderProps) => {
    const work = history.present;

    const removeCalls = useCallback(
        (ids: readonly string[]) => {
            dispatch({ type: 'remove-calls', ids });
        },
        [dispatch],
    );

    const replaceCalls = useCallback(
        (remove: readonly string[], add: readonly Call[]) => {
            dispatch({ type: 'replace-calls', remove, add });
        },
        [dispatch],
    );

    // The id is minted here rather than in the reducer, which has to stay a function of its
    // arguments to be testable. It is used only when the chain carries no `InsertMetadata` yet.
    const setMetadata = useCallback(
        (update: MetadataUpdate) => {
            dispatch({ type: 'set-metadata', update, newCallId: crypto.randomUUID() });
        },
        [dispatch],
    );

    /** Likewise, and used only when the chain carries no `ProcessVoices` yet. */
    const setVoices = useCallback(
        (update: VoicesUpdate) => {
            dispatch({ type: 'set-voices', update, newCallId: crypto.randomUUID() });
        },
        [dispatch],
    );

    /** Likewise, and used only for a take the document has no `AlignSource` call for yet. */
    const setAlignment = useCallback(
        (alignment: WorkAlignment, readings?: readonly string[]) => {
            dispatch({
                type: 'set-alignment',
                alignment,
                ...(readings !== undefined && { readings }),
                newCallId: crypto.randomUUID(),
            });
        },
        [dispatch],
    );

    const undo = useCallback(() => {
        dispatch({ type: 'undo' });
    }, [dispatch]);

    const redo = useCallback(() => {
        dispatch({ type: 'redo' });
    }, [dispatch]);

    const metadata = useMemo(() => metadataOf(work), [work]);
    const voices = useMemo(() => voicesOf(work), [work]);
    const alignments = useMemo(() => alignmentsOf(work), [work]);

    const value = useMemo<WorkDocumentValue>(
        () => ({
            calls: work.provenance,
            metadata,
            voices,
            alignments,
            removeCalls,
            replaceCalls,
            setMetadata,
            setVoices,
            setAlignment,
            undo,
            redo,
            canUndo: historyCanUndo(history),
            canRedo: historyCanRedo(history),
        }),
        [
            work.provenance,
            metadata,
            voices,
            alignments,
            removeCalls,
            replaceCalls,
            setMetadata,
            setVoices,
            setAlignment,
            undo,
            redo,
            history,
        ],
    );

    return <WorkDocumentContext value={value}>{children}</WorkDocumentContext>;
};
