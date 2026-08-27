import React, {
    Suspense,
    useCallback,
    useEffect,
    useEffectEvent,
    useMemo,
    useReducer,
    useState,
} from 'react';
import JSZip from 'jszip';
import { Alert, AppBar, Snackbar, Stack } from '@mui/material';
import { useHotkeys } from 'react-hotkeys-hook';
import { convertMeiToMsm } from 'espressivo';
import './App.css';
// Populates the transformer registry for this thread. Stated at the editor's own root rather
// than left to whichever module happens to be imported first: the registry is module-level
// state, and a chain reconstructed before it is populated silently loses every call it cannot
// name. The fitting worker imports it on its own side for the same reason.
//
// It sat in `main.tsx` until the two routes were split apart. The viewer never rebuilds a chain
// — nothing under `src/segment-stack/` touches the registry — so stating it at the shared entry
// only meant every reader of a finished reconstruction downloading the whole fitting chain.
import './fitting/transformers/Order';

import { correspondingDesks } from './desks/DeskSwitch';
import type { SecondaryData } from './desks/TransformerViewProps';
import { NotesProvider } from './hooks/NotesProvider';
import { ZoomContext } from './hooks/ZoomProvider';
import { CallSelectionProvider } from './hooks/CallSelection';
import { WorkDocumentProvider } from './hooks/WorkDocument';
import { useLatest } from './hooks/useLatest';
import { useMode } from './hooks/ModeProvider';
import { ScrollSyncProvider } from './hooks/ScrollSyncProvider';
import { useTimeMapping } from './hooks/useTimeMapping';
import { PlaybackProvider } from './hooks/PlaybackProvider';
import { PinchZoomHandler } from './hooks/usePinchZoom';
import { AppMenu } from './components/AppMenu';
import { DeskToolbarProvider } from './components/DeskToolbar';
import { DeskErrorBoundary } from './components/DeskErrorBoundary';
import { FollowPlayback } from './components/FollowPlayback';
import { AspectSelect } from './components/AspectSelect';
import { FloatingZoom } from './components/FloatingZoom';
import { StartScreen } from './components/StartScreen';
import { LoadingScreen } from './components/LoadingScreen';
import { useEditorFit } from './hooks/useEditorFit';
import { asMSM } from './fitting/asMSM';
import type { Alignment } from './fitting/alignment';
import type {
    ScopedTransformationOptions,
    Transformer,
} from './fitting/transformers/Transformer';
import {
    initialHistory,
    metadataOf,
    workHistoryReducer,
    type Secondary,
} from './model/workReducer';
import { migrateIfNeeded } from './model/loadWork';
import { readNoteDates } from './utils/score';

/**
 * The editor.
 *
 * Its own component tree, mounted at `/editor`. The viewer at `/` is a different tree over the
 * same document and the two are kept apart on purpose — see `main.tsx`.
 *
 * Each desk plots what the recording did in one dimension and turns a gesture on that plot into a
 * transformer call. Below them sits the chain in `src/fitting/`, which runs in a worker over a
 * document that is a `WorkFile`: a flat list of calls and a flat list of segments.
 *
 * ## The document is a reducer, and every desk is a desk
 *
 * Both of those used to be otherwise, and they were the same problem twice.
 *
 * The document was seven `setWork(current => …)` updaters here, with the rules that hold it
 * together — a claim nothing is made under is not a claim; grouping is one act and not two —
 * written in comments beside them rather than anywhere they could be checked. They are
 * `workReducer` now, tested without React, which is also what made undo cost twenty lines
 * instead of a rewrite. An editor that holds the only copy of the work should have had it long
 * ago.
 *
 * And the registry that says which desk edits which aspect was bypassed by two of its own
 * entries, because the narrative desk needed the document and the metadata desk needed neither
 * the fit nor a scope, so both were rendered by name out of a branch here. What they needed is
 * in a context now (`useWorkDocument`), so there is one dispatch and the registry means what it
 * says.
 *
 * ## A new call lands ungrouped
 *
 * Grouping is its own step, with its own desk, so a call arrives with no `segment` and the
 * narrative desk shows what it wrote in amber until somebody says what it is for. Folding a new
 * call into whichever claim happens to overlap its range would be convenient, and would write
 * claims nobody had made.
 */

/** Legacy transformer names that should still resolve to a desk when a saved call names one. */
const TRANSFORMER_ALIASES: Record<string, string> = {
    ApproximateLogarithmicTempo: 'InsertTempo',
    TranslatePhysicalTimeToTicks: 'InsertTempo',
    TranslatePhyiscalTimeToTicks: 'InsertTempo',
};

