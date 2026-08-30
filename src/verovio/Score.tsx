import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { VerovioToolkit } from 'verovio/esm';
import { loadVerovio, renderScore, type ScoreOptions } from './toolkit';

interface ScoreProps {
    mei: string;
    options?: Partial<ScoreOptions>;
    /**
     * Everything drawn on top of verovio's markup — colours, selection, whatever a desk adds.
     *
     * Called after every render and again whenever React replaces the SVG. It must be a stable
     * identity, because it is what this re-runs on: when the thing it closes over changes, the
     * markup is repainted and **verovio is not touched**.
     */
    paint?: (root: HTMLElement) => void;
    onNoteClick?: (id: string, event: React.MouseEvent) => void;
    style?: React.CSSProperties;
}

/**
 * A score, engraved by verovio and handed to a desk to draw on.
 *
 * The render is the expensive part — about a third of a second for the whole transcription — and
 * it is keyed on the MEI and the *content* of the options, not their identity, because the options
 * arrive as an object literal from the call site. So selecting notes, recolouring a part, renaming
 * one, or dispatching a move all repaint without re-engraving.
 */
export const Score = ({ mei, options, paint, onNoteClick, style }: ScoreProps) => {
    const container = useRef<HTMLDivElement>(null);
    const toolkit = useRef<Promise<VerovioToolkit> | null>(null);

    // The options are an object literal at the call site, so a render keyed on their identity
    // would re-engrave on every render of the desk. Content, not identity.
    const optionsKey = JSON.stringify(options ?? {});
    const key = `${String(mei.length)}|${optionsKey}`;

    /**
     * The last finished engraving, and what it was of.
     *
     * One piece of state rather than `pages` plus a `rendering` flag, so that "a newer render is
     * running" is *derived* — `done.key !== key` — instead of being set from inside the effect.
     * A flag would have to be raised synchronously in the effect body, which is a cascading
     * render, and the two could then disagree about which score is on screen.
     */
    const [done, setDone] = useState<{ key: string; pages: string[] } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const rendering = done?.key !== key;

    useEffect(() => {
        let cancelled = false;

        toolkit.current ??= loadVerovio();
        toolkit.current
            .then((tk) => {
                if (cancelled) return;
                setDone({
                    key,
                    pages: renderScore(tk, mei, JSON.parse(optionsKey) as Partial<ScoreOptions>),
                });
                setError(null);
            })
            .catch((reason: unknown) => {
                if (cancelled) return;
                setError(reason instanceof Error ? reason.message : String(reason));
            });

        return () => {
            cancelled = true;
        };
    }, [mei, optionsKey, key]);

    useLayoutEffect(() => {
        const root = container.current;
        if (!root || !paint) return;

        paint(root);

        // React re-inserts the rendered SVG whole when the document changes, which detaches
        // anything painted into it. Our pass only writes attributes and classes — it adds and
        // removes no nodes — so the observer cannot hear itself.
        const observer = new MutationObserver(() => {
            paint(root);
        });
        observer.observe(root, { childList: true, subtree: true });
        return () => {
            observer.disconnect();
        };
        // `done` rather than the pages read out of it: `done?.pages ?? []` is a fresh array on
        // every render, so depending on it would repaint on renders that engraved nothing.
    }, [done, paint]);

    if (error) {
        return <div style={{ padding: '1rem', color: '#b91c1c' }}>{error}</div>;
    }

    return (
        <div
            ref={container}
            style={{ opacity: rendering ? 0.5 : 1, transition: 'opacity 120ms', ...style }}
            onClick={(event) => {
                if (!onNoteClick) return;
                const note = (event.target as Element).closest('g.note');
                const id = note?.getAttribute('data-id');
                if (id) onNoteClick(id, event);
            }}
        >
            {(done?.pages ?? []).map((page, index) => (
                <div key={index} dangerouslySetInnerHTML={{ __html: page }} />
            ))}
        </div>
    );
};
