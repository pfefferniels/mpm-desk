import React, { useEffect, useMemo, useState } from 'react';
import { measureTime } from './utils/performanceLogger';
import { asMSM } from './asMSM';
import { compareTransformers, importWork, InsertMetadata, MPM, MSM, validate } from 'mpmify';
import { Alert, AppBar, Snackbar, Stack } from '@mui/material';
import { correspondingDesks } from './DeskSwitch';
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
import { SvgDndProvider } from './transformer-stack/svg-dnd';
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
    const [activeTransformer, setActiveTransformer] = useState<Transformer>()
    const [message, setMessage] = useState<string>()

    const [selectedDesk, setSelectedDesk] = useState<string>('metadata')
    const [scope, setScope] = useState<'global' | number>('global');

    const [stretchX, setStretchX] = useState<number>(20)

    const [secondary, setSecondary] = useState<Record<string, unknown>>({})

    const [metadata, setMetadata] = useState<{ author: string, title: string }>({ author: '', title: '' })

    const appBarRef = React.useRef<HTMLDivElement>(null);
    const activeTransformerRef = React.useRef(activeTransformer);
    activeTransformerRef.current = activeTransformer;

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files ? event.target.files[0] : null;
        if (!file) return

        const reader = new FileReader();

        if (file.name.endsWith('.json')) {
            reader.onload = async (e: ProgressEvent<FileReader>) => {
                const content = e.target?.result as string;
                const { transformers, secondary: loadedSecondary } = importWork(content);
                const messages = validate(transformers);
                if (messages.length) {
                    setMessage(messages.map(m => m.message).join('\n'));
                    return;
                }
                setMessage(undefined);
                const nonMetadataTransformers = transformers.filter(t => t.name !== 'InsertMetadata')
                setTransformers(nonMetadataTransformers.sort(compareTransformers));
                setSecondary(loadedSecondary ?? {});
                setMetadata(extractMetadataFromTransformers(transformers));
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

            console.log('Processing ZIP file:', file.name);

            if (meiFile) {
                console.log('Found MEI file in ZIP:', meiFile.name);
                const meiContent = await meiFile.async('string');
                setMEI(meiContent);
                setMSM(await asMSM(meiContent));
                setInitialMSM(await asMSM(meiContent));
                document.title = `${file.name} - MPM Desk`;
            }

            if (jsonFile) {
                console.log('Found JSON file in ZIP:', jsonFile.name);
                const jsonContent = await jsonFile.async('string');
                const { transformers, secondary: loadedSecondary } = importWork(jsonContent);
                const messages = validate(transformers);
                if (messages.length) {
                    setMessage(messages.map(m => m.message).join('\n'));
                    return;
                }
                setMessage(undefined);
                const nonMetadataTransformers = transformers.filter(t => t.name !== 'InsertMetadata')
                setTransformers(nonMetadataTransformers.sort(compareTransformers));
                setSecondary(loadedSecondary ?? {});
                setMetadata(extractMetadataFromTransformers(transformers));
            }
            return;
        }
    };

    const handleFileImport = () => {
        const fileInput = document.getElementById('fileInput') as HTMLInputElement;
        fileInput.click();
    };

    const reset = (newTransformers: Transformer[]) => {
        console.log('resetting', newTransformers)
        const message = validate(newTransformers)
        if (message.length) {
            setMessage(message.map(m => m.message).join('\n'))
            return
        }

        const newMPM = new MPM()
        const newMSM = initialMSM ? initialMSM.deepClone() : new MSM()

        newTransformers.forEach(t => {
            t.run(newMSM, newMPM)
        })

        setMPM(newMPM)
        setMSM(newMSM)
        setTransformers(newTransformers)
    }

    useEffect(() => {
        if (!activeTransformer) return

        const entry = correspondingDesks
            .filter(entry => !!entry.transformer)
            .find(({ transformer }) => transformer!.name === activeTransformer.name)

        if (!entry) return
        setSelectedDesk(entry.displayName || entry.aspect)

        if ('scope' in activeTransformer.options) {
            setScope((activeTransformer.options as ScopedTransformationOptions).scope)
        }
    }, [activeTransformer])

    // Hash → Selection: select transformer from URL hash when transformers load
    useEffect(() => {
        const hash = window.location.hash.slice(1);
        if (!hash || !transformers.length) return;
        const match = transformers.find(t => t.id.startsWith(hash));
        if (match && match.id !== activeTransformerRef.current?.id) {
            setActiveTransformer(match);
        }
    }, [transformers]);

    // Selection → Hash: update URL hash when active transformer changes
    useEffect(() => {
        if (!transformers.length) return;
        const currentHash = window.location.hash.slice(1);
        if (activeTransformer) {
            const prefix = activeTransformer.id.slice(0, 8);
            if (currentHash !== prefix) {
                history.pushState(null, '', '#' + prefix);
            }
        } else if (currentHash) {
            history.pushState(null, '', window.location.pathname + window.location.search);
        }
    }, [activeTransformer]);

    // Hashchange listener: support back/forward navigation
    useEffect(() => {
        const onHashChange = () => {
            const hash = window.location.hash.slice(1);
            if (!hash) {
                if (activeTransformerRef.current) {
                    setActiveTransformer(undefined);
                }
                return;
            }
            if (activeTransformerRef.current?.id.startsWith(hash)) return;
            const match = transformers.find(t => t.id.startsWith(hash));
            if (match) setActiveTransformer(match);
        };
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
    }, [transformers]);

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
                    const { transformers: loadedTransformers, secondary: loadedSecondary } = importWork(jsonContent);
                    const messages = validate(loadedTransformers);
                    if (messages.length === 0) {
                        const nonMetadataTransformers = loadedTransformers.filter(t => t.name !== 'InsertMetadata')
                        setTransformers(nonMetadataTransformers.sort(compareTransformers));
                        setSecondary(loadedSecondary ?? {});
                        setMetadata(extractMetadataFromTransformers(loadedTransformers));
                    }
                }
            } catch (e) {
                console.error('Failed to load files:', e);
            }
        };

        loadFiles();
    }, [isEditorMode]);

    useEffect(() => {
        console.log('Recomputing MSM and MPM from transformers');
        console.log('Initial MSM has', initialMSM.allNotes.length, 'notes');
        if (initialMSM.allNotes.length === 0) return;

        // Create InsertMetadata transformer from metadata state
        const metadataTransformer = new InsertMetadata({
            authors: metadata.author ? [{ number: 0, text: metadata.author }] : [],
            comments: metadata.title ? [{ text: metadata.title }] : []
        })
        metadataTransformer.argumentation = {
            note: '',
            id: 'argumentation-metadata',
            conclusion: {
                certainty: 'authentic',
                id: 'belief-metadata',
                motivation: 'unknown'
            },
            type: 'simpleArgumentation'
        }

        // Combine with other transformers
        const allTransformers = [metadataTransformer, ...transformers].sort(compareTransformers)

        const messages = validate(allTransformers);
        if (messages.length) {
            setMessage(messages.map(m => m.message).join('\n'));
            return;
        }

        const newMPM = new MPM();
        const newMSM = measureTime('initialMSM.deepClone', () => initialMSM.deepClone());

        measureTime(`run ${allTransformers.length} transformers`, () => {
            allTransformers.forEach(t => {
                t.run(newMSM, newMPM);
            });
        });

        setMPM(newMPM);
        setMSM(newMSM);
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
                        activeTransformer={activeTransformer}
                        setActiveTransformer={setActiveTransformer}
                        transformers={transformers}
                        setTransformers={setTransformers}
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
                                    selectedDesk={selectedDesk}
                                    onFileImport={handleFileImport}
                                    onFileChange={handleFileChange}
                                />
                            </Stack>
                        </AppBar>
                        <ScrollSyncProvider
                            symbolicZoom={zoomContextValue.symbolic.stretchX}
                            physicalZoom={zoomContextValue.physical.stretchX}
                            tickToSeconds={tickToSeconds}
                            secondsToTick={secondsToTick}
                        >
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
                                                    motivation: 'unknown'
                                                },
                                                type: 'simpleArgumentation'
                                            }

                                            transformer.run(msm, mpm)
                                            setTransformers(newTransformers)
                                            setMSM(msm.clone())
                                            setMPM(mpm.clone())
                                        }}
                                        part={scope}
                                    />
                                )}
                            </NotesProvider>

                            <FloatingZoom />
                            <div style={{ position: 'absolute', left: 0, bottom: 0 }}>
                                <SvgDndProvider>
                                    <TransformerStack
                                        transformers={transformers}
                                        setTransformers={setTransformers}
                                        msm={msm}
                                        onRemove={transformer => reset(transformers.filter(t => t !== transformer))}
                                    />
                                </SvgDndProvider>
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
