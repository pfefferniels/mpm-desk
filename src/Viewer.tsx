import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { exportWork, MPM, MSM } from 'mpmify';
import { getRange, Transformer } from 'mpmify/lib/transformers/Transformer';
import { exportMPM } from '../../mpm-ts/lib';
import JSZip from 'jszip';
import { asMSM } from './utils/asMSM';
import { TransformerStack } from './transformer-stack/TransformerStack';
import { ZoomContext } from './hooks/ZoomProvider';
import { SelectionProvider } from './hooks/SelectionProvider';
import { ScrollSyncProvider } from './hooks/ScrollSyncProvider';
import { PlaybackProvider } from './hooks/PlaybackProvider';
import { PianoContextProvider } from 'react-pianosound';
import { useTimeMapping } from './hooks/useTimeMapping';
import { ViewerToolbar } from './components/ViewerToolbar';
import { downloadAsFile } from './utils/utils';
import { parseWork } from './utils/workImport';
import { usePipelineRunner } from './hooks/usePipelineRunner';
import { usePublicWorkLoader } from './hooks/usePublicWorkLoader';
import { PinchZoomHandler } from './hooks/usePinchZoom';

const ViewerInner = () => {
    const [initialMSM, setInitialMSM] = useState<MSM>(new MSM());
    const [msm, setMSM] = useState<MSM>(new MSM());
    const [mpm, setMPM] = useState<MPM>(new MPM());
    const [mei, setMEI] = useState<string>();
    const [transformers, setTransformers] = useState<Transformer[]>([]);
    const [activeTransformerIds, setActiveTransformerIds] = useState<Set<string>>(new Set());
    const [stretchX, setStretchX] = useState<number>(20);
    const [metadata, setMetadata] = useState<{ title: string; author: string }>({ title: '', author: '' });
    const hasSetInitialZoom = useRef(false);

    // Fit piece to viewport width on first load
    useEffect(() => {
        if (hasSetInitialZoom.current || transformers.length === 0) return;
        const maxDate = getRange(transformers, msm)?.to;
        if (!maxDate) return;
        const fitStretch = Math.min(60, Math.max(1, (window.innerWidth * 200) / maxDate));
        setStretchX(fitStretch);
        hasSetInitialZoom.current = true;
    }, [transformers, msm]);

    const loadWorkFromJson = useCallback((content: string) => {
        const parsed = parseWork(content);
        if (parsed.validationMessages.length > 0) return;
        setMetadata(parsed.metadata);
        setTransformers(parsed.transformers);
    }, []);

    const handleMeiLoaded = useCallback(async (meiContent: string) => {
        setMEI(meiContent);
        const parsed = await asMSM(meiContent);
        setMSM(parsed);
        setInitialMSM(parsed);
    }, []);

    usePublicWorkLoader({
        enabled: true,
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
        onValidationError: (messages) => console.error(messages.join('\n')),
        onPipelineError: (error) => console.error(error),
    });

    const focusTransformer = useCallback((id: string) => {
        setActiveTransformerIds(new Set([id]));
    }, []);

    const handleDownload = useCallback(async () => {
        if (!mei) return;

        const json = exportWork({
            name: 'Reconstruction',
            mpm: 'performance.mpm',
            mei: 'transcription.mei',
        }, transformers, {});

        const zip = new JSZip();
        zip.file('performance.mpm', exportMPM(mpm));
        zip.file('transcription.mei', mei);
        zip.file('info.json', json);

        const content = await zip.generateAsync({ type: 'blob' });
        downloadAsFile(content, 'export.zip', 'application/zip');
    }, [mei, mpm, transformers]);

    const zoomContextValue = useMemo(() => ({
        symbolic: { stretchX: stretchX / 200 },
        physical: { stretchX },
        setStretchX
    }), [stretchX]);

    const { tickToSeconds, secondsToTick } = useTimeMapping(msm);

    return (
        <ZoomContext value={zoomContextValue}>
            <PlaybackProvider mei={mei} msm={msm} mpm={mpm}>
                <ViewerToolbar onDownload={handleDownload} metadata={metadata} />
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
                        <PinchZoomHandler />
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100vh',
                        }}>
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
        </ZoomContext>
    );
};

export const Viewer = () => (
    <PianoContextProvider velocities={3}>
        <ViewerInner />
    </PianoContextProvider>
);
