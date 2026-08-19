import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseMPM } from 'mpm-ts';
import JSZip from 'jszip';
import { SegmentStack } from './segment-stack/SegmentStack';
import { ZoomContext } from './hooks/ZoomProvider';
import { SelectionProvider } from './hooks/SelectionProvider';
import { ScrollSyncProvider } from './hooks/ScrollSyncProvider';
import { PlaybackProvider } from './hooks/PlaybackProvider';
import { PianoContextProvider } from 'react-pianosound';
import { ViewerToolbar } from './components/ViewerToolbar';
import { downloadAsFile } from './utils/utils';
import { readNoteDates } from './utils/score';
import { useReconstruction } from './hooks/useReconstructionLoader';
import { PinchZoomHandler } from './hooks/usePinchZoom';
import { LoadingScreen } from './components/LoadingScreen';

const ViewerInner = () => {
    const { work, error } = useReconstruction();
    const [stretchX, setStretchX] = useState<number>(20);
    const [fitted, setFitted] = useState(false);

    const segments = work?.reconstruction.segments;

    // Fit piece to viewport width once the segments are in
    useEffect(() => {
        if (fitted || !segments?.length) return;
        const maxDate = segments.reduce((max, segment) => Math.max(max, segment.to), 0);
        if (!maxDate) return;
        setStretchX(Math.min(60, Math.max(1, (window.innerWidth * 200) / maxDate)));
        setFitted(true);
    }, [segments, fitted]);

    // Both are parsed once: the MPM for the instructions a popover shows and for
    // "what is in effect now", the MSM for note dates. Neither changes.
    const mpm = useMemo(() => work && parseMPM(work.performanceMpm), [work]);
    const dateByNoteId = useMemo(() => work ? readNoteDates(work.scoreMsm) : new Map(), [work]);

    const handleDownload = useCallback(async () => {
        if (!work) return;

        // The MEI is the provenance of the other three, and nothing on screen
        // needs it — so it is fetched here rather than on load.
        const response = await fetch('/transcription.mei');
        const zip = new JSZip();
        zip.file('score.msm', work.scoreMsm);
        zip.file('performance.mpm', work.performanceMpm);
        zip.file('segments.json', JSON.stringify(work.reconstruction, null, 2));
        if (response.ok) zip.file('transcription.mei', await response.text());

        const content = await zip.generateAsync({ type: 'blob' });
        downloadAsFile(content, 'export.zip', 'application/zip');
    }, [work]);

    const zoomContextValue = useMemo(() => ({
        symbolic: { stretchX: stretchX / 200 },
        physical: { stretchX },
        setStretchX
    }), [stretchX]);

    if (error) {
        return <LoadingScreen message={`Could not load the reconstruction — ${error.message}`} />;
    }

    if (!work || !mpm) {
        return <LoadingScreen />;
    }

    return (
        <ZoomContext value={zoomContextValue}>
            <PlaybackProvider
                scoreMsm={work.scoreMsm}
                performanceMpm={work.performanceMpm}
                dateByNoteId={dateByNoteId}
            >
                <ViewerToolbar onDownload={handleDownload} metadata={work.reconstruction} />
                <SelectionProvider>
                    <ScrollSyncProvider zoom={zoomContextValue.symbolic.stretchX}>
                        <PinchZoomHandler />
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100vh',
                        }}>
                            <SegmentStack segments={work.reconstruction.segments} mpm={mpm} />
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
