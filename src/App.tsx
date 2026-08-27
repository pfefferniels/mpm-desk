import React, {
    Suspense,
    useCallback,
    useEffect,
    useEffectEvent,
    useMemo,
    useReducer,
    useRef,
    useState,
} from 'react';
import JSZip from 'jszip';
import { Alert, Box, Snackbar } from '@mui/material';
import { convertMeiToMsm } from 'espressivo';
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
import { ScrollSyncProvider } from './hooks/ScrollSyncProvider';
import { useTimeMapping } from './hooks/useTimeMapping';
import { PlaybackProvider } from './hooks/PlaybackProvider';
import { PinchZoomHandler } from './hooks/usePinchZoom';
import { DeskToolbarProvider } from './components/DeskToolbar';
import { DeskErrorBoundary } from './components/DeskErrorBoundary';
import { EditorHotkeys } from './components/EditorHotkeys';
import { EditorAppBar } from './components/toolbar/EditorAppBar';
import { FollowPlayback } from './components/FollowPlayback';
import { AspectSelect } from './components/AspectSelect';
import { StartScreen } from './components/StartScreen';
import { LoadingScreen } from './components/LoadingScreen';
import { useEditorFit } from './hooks/useEditorFit';
import { asMSM } from './fitting/asMSM';
import type { Alignment } from './fitting/alignment';
import { getInstructions } from './fitting/instructions/index';
import type { ScopedTransformationOptions, Transformer } from './fitting/transformers/Transformer';
import {
    initialHistory,
    metadataOf,
    workHistoryReducer,
    type Secondary,
} from './model/workReducer';
import { migrateIfNeeded } from './model/loadWork';
import { buildWorkArchive } from './model/exportWork';
import type { WorkFile } from './model/Work';
import { downloadAsFile } from './utils/utils';
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
     * The desk row's node, held in state rather than a ref.
     *
     * A desk portals its own controls into it (`DeskToolbar`), and a ref cannot serve that: on
     * the commit where the bar and the desk first render together the ref is still null, so
     * every desk's toolbar mounted into `document.body` and moved to the bar on some later
     * render. A callback ref into state re-renders when the node attaches, which is the whole
     * difference.
     *
     * It is the app bar's *second* row, and specifically a box in it that holds nothing React
     * owns. React inserts a child of its own by finding the next host sibling it tracks and
     * calling `insertBefore`; among children that all arrived through portals there is none, so
     * it appends instead. Anything rendered into the target would therefore land after every
     * desk's controls — which is what the old `{pending && <span>refitting…</span>}` did in the
     * one-row bar it shared with nine portals, and why that span always sat at the far right.
     */
    const [deskRow, setDeskRow] = useState<HTMLDivElement | null>(null);

    /**
     * The document as it was last written out, and the hidden input Open reaches through.
     *
     * Dirtiness is `work !== savedWork`, by reference. That is sound because `workHistoryReducer`
     * hands back the state it was given when an edit changed nothing, so a blur on an untouched
     * field is not a change here either; because `load` stores the very object it dispatched; and
     * because undo and redo step between the objects the history already holds, so saving,
     * undoing and redoing back lands on the saved reference again and the dot goes out.
     */
    const [savedWork, setSavedWork] = useState<WorkFile>(() => workHistory.present);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
        // A new score has new part indices, and the scope picker is a `Select`: left holding a
        // part the score does not have, it renders blank and warns. The `ToggleButtonGroup` it
        // replaced hid this by simply showing nothing selected.
        setScope('global');
    }, []);

    const loadWorkFromJson = useCallback((content: string) => {
        try {
            const loaded = migrateIfNeeded(content);
            dispatch({ type: 'load', work: loaded });
            setSavedWork(loaded);

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

    const handleOpenFile = useCallback(
        (file: File) => {
            if (file.name.endsWith('.zip')) void handleOpenZip(file);
            else if (file.name.endsWith('.mei') || file.name.endsWith('.xml'))
                void handleOpenMei(file);
            // The old branch had no `else`, so an unrecognised suffix did nothing and said
            // nothing — indistinguishable from a file that failed to parse.
            else setMessage(`Cannot open ${file.name} — expected a .zip, .mei or .xml.`);
        },
        [handleOpenZip, handleOpenMei],
    );

    /** Opens the picker below. It used to be `document.getElementById('fileInput')?.click()`
        into an input that the toolbar rendered — a round trip through the DOM between two
        components that could simply share a ref. */
    const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);

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

    /**
     * Per-desk working state, defaulted.
     *
     * Memoised on `work.secondary` rather than left as a bare expression, because the `?? {}`
     * built a fresh object on every render of the editor whenever a document had no secondary
     * state yet — which is most of them. That object is in `deskProps`, so it reached all
     * thirteen desks as a prop that never compared equal, and it is a dependency of the save
     * below, which would then have been rebuilt every render too.
     */
    const secondary = useMemo(() => (work.secondary ?? {}) as SecondaryData, [work.secondary]);

    /** Title and author, read off the chain's own `InsertMetadata` call — see `workReducer`. */
    const metadata = useMemo(() => metadataOf(work), [work]);

    const dirty = work !== savedWork;

    /**
     * What to call the file, given that a title here is a sentence.
     *
     * The metadata desk holds the title in a growing `textarea` precisely because it is prose —
     * the chain carries it as a `<comment>` — so it arrives with spaces, punctuation and no
     * length worth trusting. Handing that straight to a download turns a slash into a path
     * separator and a colon into one on macOS, and the archive lands somewhere nobody asked for
     * or not at all.
     *
     * So: the first few words, letters and digits only, hyphen-joined. `reconstruction` where
     * that leaves nothing — which is the case for a title of pure punctuation as well as for no
     * title at all, and is why the fallback is tested after the stripping rather than before it.
     *
     * The two lines that are not obvious. Decomposing to NFKD and then dropping the combining
     * marks is what turns `Überschrift` into `uberschrift`; without the second step the mark is
     * simply not a letter, and a German title comes out as `u-berschrift`. And the trim runs
     * *after* the truncation, because a cut at sixty characters usually lands mid-word and would
     * otherwise leave the hyphen it made dangling on the end of the name.
     */
    const archiveName = useMemo(() => {
        const slug = metadata.title
            .normalize('NFKD')
            .replace(/\p{Mark}+/gu, '')
            .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
            .slice(0, 60)
            .replace(/^-+|-+$/g, '')
            .toLowerCase();
        return `${slug || 'reconstruction'}.zip`;
    }, [metadata.title]);

    /**
     * Save, which is a download: the four-file archive the viewer reads.
     *
     * Building it is `buildWorkArchive`, which is pure and tested; this is the half that cannot
     * be — the download itself, and noticing that the document on disk is now this one.
     *
     * It lives here rather than in the toolbar because the shortcut calls it too, and that is
     * registered in a different subtree. One owner, two callers.
     */
    const handleSave = useCallback(async () => {
        if (!mei || !mpm || !alignment || !result) return;

        const archive = await buildWorkArchive({
            mei,
            msm: alignment,
            mpm,
            scoreMsm,
            calls: work.provenance,
            segments: work.segments,
            outcomes: result.outcomes,
            metadata,
            // The same boundary `setSecondary` crosses in the other direction, and the only
            // other place it is crossed: the bag is typed per desk here and opaque to the
            // document, because nothing outside a desk may depend on its shape.
            secondary: secondary as WorkFile['secondary'],
        });

        downloadAsFile(archive, archiveName, 'application/zip');
        setSavedWork(work);
    }, [mei, mpm, alignment, result, scoreMsm, work, metadata, secondary, archiveName]);

    const saveWork = useCallback(() => void handleSave(), [handleSave]);

    // ── selection ↔ desk ↔ URL hash ───────────────────────────────

    const callsRef = useLatest(work.provenance);

    /** Switch to the desk that made a call, put the scope on it, and name it in the hash. */
    const focusCall = useCallback(
        (id: string) => {
            const call = callsRef.current.find((entry) => entry.id === id);
            if (!call) return;

            const name = TRANSFORMER_ALIASES[call.name] ?? call.name;
            const entry = correspondingDesks.find(
                ({ transformerName }) => transformerName === name,
            );
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

    /**
     * Warn on reload, but only when there is something to lose.
     *
     * This used to assign `window.onbeforeunload` once, unconditionally and without ever
     * clearing it, under a comment saying nothing wrote the work file back — which stopped
     * being true when Save shipped. So the browser asked every time, including immediately
     * after saving, which is the fastest way to teach somebody to click through the dialog.
     */
    useEffect(() => {
        if (!dirty) return;

        const warn = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            // Safari still wants the legacy assignment.
            event.returnValue = '';
        };

        window.addEventListener('beforeunload', warn);
        return () => {
            window.removeEventListener('beforeunload', warn);
        };
    }, [dirty]);

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

    if (!mei) {
        return <StartScreen onOpenZip={handleOpenZip} onOpenMei={handleOpenMei} />;
    }
    if (!alignment || !mpm || !result || !residual) {
        return <LoadingScreen message={pending ? 'Running the chain' : undefined} />;
    }

    const isNarrativeSelected = deskEntry?.aspect === 'narrative';
    const DeskComponent = deskEntry?.desk;

    /** What the open desk calls itself, and what the parts of the score are called. */
    const deskName = deskEntry ? (deskEntry.displayName ?? deskEntry.aspect) : selectedDesk;
    // `parts()` is a `Set` built by mapping `allNotes`, which the alignment sorts by *date* —
    // so its order is whichever part enters first, not part order. The scope picker is the one
    // reader that never sorted it.
    const parts = Array.from(alignment.parts()).sort((a, b) => a - b);

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
                                <EditorAppBar
                                    deskRowRef={setDeskRow}
                                    deskName={deskName}
                                    parts={parts}
                                    scope={scope}
                                    setScope={setScope}
                                    pending={pending}
                                    dirty={dirty}
                                    canPlay={getInstructions(mpm).length > 0}
                                    canSave={work.provenance.length > 0}
                                    onSave={saveWork}
                                    onOpen={openFilePicker}
                                />

                                <EditorHotkeys onSave={saveWork} onOpen={openFilePicker} />

                                {/* The desk, and the aspect menu that floats over it.

                                    The menu is `position: absolute`, and until this box existed
                                    no ancestor of it established a containing block — so `top: 0`
                                    resolved against the page and the card painted on top of the
                                    bar's right end. `MetadataDesk` has been carrying a 15rem
                                    right gutter to stay out from under it. */}
                                <Box sx={{ position: 'relative' }}>
                                    <DeskToolbarProvider target={deskRow}>
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

                                    <AspectSelect
                                        selectedDesk={selectedDesk}
                                        setSelectedDesk={setSelectedDesk}
                                    />
                                </Box>

                                {/* The narrative desk follows the playhead on its own terms —
                                    rows lit, selection left alone — see `FollowPlayback`. */}
                                {!isNarrativeSelected && (
                                    <FollowPlayback
                                        mpm={mpm}
                                        beatDenominator={alignment.timeSignature?.denominator ?? 4}
                                    />
                                )}
                                <PinchZoomHandler />
                            </ScrollSyncProvider>
                        </CallSelectionProvider>
                    </PlaybackProvider>
                </WorkDocumentProvider>

                {/* Open reaches this through `fileInputRef`. It resets its own value on change,
                    which the old one did not — so opening a file, editing, and opening the
                    same file again fired no `change` event at all, silently. */}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/xml,.mei,.zip"
                    style={{ display: 'none' }}
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) handleOpenFile(file);
                        event.target.value = '';
                    }}
                />

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