export const App = () => {
    const { isEditorMode } = useMode();

    // Named `workHistory`, not `history`: the global of that name is what `pushState` below is
    // reached through, and shadowing it here made an undo stack look like a browser one.
    const [workHistory, dispatch] = useReducer(workHistoryReducer, undefined, () =>
        initialHistory(),
    );
    const work = workHistory.present;

    const [pristine, setPristine] = useState<Alignment | null>(null);
    const [scoreMsm, setScoreMsm] = useState<string>('');
    const [mei, setMEI] = useState<string>();
    const [message, setMessage] = useState<string>();

    const [selectedDesk, setSelectedDesk] = useState<string>('metadata');
    const [scope, setScope] = useState<'global' | number>('global');
    const [activeCallIds, setActiveCallIds] = useState<Set<string>>(new Set());
    const [stretchX, setStretchX] = useState<number>(20);

    /**
     * The app bar's node, held in state rather than a ref.
     *
     * A desk portals its own controls into it (`DeskToolbar`), and a ref cannot serve that: on
     * the commit where the bar and the desk first render together the ref is still null, so
     * every desk's toolbar mounted into `document.body` and moved to the bar on some later
     * render. A callback ref into state re-renders when the node attaches, which is the whole
     * difference.
     */
    const [appBar, setAppBar] = useState<HTMLDivElement | null>(null);

    /**
     * The desk currently open, and the hold-out its residual must be derived with.
     *
     * The hold-out is a correctness requirement rather than a preference — see `DeskSwitch.tsx`.
     * Reading it here, from the registry, is what saves each desk from having to remember its own.
     */
    const deskEntry = useMemo(
        () =>
            correspondingDesks.find(
                (entry) => entry.displayName === selectedDesk || entry.aspect === selectedDesk,
            ),
        [selectedDesk],
    );

    const { result, mpm, alignment, residual, pending, problems, error } = useEditorFit({
        work,
        pristine,
        holdOut: deskEntry?.holdOut,
    });

    /**
     * What the last fit had to say, raised as a message.
     *
     * Adjusted during render against the last one seen, rather than set from an effect. The
     * message is not purely derived — a failed load writes one too, and dismissing clears it —
     * so it stays state; what this does is notice that the fit is now saying something *else*.
     * As an effect it cost a second render of the whole editor for every problem reported.
     */
    const fitMessage = problems ? problems.join('\n') : (error ?? undefined);
    const [reportedFitMessage, setReportedFitMessage] = useState(fitMessage);
    if (fitMessage !== reportedFitMessage) {
        setReportedFitMessage(fitMessage);
        if (fitMessage) setMessage(fitMessage);
    }

    // ── loading ───────────────────────────────────────────────────

    const loadMei = useCallback((content: string) => {
        setMEI(content);
        const converted = convertMeiToMsm(content)[0]?.msm;
        if (!converted) {
            setMessage('The MEI holds no convertible movement.');
            return;
        }
        setScoreMsm(converted);
        setPristine(asMSM(content, converted));
    }, []);

    const loadWorkFromJson = useCallback((content: string) => {
        try {
            const loaded = migrateIfNeeded(content);
            dispatch({ type: 'load', work: loaded });

            // A link into a call selects it, and this is the moment that can be decided: the
            // document is in hand and the URL has not moved. It used to be an effect waiting for
            // `provenance` to become non-empty, guarded by a ref so it fired once — which is an
            // effect standing in for "when the file loads", when the file loading is an event
            // right here.
            const hash = window.location.hash.slice(1);
            const match = hash
                ? loaded.provenance.find((call) => call.id.startsWith(hash))
                : undefined;
            if (match) setActiveCallIds(new Set([match.id]));

            setMessage(undefined);
        } catch (reason) {
            setMessage(reason instanceof Error ? reason.message : String(reason));
        }
    }, []);

    const handleOpenMei = useCallback(
        async (file: File) => {
            loadMei(await file.text());
            document.title = `${file.name} - MPM Desk`;
        },
        [loadMei],
    );

    const handleOpenZip = useCallback(
        async (file: File) => {
            const zip = await JSZip.loadAsync(file);
            const meiFile = zip.file('transcription.mei');
            // `work.json` is the current name; older archives carry `info.json`, and those are
            // worth being able to open.
            const jsonFile = zip.file('work.json') ?? zip.file('info.json');

            if (meiFile) {
                loadMei(await meiFile.async('string'));
                document.title = `${file.name} - MPM Desk`;
            }
            if (jsonFile) loadWorkFromJson(await jsonFile.async('string'));
        },
        [loadMei, loadWorkFromJson],
    );

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.name.endsWith('.zip')) void handleOpenZip(file);
        else if (file.name.endsWith('.mei') || file.name.endsWith('.xml')) void handleOpenMei(file);
    };

    const handleFileImport = () => {
        document.getElementById('fileInput')?.click();
    };

    // ── editing the document ──────────────────────────────────────

    /**
     * What a desk's gesture becomes.
     *
     * A desk hands over a constructed `Transformer` and only its three data fields are kept —
     * a call is a name, an id and its options. It lands in no segment: see the note at the top.
     *
     * Kept here rather than on `useWorkDocument` because it is two things at once: the document
     * gains a call, and that call becomes the selection. The second half is `CallSelection`'s,
     * and this is where the two meet.
     */
    const addTransformer = useCallback((transformer: Transformer) => {
        const call = {
            id: transformer.id,
            name: transformer.name,
            options: transformer.options as Record<string, unknown>,
        };
        dispatch({ type: 'add-call', call });
        setActiveCallIds(new Set([call.id]));
    }, []);

    const removeCalls = useCallback((ids: readonly string[]) => {
        dispatch({ type: 'remove-calls', ids });
    }, []);

    const setSecondary = useCallback<React.Dispatch<React.SetStateAction<SecondaryData>>>(
        (update) => {
            // The bag is `Record<string, unknown>` to the document and typed per desk to the
            // desks — deliberately both, because `Work.ts` says nothing outside a desk may
            // depend on its shape. This is that boundary, and the only place it is crossed.
            dispatch({
                type: 'set-secondary',
                update:
                    typeof update === 'function'
                        ? (previous: Secondary) => update(previous as SecondaryData) as Secondary
                        : (update as Secondary),
            });
        },
        [],
    );

    const secondary = (work.secondary ?? {}) as SecondaryData;

    /** Title and author, read off the chain's own `InsertMetadata` call — see `workReducer`. */
    const metadata = useMemo(() => metadataOf(work), [work]);


    useHotkeys('mod+z', () => dispatch({ type: 'undo' }), { preventDefault: true });
    useHotkeys('mod+shift+z', () => dispatch({ type: 'redo' }), { preventDefault: true });

    // ── selection ↔ desk ↔ URL hash ───────────────────────────────

    const callsRef = useLatest(work.provenance);

    /** Switch to the desk that made a call, put the scope on it, and name it in the hash. */
    const focusCall = useCallback(
        (id: string) => {
            const call = callsRef.current.find((entry) => entry.id === id);
            if (!call) return;

            const name = TRANSFORMER_ALIASES[call.name] ?? call.name;
            const entry = correspondingDesks.find(({ transformerName }) => transformerName === name);
            if (entry) setSelectedDesk(entry.displayName ?? entry.aspect);

            const options = call.options as Partial<ScopedTransformationOptions>;
            if (options.scope !== undefined) setScope(options.scope);

            const prefix = call.id.slice(0, 8);
            if (window.location.hash.slice(1) !== prefix)
                window.history.pushState(null, '', '#' + prefix);

            setActiveCallIds(new Set([id]));
        },
        [callsRef],
    );

    const onHashChange = useEffectEvent(() => {
        const hash = window.location.hash.slice(1);
        if (!hash) {
            if (activeCallIds.size > 0) {
                setActiveCallIds(new Set());
                window.history.replaceState(
                    null,
                    '',
                    window.location.pathname + window.location.search,
                );
            }
            return;
        }
        if (activeCallIds.size === 1) {
            const [only] = activeCallIds;
            if (only.startsWith(hash)) return;
        }
        const match = work.provenance.find((call) => call.id.startsWith(hash));
        if (match) setActiveCallIds(new Set([match.id]));
    });

    useEffect(() => {
        window.addEventListener('hashchange', onHashChange);
        return () => {
            window.removeEventListener('hashchange', onHashChange);
        };
    }, []);

    useEffect(() => {
        // Nothing writes the work file back yet, so every edit is unsaved.
        if (isEditorMode) window.onbeforeunload = () => '';
    }, [isEditorMode]);

    // ── rendering ─────────────────────────────────────────────────

    const zoomContextValue = useMemo(
        () => ({
            symbolic: { stretchX: stretchX / 200 },
            physical: { stretchX },
            setStretchX,
        }),
        [stretchX],
    );

    const { tickToSeconds, secondsToTick } = useTimeMapping(alignment);

    /**
     * Note `xml:id` ⇒ symbolic date, off the score the performance is rendered against.
     *
     * What turns a sounding note back into a place on the timeline: every follow reads it, and
     * a preview's tick range is placed in a rendering through it. Without it playback reports
     * nothing and a ranged preview falls back to the piece whole.
     */
    const dateByNoteId = useMemo(() => readNoteDates(scoreMsm), [scoreMsm]);

    if (isEditorMode && !mei) {
        return <StartScreen onOpenZip={handleOpenZip} onOpenMei={handleOpenMei} />;
    }
    if (!alignment || !mpm || !result || !residual) {
        return <LoadingScreen message={pending ? 'Running the chain' : undefined} />;
    }

    const isNarrativeSelected = deskEntry?.aspect === 'narrative';
    const DeskComponent = deskEntry?.desk;

    const deskProps = {
        msm: alignment,
        mpm,
        residual,
        projected: result.reconstruction.segments,
        performanceXml: result.mpm,
        secondary,
        setSecondary,
    };

    return (
        <ZoomContext value={zoomContextValue}>
            <div style={{ maxWidth: '100vw' }}>
                <WorkDocumentProvider history={workHistory} dispatch={dispatch}>
                    <PlaybackProvider
                        scoreMsm={scoreMsm}
                        performanceMpm={result.mpm}
                        dateByNoteId={dateByNoteId}
                    >
                        <CallSelectionProvider
                            calls={work.provenance}
                            outcomes={result.outcomes}
                            activeCallIds={activeCallIds}
                            setActiveCallIds={setActiveCallIds}
                            onRemoveCalls={removeCalls}
                            focusCall={focusCall}
                        >
                            <ScrollSyncProvider
                                symbolicZoom={zoomContextValue.symbolic.stretchX}
                                physicalZoom={zoomContextValue.physical.stretchX}
                                tickToSeconds={tickToSeconds}
                                secondsToTick={secondsToTick}
                            >
                                <AppBar position="static" color="transparent" elevation={1}>
                                    <Stack
                                        direction="row"
                                        ref={setAppBar}
                                        spacing={1}
                                        sx={{ p: 1 }}
                                    >
                                        <AppMenu
                                            mei={mei}
                                            msm={alignment}
                                            mpm={mpm}
                                            transformers={work.provenance}
                                            segments={work.segments}
                                            scoreMsm={scoreMsm}
                                            outcomes={result.outcomes}
                                            metadata={metadata}
                                            secondary={secondary}
                                            scope={scope}
                                            setScope={setScope}
                                            onFileImport={handleFileImport}
                                            onFileChange={handleFileChange}
                                        />
                                        {pending && (
                                            <span
                                                style={{
                                                    alignSelf: 'center',
                                                    fontSize: 12,
                                                    color: '#b45309',
                                                }}
                                            >
                                                refitting…
                                            </span>
                                        )}
                                    </Stack>
                                </AppBar>

                                <DeskToolbarProvider target={isEditorMode ? appBar : null}>
                                    <NotesProvider notes={alignment.allNotes}>
                                        {/* A desk that throws must not take the editor with it:
                                            the work is unsaved and Save lives in the bar above.
                                            The open desk is the reset key, so switching away
                                            from a broken one clears it. */}
                                        <DeskErrorBoundary resetKey={selectedDesk}>
                                            <Suspense
                                                fallback={
                                                    <LoadingScreen message="Opening the desk" />
                                                }
                                            >
                                                {DeskComponent && (
                                                    <DeskComponent
                                                        {...deskProps}
                                                        addTransformer={addTransformer}
                                                        part={scope}
                                                    />
                                                )}
                                            </Suspense>
                                        </DeskErrorBoundary>
                                    </NotesProvider>
                                </DeskToolbarProvider>

                                {/* The narrative desk follows the playhead on its own terms —
                                    rows lit, selection left alone — see `FollowPlayback`. */}
                                {!isNarrativeSelected && (
                                    <FollowPlayback
                                        mpm={mpm}
                                        beatDenominator={alignment.timeSignature?.denominator ?? 4}
                                    />
                                )}
                                <PinchZoomHandler />
                                <FloatingZoom />
                            </ScrollSyncProvider>
                        </CallSelectionProvider>
                    </PlaybackProvider>
                </WorkDocumentProvider>

                <AspectSelect selectedDesk={selectedDesk} setSelectedDesk={setSelectedDesk} />

                <Snackbar
                    open={message !== undefined}
                    autoHideDuration={4000}
                    onClose={() => {
                        setMessage(undefined);
                    }}
                >
                    <Alert
                        onClose={() => {
                            setMessage(undefined);
                        }}
                        severity="error"
                        variant="filled"
                        sx={{ width: '40%' }}
                    >
                        {message}
                    </Alert>
                </Snackbar>
            </div>
        </ZoomContext>
    );
};
