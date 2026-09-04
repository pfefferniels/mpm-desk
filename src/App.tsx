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
// Not at the shared entry: the viewer never rebuilds a chain, so that would make every reader
// of a finished reconstruction download the whole fitting chain.
import './fitting/transformers/Order';

import { correspondingDesks, type DocumentFacts } from './desks/DeskSwitch';
import { lockedScopes, NO_SCOPE_LOCK } from './desks/scopeLock';
import type { SecondaryData } from './desks/TransformerViewProps';
import { read, type MidiFile } from 'midifile-ts';
import { NotesProvider } from './hooks/NotesProvider';
import { PerformancesProvider, type Performance } from './hooks/Performances';
import { parseMetadata } from './mei/insertMetadata';
import { checkPerformance } from './alignment/mlign';
import { ZoomContext } from './hooks/ZoomProvider';
import { CallSelectionProvider } from './hooks/CallSelection';
import { WorkDocumentProvider } from './hooks/WorkDocument';
import { ScoreDocumentProvider } from './hooks/ScoreDocument';
import { useLatest } from './hooks/useLatest';
import { ScrollSyncProvider } from './hooks/ScrollSyncProvider';
import { useTimeMapping } from './hooks/useTimeMapping';
import { PlaybackProvider } from './hooks/PlaybackProvider';
import { PinchZoomHandler } from './hooks/usePinchZoom';
import { DeskToolbarProvider } from './components/DeskToolbar';
import { DeskErrorBoundary } from './components/DeskErrorBoundary';
import { EditorHotkeys } from './components/EditorHotkeys';
import { SampleLoadingNotice } from './components/SampleLoading';
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
    partNamesOf,
    workHistoryReducer,
    type Secondary,
} from './model/workReducer';
import { migrateIfNeeded } from './model/loadWork';
import { buildWorkArchive } from './model/exportWork';
import { sourcesOf, type WorkFile } from './model/Work';
import { documentSlug, downloadAsFile } from './utils/utils';

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
 * The document itself lives in `workReducer`, so the rules that hold the two arrays together are
 * testable without React. Every desk reaches it through `useWorkDocument`, so the aspect registry
 * has no exceptions rendered by name out of a branch here.
 *
 * A new call lands ungrouped: grouping is its own step, with its own desk, and the narrative desk
 * shows what a call wrote in amber until somebody says what it is for.
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
    const [mei, setMEI] = useState<string>();
    const [performances, setPerformances] = useState<readonly Performance[]>([]);
    const [message, setMessage] = useState<string>();

    const [selectedDesk, setSelectedDesk] = useState<string>('metadata');
    const [scope, setScope] = useState<'global' | number>('global');
    const [activeCallIds, setActiveCallIds] = useState<Set<string>>(new Set());
    const [stretchX, setStretchX] = useState<number>(20);

    /**
     * The desk row's node, held in state rather than a ref.
     *
     * A desk portals its own controls into it (`DeskToolbar`). A ref cannot serve that: on the
     * commit where the bar and the desk first render together it is still null, so every desk's
     * toolbar would mount into `document.body` and move to the bar on a later render. A callback
     * ref into state re-renders when the node attaches.
     *
     * The target must hold nothing React owns. React places a child by finding the next host
     * sibling it tracks and calling `insertBefore`; among children that all arrived through
     * portals there is none, so it appends instead, and anything rendered into the target would
     * land after every desk's controls.
     */
    const [deskRow, setDeskRow] = useState<HTMLDivElement | null>(null);

    /**
     * The document as it was last written out, and the hidden input Open reaches through.
     *
     * Dirtiness is `work !== savedWork`, by reference. Sound because `workHistoryReducer` hands
     * back the state it was given when an edit changed nothing, because `load` stores the very
     * object it dispatched, and because undo and redo step between objects the history already
     * holds, so saving, undoing and redoing back lands on the saved reference again.
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
     * What a desk answers `unavailable` against — see `DeskSwitch.tsx`.
     *
     * The two recording counts come off the alignment as *loaded*, never off the fitted one:
     * `MakeChoice` discards the variants it did not prefer, so the chain's output reports a
     * single reading once a choice has been made, and Base Text would take itself away as soon
     * as it had been used.
     *
     * The tempo and unchosen counts come off the last *finished* fit, which `useEditorFit` leaves
     * standing while the next runs, so a refit does not grey a desk out on its way to the same
     * answer. They have to: a `<tempo>` is something the chain writes, and whether `MakeChoice`
     * has collapsed the readings is not something the loaded alignment can know.
     */
    const documentFacts = useMemo<DocumentFacts>(
        () => ({
            readings: pristine?.sources().size ?? 0,
            aligned: pristine?.allNotes.length ?? 0,
            tempos: mpm ? getInstructions(mpm, 'tempo').length : 0,
            unchosen: alignment?.unchosenNotes() ?? 0,
        }),
        [pristine, mpm, alignment],
    );

    /**
     * What the last fit had to say, raised as a message.
     *
     * Adjusted during render against the last one seen, rather than from an effect, which would
     * cost a second render of the whole editor per problem reported. The message stays state
     * because it is not purely derived: a failed load writes one too, and dismissing clears it.
     */
    const fitMessage = problems ? problems.join('\n') : (error ?? undefined);
    const [reportedFitMessage, setReportedFitMessage] = useState(fitMessage);
    if (fitMessage !== reportedFitMessage) {
        setReportedFitMessage(fitMessage);
        if (fitMessage) setMessage(fitMessage);
    }

    /**
     * The MEI, and the alignment read out of it.
     *
     * Called on open and again whenever the alignment desk commits — which is why it takes the
     * content rather than reading state, and why nothing here resets the scope: a rewritten
     * `<performance>` is the same score.
     */
    const readMei = useCallback((content: string) => {
        setMEI(content);
        const converted = convertMeiToMsm(content)[0]?.msm;
        if (!converted) {
            setMessage('The MEI holds no convertible movement.');
            return;
        }
        setPristine(asMSM(content, converted));
    }, []);

    const loadMei = useCallback(
        (content: string) => {
            readMei(content);
            // A new score has new part indices, and the scope picker is a `Select`: left holding
            // a part the score does not have, it renders blank and warns.
            setScope('global');
            // And a new score is not the one the takes in hand were played from.
            setPerformances([]);
            // A score with no recording aligned into it has nothing for any other desk to draw:
            // every one of them plots what the performance did, and there is no performance yet.
            // So it opens where the work actually starts.
            if (!content.includes('<when')) setSelectedDesk('alignment');
        },
        [readMei],
    );

    const loadWorkFromJson = useCallback((content: string) => {
        try {
            const loaded = migrateIfNeeded(content);
            dispatch({ type: 'load', work: loaded });
            setSavedWork(loaded);

            // A link into a call selects it, and this is the moment that can be decided: the
            // document is in hand and the URL has not moved.
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

    /**
     * A performance, read and kept as it arrived.
     *
     * The bytes as well as the parse: the aligner works on the parse, the archive stores the
     * bytes, and `midifile-ts` reads a file without writing one back.
     *
     * The `@source` is the file's stem unless the file names one itself, which a piano-roll scan
     * does. Minted here rather than in the desk because it must be unique against the takes
     * already in hand, which is what this holds.
     */
    const readPerformance = useCallback(
        async (file: File): Promise<Performance | undefined> => {
            const buffer = await file.arrayBuffer();
            const problem = checkPerformance(buffer);
            if (problem) {
                setMessage(problem);
                return undefined;
            }

            let midi: MidiFile;
            try {
                midi = read(buffer);
            } catch {
                setMessage(`${file.name} could not be read as MIDI.`);
                return undefined;
            }

            const stem = file.name.replace(/\.[^.]+$/, '');
            return { source: parseMetadata(midi).source ?? stem, name: file.name, midi, bytes: new Uint8Array(buffer) };
        },
        [],
    );

    const addPerformance = useCallback((performance: Performance) => {
        setPerformances((current) => {
            // By file name, because that is what the archive stores it under: a second take of
            // the same name would replace the first in the zip and leave its `Align` call naming
            // a file that holds somebody else's playing.
            if (current.some((held) => held.name === performance.name)) {
                setMessage(`${performance.name} is already open.`);
                return current;
            }
            return [...current, performance];
        });
    }, []);

    const handleOpenMidi = useCallback(
        async (file: File) => {
            const performance = await readPerformance(file);
            if (performance) addPerformance(performance);
        },
        [readPerformance, addPerformance],
    );

    const handleOpenZip = useCallback(
        async (file: File) => {
            const zip = await JSZip.loadAsync(file);
            const meiFile = zip.file('transcription.mei');
            // `work.json` is the current name; older archives carry `info.json`, and those are
            // worth being able to open.
            const jsonFile = zip.file('work.json') ?? zip.file('info.json');
            // Read before the MEI is: `loadMei` empties the takes, because opening a score is
            // opening a different piece, and an archive's takes are that score's own.
            const midiFiles = zip.file(/^recordings\//);

            if (meiFile) {
                loadMei(await meiFile.async('string'));
                document.title = `${file.name} - MPM Desk`;
            }
            if (jsonFile) loadWorkFromJson(await jsonFile.async('string'));

            for (const entry of midiFiles) {
                const bytes = await entry.async('uint8array');
                const name = entry.name.replace(/^recordings\//, '');
                const midi = read(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
                const stem = name.replace(/\.[^.]+$/, '');
                addPerformance({ source: parseMetadata(midi).source ?? stem, name, midi, bytes });
            }
        },
        [loadMei, loadWorkFromJson, addPerformance],
    );

    const handleOpenFile = useCallback(
        (file: File) => {
            if (file.name.endsWith('.zip')) void handleOpenZip(file);
            else if (file.name.endsWith('.mei') || file.name.endsWith('.xml'))
                void handleOpenMei(file);
            else if (file.name.endsWith('.mid') || file.name.endsWith('.midi'))
                void handleOpenMidi(file);
            // An unrecognised suffix must say so, or it is indistinguishable from a file that
            // failed to parse.
            else setMessage(`Cannot open ${file.name} — expected a .zip, .mei, .xml or .mid.`);
        },
        [handleOpenZip, handleOpenMei, handleOpenMidi],
    );

    /** Opens the picker below. */
    const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);

    /**
     * What a desk's gesture becomes.
     *
     * A desk hands over a constructed `Transformer` and only its three data fields are kept: a
     * call is a name, an id and its options. It lands in no segment, as the note at the top says.
     *
     * Here rather than on `useWorkDocument` because it is two things at once. The document gains
     * a call, and that call becomes the selection, which is `CallSelection`'s half.
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
     * Memoised rather than left as a bare expression: `?? {}` builds a fresh object on every
     * render for a document with no secondary state, which is most of them. It sits in
     * `deskProps`, so all thirteen desks would take a prop that never compares equal, and the
     * save below depends on it.
     */
    const secondary = useMemo(() => (work.secondary ?? {}) as SecondaryData, [work.secondary]);

    /** Title and author, read off the chain's own `InsertMetadata` call — see `workReducer`. */
    const metadata = useMemo(() => metadataOf(work), [work]);

    /**
     * Which reading the chain prefers, as the `@source` a `MakeChoice` named — which is also what
     * the MEI's `<recording>` elements carry, so verovio's `performanceRecording` takes it as is.
     */
    const recording = useMemo(() => sourcesOf(work.provenance)[0] ?? '', [work.provenance]);

    /** What to call each part, read off the chain's own `ProcessVoices` call — likewise. */
    const partNames = useMemo(() => partNamesOf(work), [work]);

    /**
     * The score the performance is rendered against: the alignment's score half, never the raw
     * conversion.
     *
     * The two diverge as soon as a layout combines two voices into one part. The chain fits
     * against the alignment and the MPM's parts are numbered from it, so a score numbered from
     * the MEI's staves would send a part-local instruction to whichever part happened to carry
     * that number, or to none.
     *
     * It also makes a named part safe. espressivo derives a program change from a part's `@name`
     * by *fuzzy* match unless the part carries a `<programChangeMap>` ("melody" renders as GM 53,
     * Voice Oohs). The raw conversion has no such map; `Alignment.build` writes one per part.
     */
    const scoreMsm = useMemo(
        () => alignment?.serializeScore(partNames) ?? '',
        [alignment, partNames],
    );

    const dirty = work !== savedWork;

    /**
     * What to call the archive. The slug itself is `documentSlug`, shared with the markup desk's
     * MIDI render — the two files are the same document under two extensions, and the reasoning
     * about a title that is prose belongs in one place.
     */
    const archiveName = useMemo(() => `${documentSlug(metadata.title)}.zip`, [metadata.title]);

    /**
     * Save, which is a download: the four-file archive the viewer reads.
     *
     * `buildWorkArchive` is the pure, tested half. This is the rest: the download itself, and
     * noticing that the document on disk is now this one.
     *
     * Here rather than in the toolbar because the shortcut calls it too, from a different
     * subtree.
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
            recordings: performances.map(({ name, bytes }) => ({ name, bytes })),
        });

        downloadAsFile(archive, archiveName, 'application/zip');
        setSavedWork(work);
    }, [
        mei,
        mpm,
        alignment,
        result,
        scoreMsm,
        work,
        metadata,
        secondary,
        archiveName,
        performances,
    ]);

    const saveWork = useCallback(() => void handleSave(), [handleSave]);

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
     * Warn on reload, but only when there is something to lose. Asking unconditionally, straight
     * after a save included, is the fastest way to teach somebody to click through the dialog.
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

    const zoomContextValue = useMemo(
        () => ({
            symbolic: { stretchX: stretchX / 200 },
            physical: { stretchX },
            setStretchX,
        }),
        [stretchX],
    );

    const { tickToSeconds, secondsToTick } = useTimeMapping(alignment);

    const performancesValue = useMemo(
        () => ({ performances, openPerformance: (file: File) => void handleOpenMidi(file) }),
        [performances, handleOpenMidi],
    );

    /**
     * The parts the scope picker offers, ascending.
     *
     * `parts()` is a `Set` built by mapping `allNotes`, which the alignment sorts by *date* — so
     * its order is whichever part enters first, not part order. The scope picker is the one
     * reader that never sorted it.
     */
    const parts = useMemo(
        () =>
            Array.from(alignment?.parts() ?? [])
                .sort((a, b) => a - b)
                .map((part) => ({
                    scope: part,
                    label: partNames.get(part + 1) || `Part ${String(part + 1)}`,
                })),
        [alignment, partNames],
    );

    /**
     * Which scopes the open desk may not write into, and why — see `scopeLock.ts` for the rule and
     * `writes` in `DeskSwitch.tsx` for what each desk puts under it.
     */
    const scopeLock = useMemo(
        () => (mpm ? lockedScopes(mpm, deskEntry?.writes ?? [], parts) : NO_SCOPE_LOCK),
        [mpm, deskEntry, parts],
    );

    /**
     * Note `xml:id` ⇒ symbolic date, off the score the performance is rendered against.
     *
     * What turns a sounding note back into a place on the timeline: every follow reads it, and a
     * preview's tick range is placed in a rendering through it. Without it playback reports
     * nothing and a ranged preview falls back to the piece whole.
     *
     * Read off the notes, so it follows `MakeChoice`: an id the chain discarded is not reported.
     */
    const dateByNoteId = useMemo(
        () => new Map(alignment?.allNotes.map((note) => [note['xml:id'], note.date]) ?? []),
        [alignment],
    );

    if (!mei) {
        return <StartScreen onOpenZip={handleOpenZip} onOpenMei={handleOpenMei} />;
    }
    // No `residual` here. A document whose readings still stand side by side has none — and it is
    // exactly the document the reader has to be able to open, because Base Text is where the
    // choice that gives it one is made.
    if (!alignment || !mpm || !result) {
        return <LoadingScreen message={pending ? 'Running the chain' : undefined} />;
    }

    const isNarrativeSelected = deskEntry?.aspect === 'narrative';
    const DeskComponent = deskEntry?.desk;

    /** What the open desk calls itself. */
    const deskName = deskEntry ? (deskEntry.displayName ?? deskEntry.aspect) : selectedDesk;

    // A layout that empties a part leaves the picker holding a scope no note is in, which the
    // `Select` renders blank. Adjusted during render rather than from an effect, as `fitMessage`
    // above is.
    if (scope !== 'global' && !parts.some((part) => part.scope === scope)) {
        setScope('global');
    }

    // And a scope the picker greys out must not be the one the desk is writing into. Greying an
    // option guards the move onto it and nothing else, so a lock coming into force while the
    // picker is already there needs applying here. `holding[0]` is where the map that locked it
    // is.
    if (scopeLock.locked.has(scope)) {
        setScope(scopeLock.holding[0] ?? 'global');
    }

    // A desk the menu greys out must not be the one on screen, or it draws a choice that cannot
    // be made while the row that would take the reader off it is disabled. The alignment desk is
    // where the work starts and is available for every document.
    if (deskEntry?.unavailable?.(documentFacts)) {
        setSelectedDesk('alignment');
    }

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
                    <ScoreDocumentProvider mei={mei} setMei={readMei} recording={recording}>
                        <PerformancesProvider value={performancesValue}>
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
                                        help={deskEntry?.help}
                                        parts={parts}
                                        scope={scope}
                                        setScope={setScope}
                                        scopeLock={scopeLock}
                                        pending={pending}
                                        dirty={dirty}
                                        canPlay={getInstructions(mpm).length > 0}
                                        canSave={work.provenance.length > 0}
                                        onSave={saveWork}
                                        onOpen={openFilePicker}
                                    />

                                    <EditorHotkeys onSave={saveWork} onOpen={openFilePicker} />

                                    <SampleLoadingNotice />

                                    {/* The desk, and the aspect menu that floats over it. This box
                                        is the menu's containing block: the menu is `position:
                                        absolute`, so without one `top: 0` resolves against the
                                        page. No desk reserves a gutter for it; the menu collapses
                                        to an icon when it is in the way. */}
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
                                            documentFacts={documentFacts}
                                        />
                                    </Box>

                                    {/* The narrative desk follows the playhead on its own terms —
                                        rows lit, selection left alone — see `FollowPlayback`. */}
                                    {!isNarrativeSelected && (
                                        <FollowPlayback
                                            mpm={mpm}
                                            signatures={alignment.timeSignatures}
                                        />
                                    )}
                                    <PinchZoomHandler />
                                </ScrollSyncProvider>
                            </CallSelectionProvider>
                        </PlaybackProvider>
                        </PerformancesProvider>
                    </ScoreDocumentProvider>
                </WorkDocumentProvider>

                {/* Open reaches this through `fileInputRef`. It resets its own value on change,
                    or opening the same file twice in a row fires no `change` event at all. */}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/xml,.mei,.zip,.mid,.midi"
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
