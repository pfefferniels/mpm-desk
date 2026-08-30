import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { VerovioToolkit } from 'verovio/esm';
import { loadVerovio, renderScore, type ScoreOptions } from './toolkit';
import { clearExtenders, drawExtenders } from './extenders';
import { clearExtraNotes, drawExtraNotes, type ExtraNote } from './extraNotes';
import { clearOmissionMarks, drawOmissionMarks, type OmittedGroup } from './omissionMarks';

/** The classes drawn onto the score here, which the observer below must not react to. */
const DRAWN = ['performanceExtender', 'performanceExtraNote', 'performanceOmission'];

const isOurs = (node: Node) =>
    node.nodeType === 1 && DRAWN.some((name) => (node as Element).classList.contains(name));

/** Whether a mutation is this component's own drawing rather than a new render. */
const isDrawing = (record: MutationRecord) =>
    [...record.addedNodes].every(isOurs) && [...record.removedNodes].every(isOurs);

interface ScoreProps {
    mei: string;
    options?: Partial<ScoreOptions>;
    /**
     * Everything drawn on top of verovio's markup — colours, selection, whatever a desk adds.
     *
     * Called after every render and again whenever React replaces the SVG. It must be a stable
     * identity, because it is what this re-runs on: when the thing it closes over changes, the
     * markup is repainted and **verovio is not touched**.
     *
     * It runs *after* the three overlays below, so a desk that colours by class reaches the marks
     * they drew as well as the notes verovio engraved.
     */
    paint?: (root: HTMLElement) => void;
    /** Draw a line from each notehead to the point the note was released at. */
    extenders?: boolean;
    /** Played notes with no note in the score, drawn as crosses where they were played. */
    extraNotes?: readonly ExtraNote[];
    /** Written notes the recording passes over, bracketed where they are too crowded to show. */
    omissions?: readonly OmittedGroup[];
    /** The key the extra notes are spelled in. */
    tonic?: string;
    onNoteClick?: (id: string, event: React.MouseEvent) => void;
    className?: string;
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
export const Score = ({
    mei,
    options,
    paint,
    extenders,
    extraNotes,
    omissions,
    tonic,
    onNoteClick,
    className,
    style,
}: ScoreProps) => {
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
        if (!root) return;

        const drawn = JSON.parse(optionsKey) as Partial<ScoreOptions>;

        const draw = () => {
            if (extenders) drawExtenders(root, drawn);
            else clearExtenders(root);

            // Before the crosses, which measure against the notes verovio placed: a bracketed
            // group is taken out of sight but not out of the layout, so it still has a position
            // to measure from.
            if (omissions?.length) drawOmissionMarks(root, omissions, drawn);
            else clearOmissionMarks(root);

            if (extraNotes?.length) drawExtraNotes(root, extraNotes, { ...drawn, tonic });
            else clearExtraNotes(root);

            paint?.(root);
        };

        draw();

        // React re-inserts the rendered SVG whole when the document changes, which detaches
        // anything drawn into it. The painting pass only writes attributes and classes, but the
        // three overlays add and remove nodes — so the observer has to be able to tell its own
        // work from a new render, or it triggers itself for ever.
        const observer = new MutationObserver((records) => {
            if (records.every(isDrawing)) return;
            draw();
        });
        observer.observe(root, { childList: true, subtree: true });
        return () => {
            observer.disconnect();
        };
        // `done` rather than the pages read out of it: `done?.pages ?? []` is a fresh array on
        // every render, so depending on it would repaint on renders that engraved nothing.
    }, [done, paint, extenders, extraNotes, omissions, tonic, optionsKey]);

    if (error) {
        return <div style={{ padding: '1rem', color: '#b91c1c' }}>{error}</div>;
    }

    return (
        <div
            ref={container}
            className={className}
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
