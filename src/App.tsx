import React, { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useLatest } from './hooks/useLatest';
import { asMSM } from './utils/asMSM';
import { compareTransformers, MPM, MSM, validate } from 'mpmify';
import { Alert, AppBar, Snackbar, Stack } from '@mui/material';
import { correspondingDesks } from './desks/DeskSwitch';
import { SecondaryData } from './desks/TransformerViewProps';
import './App.css'
import { TransformerStack } from './transformer-stack/TransformerStack';
import { ScopedTransformationOptions, Transformer } from 'mpmify/lib/transformers/Transformer';
import { v4 } from 'uuid';
import { MetadataDesk } from './desks/metadata/MetadataDesk';
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
import { parseWork } from './utils/workImport';
import { usePipelineRunner } from './hooks/usePipelineRunner';
import { usePublicWorkLoader } from './hooks/usePublicWorkLoader';

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

    const loadWorkFromJson = useCallback((content: string) => {
        const parsed = parseWork(content);
        if (parsed.validationMessages.length) {
            setMessage(parsed.validationMessages.join('\n'));
            return;
        }
        setMessage(undefined);
        setTransformers(parsed.transformers);
        setSecondary(parsed.secondary);
        setMetadata(parsed.metadata);
    }, [])

    const handleMeiLoaded = useCallback(async (meiContent: string) => {
        setMEI(meiContent);
        const result = await asMSM(meiContent);
        setMSM(result);
        setInitialMSM(result);
    }, []);

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
                const result = await asMSM(content);
                setMSM(result);
                setInitialMSM(result);
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
                const result = await asMSM(meiContent);
                setMSM(result);
                setInitialMSM(result);
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
    }, [transformersRef]);

    // Hash → Selection: select transformer from URL hash on initial load
    const initialHashSynced = useRef(false);
    useEffect(() => {
        if (initialHashSynced.current || !transformers.length) return;
        const hash = window.location.hash.slice(1);
        initialHashSynced.current = true;
        if (!hash) return;
        const match = transformers.find(t => t.id.startsWith(hash));
        if (match) {
            setActiveTransformerIds(new Set([match.id]));
        }
    }, [transformers]);

    const onHashChange = useEffectEvent(() => {
        const hash = window.location.hash.slice(1);
        if (!hash) {
            if (activeTransformerIds.size > 0) {
                setActiveTransformerIds(new Set());
                history.replaceState(null, '', window.location.pathname + window.location.search);
            }
            return;
        }
        if (activeTransformerIds.size === 1) {
            const [onlyId] = activeTransformerIds;
            if (onlyId.startsWith(hash)) return;
        }
        const match = transformers.find(t => t.id.startsWith(hash));
        if (match) setActiveTransformerIds(new Set([match.id]));
    });

    // Hashchange listener: support back/forward navigation
    useEffect(() => {
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
    }, [onHashChange]);

    useEffect(() => {
        // prevent the user from loosing unsaved changes (editor mode only)
        if (isEditorMode) {
            window.onbeforeunload = () => ''
        }
    }, [isEditorMode]);

    usePublicWorkLoader({
        enabled: !isEditorMode,
        onMeiLoaded: handleMeiLoaded,
        onWorkLoaded: loadWorkFromJson,
        onError: (error) => console.error('Failed to load files:', error),
    });

    usePipelineRunner({
        initialMSM,
        transformers,
        metadata,
        setTransformers,
        setMSM,
        setMPM,
        onValidationError: messages => setMessage(messages.join('\n')),
        onPipelineError: error => setMessage(error),
        onPipelineSuccess: () => setMessage(undefined),
    });

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
        <ZoomContext value={zoomContextValue}>
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
                                            const transformerWithArgumentation = Object.assign(
                                                Object.create(Object.getPrototypeOf(transformer)),
                                                transformer,
                                                {
                                                    argumentation: {
                                                        note: '',
                                                        id: `argumentation-${v4().slice(0, 8)}`,
                                                        conclusion: {
                                                            certainty: 'plausible',
                                                            id: `belief-${v4().slice(0, 8)}`,
                                                            motivation: 'calm'
                                                        },
                                                        type: 'simpleArgumentation'
                                                    }
                                                }
                                            ) as Transformer

                                            setTransformers(prev => {
                                                const newTransformers = [...prev, transformerWithArgumentation].sort(compareTransformers)
                                                const messages = validate(newTransformers)
                                                if (messages.length) {
                                                    setMessage(messages.map(m => m.message).join('\n'))
                                                    return prev
                                                }
                                                return newTransformers
                                            })
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
                                    draggable
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
        </ZoomContext>
    );
};
