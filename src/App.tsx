import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLatest } from './hooks/useLatest';
import { asMSM } from './asMSM';
import { compareTransformers, importWork, InsertMetadata, MPM, MSM, validate } from 'mpmify';
import { Alert, AppBar, Snackbar, Stack } from '@mui/material';
import { correspondingDesks } from './DeskSwitch';
import { SecondaryData } from './TransformerViewProps';
import './App.css'
import { TransformerStack } from './transformer-stack/TransformerStack';
import { ScopedTransformationOptions, Transformer } from 'mpmify/lib/transformers/Transformer';
import { v4 } from 'uuid';
import { MetadataDesk } from './metadata/MetadataDesk';
import { NotesProvider } from './hooks/NotesProvider';
import { ZoomContext } from './hooks/ZoomProvider';
import { SelectionProvider } from './hooks/SelectionProvider';
import { useMode } from './hooks/ModeProvider';
import JSZip from 'jszip'
import { ScrollSyncProvider } from './hooks/ScrollSyncProvider';
import { useTimeMapping } from './hooks/useTimeMapping';
import { PlaybackProvider } from './hooks/PlaybackProvider';
import { AppMenu } from './components/AppMenu';
import { AspectSelect } from './components/AspectSelect';
import { FloatingZoom } from './components/FloatingZoom';

const extractMetadataFromTransformers = (transformers: Transformer[]): { author: string, title: string } => {
    const metadataTransformer = transformers.find(t => t.name === 'InsertMetadata') as InsertMetadata | undefined
    if (!metadataTransformer) return { author: '', title: '' }
    return {
        author: metadataTransformer.options.authors?.[0]?.text ?? '',
        title: metadataTransformer.options.comments?.[0]?.text ?? ''
    }
}

