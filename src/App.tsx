import React, { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Alert, AppBar, Snackbar, Stack } from '@mui/material';
import { convertMeiToMsm } from 'espressivo';
import './App.css';

import { correspondingDesks } from './desks/DeskSwitch';
import type { SecondaryData } from './desks/TransformerViewProps';
import { MetadataDesk } from './desks/metadata/MetadataDesk';
import { NarrativeDesk } from './desks/narrative/NarrativeDesk';
import { NotesProvider } from './hooks/NotesProvider';
import { ZoomContext } from './hooks/ZoomProvider';
import { CallSelectionProvider } from './hooks/CallSelection';
import { useMode } from './hooks/ModeProvider';
import { ScrollSyncProvider } from './hooks/ScrollSyncProvider';
import { useTimeMapping } from './hooks/useTimeMapping';
import { PlaybackProvider } from './hooks/PlaybackProvider';
import { PinchZoomHandler } from './hooks/usePinchZoom';
import { AppMenu } from './components/AppMenu';
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
import { migrateIfNeeded } from './model/loadWork';
import type { Call, Segment, WorkFile } from './model/Work';

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
 * ## A new call lands ungrouped
 *
 * Grouping is its own step, with its own desk, so a call arrives with no `segment` and the
 * narrative desk shows what it wrote in amber until somebody says what it is for. Folding a new
 * call into whichever claim happens to overlap its range would be convenient, and would write
 * claims nobody had made.
 */

/**
 * A call with its `segment` taken off.
 *
 * Deleted rather than set to `undefined`: `JSON.stringify` drops an undefined value, so the two
 * write the same file — but only one of them says so in the object anybody reads in a debugger.
 */
const ungrouped = (call: Call): Call => {
    const next = { ...call };
    delete next.segment;
    return next;
};

/** Legacy transformer names that should still resolve to a desk when a saved call names one. */
const TRANSFORMER_ALIASES: Record<string, string> = {
    ApproximateLogarithmicTempo: 'InsertTempo',
    TranslatePhysicalTimeToTicks: 'InsertTempo',
    TranslatePhyiscalTimeToTicks: 'InsertTempo',
};

const EMPTY_WORK: WorkFile = { name: '', mei: '', mpm: '', provenance: [], segments: [] };

