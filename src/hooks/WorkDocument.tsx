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
import type { Call, Segment } from '../model/Work';

/**
 * The document, and the ways it changes.
 *
 * ## Why this exists
 *
 * Two desks needed more than a desk is handed. The narrative desk edits `segments` — it is the
 * one desk whose subject is the claims rather than a dimension of the sound — and the metadata
 * desk edits the title and author and shows how much has been claimed so far. Neither fits
 * `ViewProps`, which is what the *fit* produced, so both were rendered by name out of a
 * three-way branch in `App`, each with its own extra props, and the registry that was supposed
 * to say which desk edits which aspect was bypassed by two of its own entries.
 *
 * Widening `ViewProps` with `segments`, `groupCalls`, `dissolveSegment` and the rest would have
 * pushed the narrative desk's business onto all thirteen. So the document goes in a context of
 * its own instead, beside the two that were already there, and every desk is handed the same bag
 * again.
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
 * ## The value is memoised, and that is not decoration
 *
 * Everything a desk draws sits under this. An object literal rebuilt each render would re-render
 * all of it on every keystroke — the mistake `ScrollSyncProvider` documents avoiding, and the one
 * `usePiano`'s unstable refs once made through `PlaybackProvider`. The operations depend on
 * `dispatch` alone, which `useReducer` guarantees is stable, so the value changes only when the
 * document does.
 */
interface WorkDocumentValue {
    /** The calls of the chain, in the order the file records them. */
    calls: readonly Call[];
    /** What the reconstruction claims — one entry per claim. */
    segments: readonly Segment[];
    /** Title and author, read off the chain's own `InsertMetadata` call. */
    metadata: WorkMetadata;
    /** The voice layout, read off the chain's own `ProcessVoices` call. */
    voices: WorkVoices;
    /** What was decided about each take that has been aligned, one entry per `<recording>`. */
    alignments: readonly WorkAlignment[];

    removeCalls: (ids: readonly string[]) => void;
    /** Put calls under a claim — an existing one, a new one, or none at all. */
    groupCalls: (callIds: readonly string[], segment: Segment | null) => void;
    /** Withdraw a claim. Its calls survive and become unclaimed — the honest place for them. */
    dissolveSegment: (segmentId: string) => void;
    setSegments: (segments: Segment[]) => void;
    setMetadata: (update: MetadataUpdate) => void;
    setVoices: (update: VoicesUpdate) => void;
    /** Record what was decided about one take, on the `Align` call that names its `@source`. */
    setAlignment: (alignment: WorkAlignment) => void;

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

    const groupCalls = useCallback(
        (callIds: readonly string[], segment: Segment | null) => {
            dispatch({ type: 'group-calls', callIds, segment });
        },
        [dispatch],
    );

    const dissolveSegment = useCallback(
        (segmentId: string) => {
            dispatch({ type: 'dissolve-segment', segmentId });
        },
        [dispatch],
    );

    const setSegments = useCallback(
        (segments: Segment[]) => {
            dispatch({ type: 'set-segments', segments });
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

    /** Likewise, and used only for a take the document has no `Align` call for yet. */
    const setAlignment = useCallback(
        (alignment: WorkAlignment) => {
            dispatch({ type: 'set-alignment', alignment, newCallId: crypto.randomUUID() });
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
            segments: work.segments,
            metadata,
            voices,
            alignments,
            removeCalls,
            groupCalls,
            dissolveSegment,
            setSegments,
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
            work.segments,
            metadata,
            voices,
            alignments,
            removeCalls,
            groupCalls,
            dissolveSegment,
            setSegments,
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