export const App = () => {
    const { isEditorMode } = useMode();

    const [initialMSM, setInitialMSM] = useState<MSM>(new MSM());

    const [msm, setMSM] = useState<MSM>(new MSM());
    const [mpm, setMPM] = useState<MPM>(new MPM());
    const [mei, setMEI] = useState<string>()

    const [transformers, setTransformers] = useState<Transformer[]>([])
    const [secondary, setSecondary] = useState<SecondaryData>({})
    const [metadata, setMetadata] = useState<{ author: string, title: string }>({ author: '', title: '' })

    const [activeTransformerIds, setActiveTransformerIds] = useState<Set<string>>(new Set())
    const [message, setMessage] = useState<string>()

    const [selectedDesk, setSelectedDesk] = useState<string>('metadata')
    const [scope, setScope] = useState<'global' | number>('global');

    const [stretchX, setStretchX] = useState<number>(20)

    const appBarRef = React.useRef<HTMLDivElement>(null);
    const transformersRef = useLatest(transformers);
    const activeTransformerIdsRef = useLatest(activeTransformerIds);

    const loadWorkFromJson = useCallback((content: string) => {
        const { transformers: loaded, secondary: loadedSecondary } = importWork(content);
        const messages = validate(loaded);
        if (messages.length) {
            setMessage(messages.map(m => m.message).join('\n'));
            return;
        }
        setMessage(undefined);
        const nonMetadata = loaded.filter(t => t.name !== 'InsertMetadata')
        setTransformers(nonMetadata.sort(compareTransformers));
        setSecondary(loadedSecondary ?? {});
        setMetadata(extractMetadataFromTransformers(loaded));
    }, [])

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files ? event.target.files[0] : null;
        if (!file) return

        const reader = new FileReader();

        if (file.name.endsWith('.json')) {
            reader.onload = async (e: ProgressEvent<FileReader>) => {
                const content = e.target?.result as string;
                loadWorkFromJson(content)
            };
            reader.readAsText(file);
        }
        else if (file.name.endsWith('.mei') || file.name.endsWith('.xml')) {
            reader.onload = async (e: ProgressEvent<FileReader>) => {
                const content = e.target?.result as string;
                setMEI(content);
                setMSM(await asMSM(content));
                setInitialMSM(await asMSM(content));
                document.title = `${file.name} - MPM Desk`
            };
            reader.readAsText(file);
        }
        else if (file.name.endsWith('.zip')) {
            const zip = await JSZip.loadAsync(file);

            const meiFile = zip.file('transcription.mei');
            const jsonFile = zip.file('info.json');

            if (meiFile) {
                const meiContent = await meiFile.async('string');
                setMEI(meiContent);
                setMSM(await asMSM(meiContent));
                setInitialMSM(await asMSM(meiContent));
                document.title = `${file.name} - MPM Desk`;
            }

            if (jsonFile) {
                const jsonContent = await jsonFile.async('string');
                loadWorkFromJson(jsonContent)
            }
            return;
        }
    };

    const handleFileImport = () => {
        const fileInput = document.getElementById('fileInput') as HTMLInputElement;
        fileInput.click();
    };

    // Manual click: switch desk, update scope, update hash, set selection to single transformer
    const focusTransformer = useCallback((id: string) => {
        const transformer = transformersRef.current.find(t => t.id === id);
        if (!transformer) return;

        const entry = correspondingDesks
            .filter(entry => !!entry.transformer)
            .find(({ transformer: t }) => t!.name === transformer.name);

        if (entry) {
            setSelectedDesk(entry.displayName || entry.aspect);
        }

        if ('scope' in transformer.options) {
            setScope((transformer.options as ScopedTransformationOptions).scope);
        }

        // Update URL hash
        const prefix = transformer.id.slice(0, 8);
        const currentHash = window.location.hash.slice(1);
        if (currentHash !== prefix) {
            history.pushState(null, '', '#' + prefix);
        }

        setActiveTransformerIds(new Set([id]));
    }, []);

    // Hash → Selection: select transformer from URL hash when transformers load
    useEffect(() => {
        const hash = window.location.hash.slice(1);
        if (!hash || !transformers.length) return;
        const match = transformers.find(t => t.id.startsWith(hash));
        if (match && !activeTransformerIdsRef.current.has(match.id)) {
            setActiveTransformerIds(new Set([match.id]));
        }
    }, [transformers]);

    // Hashchange listener: support back/forward navigation
    useEffect(() => {
        const onHashChange = () => {
            const hash = window.location.hash.slice(1);
            if (!hash) {
                if (activeTransformerIdsRef.current.size > 0) {
                    setActiveTransformerIds(new Set());
                    history.replaceState(null, '', window.location.pathname + window.location.search);
                }
                return;
            }
            const currentIds = activeTransformerIdsRef.current;
            if (currentIds.size === 1) {
                const [onlyId] = currentIds;
                if (onlyId.startsWith(hash)) return;
            }
            const match = transformersRef.current.find(t => t.id.startsWith(hash));
            if (match) setActiveTransformerIds(new Set([match.id]));
        };
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
    }, []);

    useEffect(() => {
        // prevent the user from loosing unsaved changes (editor mode only)
        if (isEditorMode) {
            window.onbeforeunload = () => ''
        }
    }, [isEditorMode]);

    useEffect(() => {
        // auto-load files in view mode
        if (isEditorMode) return;

        const loadFiles = async () => {
            try {
                const meiResponse = await fetch('/transcription.mei');
                if (meiResponse.ok) {
                    const meiContent = await meiResponse.text();
                    setMEI(meiContent);
                    setMSM(await asMSM(meiContent));
                    setInitialMSM(await asMSM(meiContent));
                }

                const jsonResponse = await fetch('/info.json');
                if (jsonResponse.ok) {
                    const jsonContent = await jsonResponse.text();
                    loadWorkFromJson(jsonContent)
                }
            } catch (e) {
                console.error('Failed to load files:', e);
            }
        };

        loadFiles();
    }, [isEditorMode, loadWorkFromJson]);

    // Pipeline worker for off-main-thread transformation
    const workerRef = useRef<Worker>();
    const requestIdRef = useRef(0);

    useEffect(() => {
        workerRef.current = new Worker(
            new URL('./pipeline.worker.ts', import.meta.url),
            { type: 'module' }
        );
        return () => workerRef.current?.terminate();
    }, []);

    // Reconciliation: rebuild MSM/MPM whenever transformers or metadata change
    useEffect(() => {
        if (initialMSM.allNotes.length === 0) return;
        if (!workerRef.current) return;

        const requestId = ++requestIdRef.current;

        workerRef.current.postMessage({
            type: 'run-pipeline',
            requestId,
            transformers: transformers.map(t => ({
                id: t.id,
                name: t.name,
                options: t.options,
                created: t.created,
                argumentation: t.argumentation
            })),
            msm: {
                allNotes: initialMSM.allNotes,
                pedals: initialMSM.pedals,
                timeSignature: initialMSM.timeSignature
            },
            metadata
        });

        const handler = (event: MessageEvent) => {
            const data = event.data;
            if (data.requestId !== requestIdRef.current) return;
            workerRef.current?.removeEventListener('message', handler);

            if (data.type === 'pipeline-result') {
                const newMSM = new MSM();
                newMSM.allNotes = data.msm.allNotes;
                newMSM.pedals = data.msm.pedals;
                newMSM.timeSignature = data.msm.timeSignature;

                const newMPM = new MPM();
                newMPM.doc = data.mpmDoc;

                // Sync created arrays back to main-thread transformer instances
                for (const t of transformers) {
                    if (data.created[t.id]) {
                        t.created = data.created[t.id];
                    }
                }

                setMPM(newMPM);
                setMSM(newMSM);
                setMessage(undefined);
            } else if (data.type === 'validation-error') {
                setMessage(data.messages.join('\n'));
            } else if (data.type === 'pipeline-error') {
                setMessage(data.error);
            }
        };

        workerRef.current.addEventListener('message', handler);
        return () => workerRef.current?.removeEventListener('message', handler);
    }, [transformers, initialMSM, metadata]);

    const isMetadataSelected = selectedDesk === 'metadata'
    const DeskComponent = correspondingDesks
        .find(info => info.displayName === selectedDesk || info.aspect === selectedDesk)?.desk;

    // Memoize context value to prevent unnecessary re-renders of all consumers
    const zoomContextValue = useMemo(() => ({
        symbolic: { stretchX: stretchX / 200 },
        physical: { stretchX: stretchX },
        setStretchX
    }), [stretchX]);

    const { tickToSeconds, secondsToTick } = useTimeMapping(msm);

    return (
        <ZoomContext.Provider value={zoomContextValue}>
            <div style={{ maxWidth: '100vw' }}>
                <PlaybackProvider mei={mei} msm={msm} mpm={mpm}>
                    <SelectionProvider
                        activeTransformerIds={activeTransformerIds}
                        setActiveTransformerIds={setActiveTransformerIds}
                        transformers={transformers}
                        setTransformers={setTransformers}
                        focusTransformer={focusTransformer}
                    >
                        <ScrollSyncProvider
                            symbolicZoom={zoomContextValue.symbolic.stretchX}
                            physicalZoom={zoomContextValue.physical.stretchX}
                            tickToSeconds={tickToSeconds}
                            secondsToTick={secondsToTick}
                        >
                            <AppBar position='static' color='transparent' elevation={1}>
                                <Stack direction='row' ref={appBarRef} spacing={1} sx={{ p: 1 }}>
                                    <AppMenu
                                        mei={mei}
                                        msm={msm}
                                        mpm={mpm}
                                        transformers={transformers}
                                        metadata={metadata}
                                        secondary={secondary}
                                        scope={scope}
                                        setScope={setScope}
                                        onFileImport={handleFileImport}
                                        onFileChange={handleFileChange}
                                    />
                                </Stack>
                            </AppBar>
                            <NotesProvider notes={msm.allNotes}>
                                {isMetadataSelected ? (
                                    <MetadataDesk
                                        metadata={metadata}
                                        setMetadata={setMetadata}
                                        appBarRef={isEditorMode ? appBarRef : null}
                                        isEditorMode={isEditorMode}
                                    />
                                ) : DeskComponent && (
                                    <DeskComponent
                                        appBarRef={isEditorMode ? appBarRef : null}
                                        msm={msm}
                                        mpm={mpm}
                                        setMSM={setMSM}
                                        setMPM={setMPM}
                                        secondary={secondary}
                                        setSecondary={setSecondary}
                                        addTransformer={(transformer: Transformer) => {
                                            const newTransformers = [...transformers, transformer].sort(compareTransformers)
                                            const messages = validate(newTransformers)
                                            if (messages.length) {
                                                setMessage(messages.map(m => m.message).join('\n'))
                                                return
                                            }

                                            transformer.argumentation = {
                                                note: '',
                                                id: `argumentation-${v4().slice(0, 8)}`,
                                                conclusion: {
                                                    certainty: 'plausible',
                                                    id: `belief-${v4().slice(0, 8)}`,
                                                    motivation: 'calm'
                                                },
                                                type: 'simpleArgumentation'
                                            }

                                            setTransformers(newTransformers)
                                        }}
                                        part={scope}
                                    />
                                )}
                            </NotesProvider>

                            <FloatingZoom />
                            <div style={{ position: 'absolute', left: 0, bottom: 0 }}>
                                <TransformerStack
                                    transformers={transformers}
                                    setTransformers={setTransformers}
                                    msm={msm}
                                    mpm={mpm}
                                />
                            </div>
                        </ScrollSyncProvider>
                    </SelectionProvider>
                </PlaybackProvider>

                <AspectSelect
                    selectedDesk={selectedDesk}
                    setSelectedDesk={setSelectedDesk}
                />

                <Snackbar open={message !== undefined} autoHideDuration={4000} onClose={() => setMessage(undefined)}>
                    <Alert
                        onClose={() => setMessage(undefined)}
                        severity="error"
                        variant="filled"
                        sx={{ width: '40%' }}
                    >
                        {message}
                    </Alert>
                </Snackbar>
            </div>
        </ZoomContext.Provider>
    );
};
