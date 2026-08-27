import { useCallback, useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { SegmentStack } from './segment-stack/SegmentStack';
import { ZoomContext } from './hooks/ZoomProvider';
import { SelectionProvider } from './hooks/SelectionProvider';
import { ScrollSyncProvider } from './hooks/ScrollSyncProvider';
import { PlaybackProvider } from './hooks/PlaybackProvider';
import { PianoContextProvider } from 'react-pianosound';
import { ViewerToolbar } from './components/ViewerToolbar';
import { downloadAsFile } from './utils/utils';
import { readMeter, readNoteDates } from './utils/score';
import { readPerformance } from './utils/mpm';
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
    // "what is in effect now", the MSM for note dates and the tick grid. Neither changes.
    const meter = useMemo(() => work ? readMeter(work.scoreMsm) : null, [work]);
    const mpm = useMemo(
        () => work && meter ? readPerformance(work.performanceMpm, meter) : null,
        [work, meter],
    );
    const dateByNoteId = useMemo(() => work ? readNoteDates(work.scoreMsm) : new Map(), [work]);

    /**
     * Download: the same four files the editor saves, so what you see can be opened and edited.
     *
     * `work.json` goes in verbatim rather than as the tree drawn from it. The tree is a projection
     * — it drops the options each call was made with — and the editor opens `work.json`, so a zip
     * carrying only the projection loads there as a score with no work behind it.
     *
     * The MEI is the provenance of the other three, and nothing on screen needs it, so it is
     * fetched here rather than on load; a piece served without one still yields the rest.
     */
    const handleDownload = useCallback(async () => {
        if (!work) return;

        const response = await fetch('/transcription.mei');
        const zip = new JSZip();
        if (response.ok) zip.file('transcription.mei', await response.text());
        zip.file('work.json', work.workJson);
        zip.file('performance.mpm', work.performanceMpm);
        zip.file('score.msm', work.scoreMsm);

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
                    <ScrollSyncProvider symbolicZoom={zoomContextValue.symbolic.stretchX}>
                        <PinchZoomHandler />
                        {/* The tree is the page: it takes the whole window, and the
                            toolbar and the title lie over it (both are fixed, so they
                            cost the tree no room).

                            The window height is stated here rather than left to grow,
                            because the stack sizes itself against its container: with
                            nothing to measure it opens as tall as the tree, the card
                            never overflows, and the reading starts at the top edge
                            instead of on the stem. `dvh` so a phone's retracting
                            toolbar does not cut the bottom off. */}
                        <div style={{ height: '100dvh' }}>
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
