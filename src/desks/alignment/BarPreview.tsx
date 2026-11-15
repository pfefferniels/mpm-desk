import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { VerovioToolkit } from 'verovio/esm';
import { defaultOptions, loadVerovio } from '../../verovio/toolkit';

/**
 * One bar, engraved the ordinary way.
 *
 * The desk's own score is laid out along the time the notes were played in, which is the right
 * picture of a performance and the wrong one of a rhythm: a note written on the beat and one
 * written a sixteenth after it stand where they were struck, a few milliseconds apart, and look
 * the same. What a reader moving a note along the bar needs to see is the bar, spaced by its
 * note values, with the note in it.
 */

interface BarPreviewProps {
    mei: string;
    /** Which bar, counted from zero */
    measure: number;
    /** Colours the notes, exactly as the desk's score is coloured. Must be a stable identity. */
    paint: (root: HTMLElement) => void;
}

/**
 * The toolkit the previews share, and the document it holds.
 *
 * One for all of them, because a preview is opened on one bar and then the next of the same
 * score, and reading the score in again for every bar is most of what a preview would cost.
 */
let shared: { toolkit: Promise<VerovioToolkit>; loaded?: string } | undefined;

const OPTIONS = {
    ...defaultOptions,
    performanceAlignment: false,
    scale: 52,
    breaks: 'none' as const,
    adjustPageWidth: true,
    adjustPageHeight: true,
    pageMarginLeft: 30,
    pageMarginRight: 30,
    pageMarginTop: 30,
    pageMarginBottom: 30,
};

export const BarPreview = ({ mei, measure, paint }: BarPreviewProps) => {
    const container = useRef<HTMLDivElement>(null);
    const [drawn, setDrawn] = useState<{ key: string; svg: string } | null>(null);
    const key = `${String(mei.length)}|${String(measure)}`;

    useEffect(() => {
        let cancelled = false;
        shared ??= { toolkit: loadVerovio() };
        const held = shared;

        held.toolkit
            .then((toolkit) => {
                if (cancelled) return;
                if (held.loaded !== mei) {
                    toolkit.resetOptions();
                    toolkit.setOptions(OPTIONS);
                    if (!toolkit.loadData(mei)) return;
                    held.loaded = mei;
                }
                // Verovio counts bars from one, and lays out only the ones selected
                const bar = String(measure + 1);
                toolkit.select({ measureRange: `${bar}-${bar}` });
                toolkit.redoLayout();
                setDrawn({ key, svg: toolkit.renderToSVG(1) });
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, [mei, measure, key]);

    // The same object from render to render; see `Score`
    const html = useMemo(() => ({ __html: drawn?.svg ?? '' }), [drawn]);

    useLayoutEffect(() => {
        if (container.current && drawn) paint(container.current);
    }, [drawn, paint]);

    return (
        <div
            ref={container}
            className="alignment-score alignment-bar"
            style={{
                minHeight: 150,
                overflowX: 'auto',
                opacity: drawn?.key === key ? 1 : 0.5,
                transition: 'opacity 120ms',
            }}
            dangerouslySetInnerHTML={html}
        />
    );
};
