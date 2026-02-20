import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compareTransformers, importWork, MPM, MSM } from 'mpmify';
import { Transformer } from 'mpmify/lib/transformers/Transformer';
import { asMSM } from './asMSM';
import { TransformerStack } from './transformer-stack/TransformerStack';
import { ZoomContext } from './hooks/ZoomProvider';
import { SelectionProvider } from './hooks/SelectionProvider';
import { ScrollSyncProvider } from './hooks/ScrollSyncProvider';
import { PlaybackProvider } from './hooks/PlaybackProvider';
import { PianoContextProvider } from 'react-pianosound';
import { useTimeMapping } from './hooks/useTimeMapping';

const ViewerInner = () => {
    const [initialMSM, setInitialMSM] = useState<MSM>(new MSM());
    const [msm, setMSM] = useState<MSM>(new MSM());
    const [mpm, setMPM] = useState<MPM>(new MPM());
    const [mei, setMEI] = useState<string>();
    const [transformers, setTransformers] = useState<Transformer[]>([]);
    const [activeTransformerIds, setActiveTransformerIds] = useState<Set<string>>(new Set());
    const [stretchX, setStretchX] = useState<number>(20);

    const loadWorkFromJson = useCallback((content: string) => {
        const { transformers: loaded } = importWork(content);
        const nonMetadata = loaded.filter(t => t.name !== 'InsertMetadata');
        setTransformers(nonMetadata.sort(compareTransformers));
    }, []);

    useEffect(() => {
        const loadFiles = async () => {
            try {
                const meiResponse = await fetch('/transcription.mei');
                if (meiResponse.ok) {
                    const meiContent = await meiResponse.text();
                    setMEI(meiContent);
                    const parsed = await asMSM(meiContent);
                    setMSM(parsed);
                    setInitialMSM(parsed);
                }

                const jsonResponse = await fetch('/info.json');
                if (jsonResponse.ok) {
                    const jsonContent = await jsonResponse.text();
                    loadWorkFromJson(jsonContent);
                }
            } catch (e) {
                console.error('Failed to load files:', e);
            }
        };

        loadFiles();
    }, [loadWorkFromJson]);

    // Pipeline worker
    const workerRef = useRef<Worker>(null);
    const requestIdRef = useRef(0);

    useEffect(() => {
        workerRef.current = new Worker(
            new URL('./pipeline.worker.ts', import.meta.url),
            { type: 'module' }
        );
        return () => workerRef.current?.terminate();
    }, []);

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
            metadata: { author: '', title: '' }
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

                for (const t of transformers) {
                    if (data.created[t.id]) {
                        t.created = data.created[t.id];
                    }
                }

                setMPM(newMPM);
                setMSM(newMSM);
            }
        };

        workerRef.current.addEventListener('message', handler);
        return () => workerRef.current?.removeEventListener('message', handler);
    }, [transformers, initialMSM]);

    const focusTransformer = useCallback((_id: string) => {}, []);

    const zoomContextValue = useMemo(() => ({
        symbolic: { stretchX: stretchX / 200 },
        physical: { stretchX },
        setStretchX
    }), [stretchX]);

    const { tickToSeconds, secondsToTick } = useTimeMapping(msm);

    return (
        <ZoomContext value={zoomContextValue}>
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
                        <TransformerStack
                            transformers={transformers}
                            setTransformers={setTransformers}
                            msm={msm}
                            mpm={mpm}
                        />
                    </ScrollSyncProvider>
                </SelectionProvider>
            </PlaybackProvider>
        </ZoomContext>
    );
};

export const Viewer = () => (
    <PianoContextProvider velocities={3}>
        <ViewerInner />
    </PianoContextProvider>
);
