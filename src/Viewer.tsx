import { useCallback, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { SegmentStack } from './segment-stack/SegmentStack';
import { ZoomContext, ZOOM_MAX, ZOOM_MIN } from './hooks/ZoomProvider';
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
import { SampleLoadingNotice } from './components/SampleLoading';
import { PIANO_VELOCITIES } from './performance/piano';
import { prepareBandMei, readScoreNotes } from './segment-stack/band/bandMei';

/** How wide a bar opens in the score band, in pixels, and how many share a window. */
const READABLE_BAR_MIN = 220;
const READABLE_BAR_MAX = 320;
const BARS_IN_VIEW = 5;

/** Ticks in a bar of the metre the piece ends in, which for a piece in one metre is its metre. */
const barTicksOf = (scoreMsm: string): number => {
    const meter = readMeter(scoreMsm);
    const last = meter.signatures.at(-1);
    const { numerator = 4, denominator = 4 } = last ?? {};
    return (numerator * 4 * meter.ppq) / denominator;
};

const ViewerInner = () => {
    const { work, error } = useReconstruction();
    const [stretchX, setStretchX] = useState<number>(20);
    const [fitted, setFitted] = useState(false);

    const segments = work?.reconstruction.segments;

    const maxDate = useMemo(
        () => segments?.reduce((max, segment) => Math.max(max, segment.to), 0) ?? 0,
        [segments],
    );

    // The opening zoom, set once the segments are in. Adjusted while rendering the load that
    // brings them rather than in an effect afterwards: React re-renders with it before it paints,
    // so the tree is never shown at the placeholder zoom and then jerked to its real width. It
    // happens once — after that the zoom is the reader's.
    //
    // With the score in the middle, the opening view is one the music can be read at: a bar a
    // fifth of the window wide, within what notation needs and no wider. Without a score, the
    // whole piece fits the window, as the tree alone reads best.
    if (!fitted && maxDate > 0 && work) {
        const pxPerTick = work.transcriptionMei
            ? Math.min(READABLE_BAR_MAX, Math.max(READABLE_BAR_MIN, window.innerWidth / BARS_IN_VIEW)) / barTicksOf(work.scoreMsm)
            : window.innerWidth / maxDate;
        setStretchX(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pxPerTick * 200)));
        setFitted(true);
    }

    // Both are parsed once: the MPM for the instructions a popover shows and for
    // "what is in effect now", the MSM for note dates and the tick grid. Neither changes.
    const meter = useMemo(() => work ? readMeter(work.scoreMsm) : null, [work]);
    const mpm = useMemo(
        () => work && meter ? readPerformance(work.performanceMpm, meter) : null,
        [work, meter],
    );
    const dateByNoteId = useMemo(() => work ? readNoteDates(work.scoreMsm) : new Map(), [work]);

    /**
     * The score in the middle of the tree: the transcription without its own performance marks,
     * laid out on the tree's tick axis. Without a transcription, or one that cannot be read, the
     * tree grows from its line as before.
     */
    const band = useMemo(() => {
        if (!work?.transcriptionMei) return undefined;
        try {
            const scoreNotes = readScoreNotes(work.scoreMsm);
            return { mei: prepareBandMei(work.transcriptionMei, scoreNotes).mei, scoreNotes };
        } catch (reason) {
            console.error('The score band could not be prepared', reason);
            return undefined;
        }
    }, [work]);

    /**
     * Download: the same four files the editor saves, so what you see can be opened and edited.
     *
     * `work.json` goes in verbatim rather than as the tree drawn from it. The tree is a projection
     * — it drops the options each call was made with — and the editor opens `work.json`, so a zip
     * carrying only the projection loads there as a score with no work behind it.
     *
     * The MEI is the provenance of the other three, and was fetched on load for the score band;
     * a piece served without one still yields the rest.
     */
    const handleDownload = useCallback(async () => {
        if (!work) return;

        const zip = new JSZip();
        if (work.transcriptionMei !== null) zip.file('transcription.mei', work.transcriptionMei);
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
                <SampleLoadingNotice />
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
                            <SegmentStack segments={work.reconstruction.segments} mpm={mpm} band={band} />
                        </div>
                    </ScrollSyncProvider>
                </SelectionProvider>
            </PlaybackProvider>
        </ZoomContext>
    );
};

export const Viewer = () => (
    <PianoContextProvider velocities={PIANO_VELOCITIES}>
        <ViewerInner />
    </PianoContextProvider>
);