export const App = () => {
    const { isEditorMode } = useMode();

    const [work, setWork] = useState<WorkFile>(EMPTY_WORK);
    const [pristine, setPristine] = useState<Alignment | null>(null);
    const [scoreMsm, setScoreMsm] = useState<string>('');
    const [mei, setMEI] = useState<string>();
    const [message, setMessage] = useState<string>();

    const [selectedDesk, setSelectedDesk] = useState<string>('metadata');
    const [scope, setScope] = useState<'global' | number>('global');
    const [activeCallIds, setActiveCallIds] = useState<Set<string>>(new Set());
    const [stretchX, setStretchX] = useState<number>(20);

    const appBarRef = useRef<HTMLDivElement>(null);

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

    useEffect(() => {
        if (problems) setMessage(problems.join('\n'));
        else if (error) setMessage(error);
    }, [problems, error]);

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
            setWork(migrateIfNeeded(content));
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
     */
    const addTransformer = useCallback((transformer: Transformer) => {
        const call: Call = {
            id: transformer.id,
            name: transformer.name,
            options: transformer.options as Call['options'],
        };
        setWork((current) => ({ ...current, provenance: [...current.provenance, call] }));
        setActiveCallIds(new Set([call.id]));
    }, []);

    const removeCalls = useCallback((ids: readonly string[]) => {
        const dropping = new Set(ids);
        setWork((current) => {
            const provenance = current.provenance.filter((call) => !dropping.has(call.id));
            // A claim nothing is made under any more is not a claim about the performance. The
            // segments hold no lists to prune — the calls named them — so this is the only place
            // the removal touches them at all.
            const standing = new Set(provenance.map((call) => call.segment));
            return {
                ...current,
                provenance,
                segments: current.segments.filter((segment) => standing.has(segment.id)),
            };
        });
    }, []);

    const setSegments = useCallback((segments: Segment[]) => {
        setWork((current) => ({ ...current, segments }));
    }, []);

    /**
     * Put calls under a claim — an existing one, a new one, or none at all.
     *
     * One update rather than two, because creating a segment and putting the first calls under it
     * is one act: done in two, the render in between holds a claim nothing is made under, which
     * `removeCalls` would be within its rights to sweep away.
     */
    const groupCalls = useCallback((callIds: readonly string[], segment: Segment | null) => {
        if (callIds.length === 0) return;
        const moving = new Set(callIds);
        setWork((current) => ({
            ...current,
            provenance: current.provenance.map((call) =>
                moving.has(call.id)
                    ? segment
                        ? { ...call, segment: segment.id }
                        : ungrouped(call)
                    : call,
            ),
            segments:
                segment && !current.segments.some(({ id }) => id === segment.id)
                    ? [...current.segments, segment]
                    : current.segments,
        }));
    }, []);

    /** Remove a claim. The calls survive and become unclaimed — the honest place for them. */
    const dissolveSegment = useCallback((segmentId: string) => {
        setWork((current) => ({
            ...current,
            provenance: current.provenance.map((call) =>
                call.segment === segmentId ? ungrouped(call) : call,
            ),
            segments: current.segments.filter(({ id }) => id !== segmentId),
        }));
    }, []);

    const setSecondary = useCallback<React.Dispatch<React.SetStateAction<SecondaryData>>>(
        (update) => {
            setWork((current) => {
                const previous = (current.secondary ?? {}) as SecondaryData;
                const next = typeof update === 'function' ? update(previous) : update;
                return { ...current, secondary: next as WorkFile['secondary'] };
            });
        },
        [],
    );

    const secondary = (work.secondary ?? {}) as SecondaryData;

    /**
     * The title and author, read off and written back through the chain's `InsertMetadata` call.
     *
     * They are not editor state beside the document: the runner builds `<metadata>` from whatever
     * call the chain carries, so anywhere else would be a second copy the next fit ignores.
     */
    const metadata = useMemo(() => {
        const call = work.provenance.find((entry) => entry.name === 'InsertMetadata');
        const options = call?.options as
            | { authors?: { text: string }[]; comments?: { text: string }[] }
            | undefined;
        return {
            author: options?.authors?.[0]?.text ?? '',
            title: options?.comments?.[0]?.text ?? '',
        };
    }, [work.provenance]);

    const setMetadata = useCallback<
        React.Dispatch<React.SetStateAction<{ author: string; title: string }>>
    >((update) => {
        setWork((current) => {
            const existing = current.provenance.find((entry) => entry.name === 'InsertMetadata');
            const options = existing?.options as
                | { authors?: { text: string }[]; comments?: { text: string }[] }
                | undefined;
            const before = {
                author: options?.authors?.[0]?.text ?? '',
                title: options?.comments?.[0]?.text ?? '',
            };
            const after = typeof update === 'function' ? update(before) : update;
            const call: Call = {
                id: existing?.id ?? crypto.randomUUID(),
                name: 'InsertMetadata',
                options: {
                    authors: after.author ? [{ number: 0, text: after.author }] : [],
                    comments: after.title ? [{ text: after.title }] : [],
                },
            };
            return {
                ...current,
                provenance: existing
                    ? current.provenance.map((entry) => (entry.id === call.id ? call : entry))
                    : [...current.provenance, call],
            };
        });
    }, []);

    // ── selection ↔ desk ↔ URL hash ───────────────────────────────

    const callsRef = useRef(work.provenance);
    callsRef.current = work.provenance;

    /** Switch to the desk that made a call, put the scope on it, and name it in the hash. */
    const focusCall = useCallback((id: string) => {
        const call = callsRef.current.find((entry) => entry.id === id);
        if (!call) return;

        const name = TRANSFORMER_ALIASES[call.name] ?? call.name;
        const entry = correspondingDesks
            .filter((candidate) => !!candidate.transformer)
            .find(({ transformer }) => transformer?.name === name);
        if (entry) setSelectedDesk(entry.displayName ?? entry.aspect);

        const options = call.options as Partial<ScopedTransformationOptions>;
        if (options.scope !== undefined) setScope(options.scope);

        const prefix = call.id.slice(0, 8);
        if (window.location.hash.slice(1) !== prefix) history.pushState(null, '', '#' + prefix);

        setActiveCallIds(new Set([id]));
    }, []);

    const initialHashSynced = useRef(false);
    useEffect(() => {
        if (initialHashSynced.current || !work.provenance.length) return;
        initialHashSynced.current = true;
        const hash = window.location.hash.slice(1);
        if (!hash) return;
        const match = work.provenance.find((call) => call.id.startsWith(hash));
        if (match) setActiveCallIds(new Set([match.id]));
    }, [work.provenance]);

    const onHashChange = useEffectEvent(() => {
        const hash = window.location.hash.slice(1);
        if (!hash) {
            if (activeCallIds.size > 0) {
                setActiveCallIds(new Set());
                history.replaceState(null, '', window.location.pathname + window.location.search);
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

    if (isEditorMode && !mei) {
        return <StartScreen onOpenZip={handleOpenZip} onOpenMei={handleOpenMei} />;
    }
    if (!alignment || !mpm || !result || !residual) {
        return <LoadingScreen message={pending ? 'Running the chain' : undefined} />;
    }

    const isMetadataSelected = selectedDesk === 'metadata';
    const isNarrativeSelected = deskEntry?.aspect === 'narrative';
    const DeskComponent = deskEntry?.desk;

    const deskProps = {
        appBarRef: isEditorMode ? appBarRef : null,
        msm: alignment,
        mpm,
        // A desk edits the document by adding a call, never by writing the MSM or MPM in place —
        // both are outputs of the fit and the next run would overwrite anything set here.
        setMSM: () => undefined,
        setMPM: () => undefined,
        residual,
        secondary,
        setSecondary,
    };

    return (
        <ZoomContext value={zoomContextValue}>
            <div style={{ maxWidth: '100vw' }}>
                <PlaybackProvider
                    scoreMsm={scoreMsm}
                    performanceMpm={result.mpm}
                    dateByNoteId={new Map()}
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
                                <Stack direction="row" ref={appBarRef} spacing={1} sx={{ p: 1 }}>
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

                            <NotesProvider notes={alignment.allNotes}>
                                {isMetadataSelected ? (
                                    <MetadataDesk
                                        metadata={metadata}
                                        setMetadata={setMetadata}
                                        appBarRef={isEditorMode ? appBarRef : null}
                                        isEditorMode={isEditorMode}
                                    />
                                ) : isNarrativeSelected ? (
                                    <NarrativeDesk
                                        {...deskProps}
                                        segments={work.segments}
                                        setSegments={setSegments}
                                        groupCalls={groupCalls}
                                        dissolveSegment={dissolveSegment}
                                        calls={work.provenance}
                                        projected={result.reconstruction.segments}
                                        performanceXml={result.mpm}
                                    />
                                ) : (
                                    DeskComponent && (
                                        <DeskComponent
                                            {...deskProps}
                                            addTransformer={addTransformer}
                                            part={scope}
                                        />
                                    )
                                )}
                            </NotesProvider>

                            <PinchZoomHandler />
                            <FloatingZoom />
                        </ScrollSyncProvider>
                    </CallSelectionProvider>
                </PlaybackProvider>

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
