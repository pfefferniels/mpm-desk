import React, { useEffect, useMemo, useState } from 'react';
import { measureTime } from './utils/performanceLogger';
import { asMSM } from './asMSM';
import { compareTransformers, importWork, InsertMetadata, MPM, MSM, validate } from 'mpmify';
import { Alert, AppBar, Card, Collapse, Divider, List, ListItemButton, ListItemText, Snackbar, Stack } from '@mui/material';
import { correspondingDesks } from './DeskSwitch';
import './App.css'
import { ExpandLess, ExpandMore } from '@mui/icons-material';
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
import { PlaybackProvider } from './hooks/PlaybackProvider';
import { AppMenu } from './components/AppMenu';

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
    const [toExpand, setToExpand] = useState<string>()
    const [scope, setScope] = useState<'global' | number>('global');

    const [stretchX, setStretchX] = useState<number>(20)

    const [secondary, setSecondary] = useState<Record<string, unknown>>({})

    const [metadata, setMetadata] = useState<{ author: string, title: string }>({ author: '', title: '' })

    const appBarRef = React.useRef<HTMLDivElement>(null);

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

            if (meiFile) {
                const meiContent = await meiFile.async('string');
                setMEI(meiContent);
                setMSM(await asMSM(meiContent));
                setInitialMSM(await asMSM(meiContent));
                document.title = `${file.name} - MPM Desk`;
            }

            if (jsonFile) {
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
        physical: { stretchX: stretchX }
    }), [stretchX]);

    return (
        <ZoomContext.Provider value={zoomContextValue}>
            <div style={{ maxWidth: '100vw' }}>
                <PlaybackProvider mei={mei} msm={msm} mpm={mpm}>
                    <AppBar position='static' color='transparent' elevation={1}>
                        <Stack direction='row' ref={appBarRef} spacing={1} sx={{ p: 1 }}>
                            <AppMenu
                                isEditorMode={isEditorMode}
                                mei={mei}
                                msm={msm}
                                mpm={mpm}
                                transformers={transformers}
                                metadata={metadata}
                                secondary={secondary}
                                scope={scope}
                                setScope={setScope}
                                stretchX={stretchX}
                                setStretchX={setStretchX}
                                selectedDesk={selectedDesk}
                                setActiveTransformer={setActiveTransformer}
                                onFileImport={handleFileImport}
                                onFileChange={handleFileChange}
                                onReset={() => reset(transformers)}
                            />
                        </Stack>
                    </AppBar>

                    <SelectionProvider
                        activeTransformer={activeTransformer}
                        setActiveTransformer={setActiveTransformer}
                        transformers={transformers}
                    >
                        <ScrollSyncProvider>
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

                <Card
                    elevation={5}
                    sx={{
                        position: 'absolute',
                        top: 0,
                        right: 0,
                        backdropFilter: 'blur(17px)',
                        background: 'rgba(255, 255, 255, 0.6)',
                        marginTop: '1rem',
                        marginRight: '1rem',
                        width: 'fit-content',
                        minWidth: '200px',
                    }}
                >
                    <List>
                        <ListItemButton
                            selected={selectedDesk === 'metadata'}
                            onClick={() => {
                                setSelectedDesk('metadata')
                                setToExpand(undefined)
                            }}
                        >
                            <ListItemText>metadata</ListItemText>
                        </ListItemButton>
                        <Divider sx={{ my: 1 }} />
                        {(() => {
                            const aspectGroups = Array.from(
                                Map.groupBy(correspondingDesks, desk => desk.aspect)
                            );
                            let lastGroup: string | undefined;

                            return aspectGroups.map(([aspect, info]) => {
                                if (info.length === 0) return null;

                                const currentGroup = info[0].group;
                                const showDivider = lastGroup !== undefined && currentGroup !== lastGroup;
                                lastGroup = currentGroup;

                                return (
                                    <React.Fragment key={aspect}>
                                        {showDivider && <Divider sx={{ my: 1 }} />}
                                        {info.length === 1
                                            ? (
                                                <ListItemButton
                                                    selected={aspect === selectedDesk}
                                                    onClick={() => {
                                                        setSelectedDesk(aspect)
                                                        setToExpand(undefined)
                                                    }}
                                                >
                                                    <ListItemText>{aspect}</ListItemText>
                                                </ListItemButton>
                                            )
                                            : (
                                                <ListItemButton
                                                    selected={aspect === toExpand}
                                                    onClick={() => {
                                                        setToExpand(aspect === toExpand ? undefined : aspect)
                                                    }}
                                                >
                                                    <ListItemText>{aspect}</ListItemText>
                                                    {aspect === toExpand ? <ExpandLess /> : <ExpandMore />}
                                                </ListItemButton>
                                            )}

                                        {info.length > 1 && (
                                            <Collapse in={toExpand === aspect} timeout="auto" unmountOnExit>
                                                <List dense component='div' disablePadding sx={{ pl: 3 }}>
                                                    {info.map(({ displayName }) => {
                                                        if (!displayName) return null

                                                        return (
                                                            <ListItemButton
                                                                key={displayName}
                                                                selected={displayName === selectedDesk}
                                                                onClick={() => {
                                                                    setSelectedDesk(displayName)
                                                                }}>
                                                                <ListItemText>{displayName}</ListItemText>
                                                            </ListItemButton>
                                                        )
                                                    })}
                                                </List>
                                            </Collapse>
                                        )}
                                    </React.Fragment>
                                )
                            });
                        })()}
                    </List>
                </Card>

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
