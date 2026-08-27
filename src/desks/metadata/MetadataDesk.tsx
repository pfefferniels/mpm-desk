import { Box } from "@mui/material";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMode } from "../../hooks/ModeProvider";
import { useWorkDocument } from "../../hooks/WorkDocument";
import { describesPerformance } from "../../model/workReducer";
import { WORD_FONT_FAMILY } from "../../segment-stack/words";

interface Metadata {
    author: string
    title: string
}

interface MetadataDeskProps {
    metadata: Metadata
    setMetadata: React.Dispatch<React.SetStateAction<Metadata>>
    isEditorMode: boolean
    segmentCount: number
    callCount: number
}

const UI_FONT_FAMILY = 'Inter, system-ui, sans-serif';

/**
 * The column, kept clear of the `AspectSelect` card that floats at the top right.
 *
 * `boxSizing: 'content-box'`, against the app-wide `border-box` that `CssBaseline` now sets,
 * because the 46rem here is the *measure of the text* and not the width of the block. Under
 * border-box the 18rem of side padding comes out of it, leaving 28rem — a column 39% narrower
 * than the one this type was set for, on the desk the editor opens with.
 */
const page = {
    boxSizing: 'content-box',
    padding: '5rem 15rem 4rem 3rem',
    maxWidth: '46rem',
} as const;

const titleType = {
    fontFamily: WORD_FONT_FAMILY,
    fontSize: 'clamp(1.5rem, 3vw, 2rem)',
    fontWeight: 400,
    lineHeight: 1.15,
    color: '#111827',
} as const;

const authorType = {
    fontFamily: WORD_FONT_FAMILY,
    fontSize: '1.125rem',
    fontWeight: 400,
    lineHeight: 1.4,
    color: '#6b7280',
} as const;

/** The gap the title and author keep between them, now that no rule stands in it. */
const authorGap = { marginTop: '0.75rem' } as const;

/**
 * Holds a `textarea` at exactly the height its text needs.
 *
 * A title here is a sentence — the chain carries it as a `<comment>` — so a one-line field would
 * keep everything past its right edge out of sight. Wrapping fixes that only if the box grows
 * with the wrapping: `auto` first, so a shortened text is not measured against its old height,
 * then whatever the content now scrolls to. Width decides where the lines break, so a resized
 * window has to measure again.
 */
const useAutoHeight = (text: string) => {
    const ref = useRef<HTMLTextAreaElement>(null);

    useLayoutEffect(() => {
        const fit = () => {
            const element = ref.current;
            if (!element) return;
            element.style.height = 'auto';
            element.style.height = `${element.scrollHeight}px`;
        };
        fit();
        window.addEventListener('resize', fit);
        return () => window.removeEventListener('resize', fit);
    }, [text]);

    return ref;
};

/**
 * A field that reads as set type until you go near it.
 *
 * The block is drawn wider than the glyphs — padding out, margin back in — so hovering the line
 * shows something to click without the text having moved to make room for it. In view mode the
 * same string is a `<span>` with neither, which lands it in exactly the same place.
 */
const field = {
    display: 'block',
    width: 'calc(100% + 12px)',
    marginLeft: '-6px',
    marginBlock: '-2px',
    padding: '2px 6px',
    border: 'none',
    outline: 'none',
    borderRadius: '4px',
    backgroundColor: 'transparent',
    // The height is the hook's to set, and a scrollbar would only appear between its two writes.
    resize: 'none',
    overflow: 'hidden',
    transition: 'background-color 120ms ease, box-shadow 120ms ease',
    '&::placeholder': { color: '#9ca3af', fontStyle: 'italic', opacity: 1 },
    '&:hover': { backgroundColor: '#f3f4f6' },
    '&:focus': { backgroundColor: '#ffffff', boxShadow: 'inset 0 -1px 0 #e5e7eb' },
} as const;

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export const MetadataDesk = ({
    metadata,
    setMetadata,
    isEditorMode,
    segmentCount,
    callCount,
}: MetadataDeskProps) => {
    // Typing stays local and reaches the document on blur: a commit rebuilds the chain's
    // `InsertMetadata` call, and refitting between keystrokes would be three seconds each.
    const [draft, setDraft] = useState(metadata);

    // What the document last said, so an edit landing from outside — opening a second project
    // while this desk is up, which keeps it mounted — replaces the draft instead of being
    // overwritten by it on the next blur. Compared by value: committing our own edit changes
    // the prop too, and that must not count as a document we have not seen.
    const [seen, setSeen] = useState(metadata);
    if (metadata.title !== seen.title || metadata.author !== seen.author) {
        setSeen(metadata);
        setDraft(metadata);
    }

    // Escape reverts and blurs in one gesture, and `blur()` is synchronous — the handler below
    // would still be holding the edited draft. The flag is how it knows not to commit it.
    const reverting = useRef(false);

    const titleRef = useAutoHeight(draft.title);
    const authorRef = useAutoHeight(draft.author);

    const commit = () => {
        if (reverting.current) {
            reverting.current = false;
            return;
        }
        if (draft.title === metadata.title && draft.author === metadata.author) return;
        setMetadata(draft);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter') {
            // A title wraps, but it is still one line of text: Enter ends the edit, not the line.
            event.preventDefault();
            event.currentTarget.blur();
        } else if (event.key === 'Escape') {
            reverting.current = true;
            setDraft(metadata);
            event.currentTarget.blur();
        }
    };

    return (
        <Box sx={page}>
            {isEditorMode ? (
                <Box
                    component="textarea"
                    ref={titleRef}
                    rows={1}
                    aria-label="Title"
                    placeholder="Untitled"
                    value={draft.title}
                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                        setDraft((current) => ({ ...current, title: event.target.value }));
                    }}
                    onKeyDown={handleKeyDown}
                    onBlur={commit}
                    sx={{ ...titleType, ...field }}
                />
            ) : (
                <Box component="span" sx={{ ...titleType, display: 'block' }}>
                    {metadata.title || 'Untitled'}
                </Box>
            )}

            {isEditorMode ? (
                <Box
                    component="textarea"
                    ref={authorRef}
                    rows={1}
                    aria-label="Author"
                    placeholder="Unattributed"
                    value={draft.author}
                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                        setDraft((current) => ({ ...current, author: event.target.value }));
                    }}
                    onKeyDown={handleKeyDown}
                    onBlur={commit}
                    sx={{ ...authorType, ...field, ...authorGap }}
                />
            ) : (
                <Box component="span" sx={{ ...authorType, ...authorGap, display: 'block' }}>
                    {metadata.author || 'Unattributed'}
                </Box>
            )}

            <Box
                sx={{
                    marginTop: '2.5rem',
                    fontFamily: UI_FONT_FAMILY,
                    fontSize: 12,
                    color: '#9ca3af',
                }}
            >
                {count(segmentCount, 'segment')} · {count(callCount, 'call')}
            </Box>
        </Box>
    )
}

/**
 * The metadata desk as the registry dispatches it.
 *
 * Split from the component above rather than folded into it, and the split is the point: the
 * page is a function of five values and is worth testing as one — eight cases drive it directly,
 * including a rerender that proves an externally replaced document does not lose an unsaved
 * draft. Reading the document inside it would put a provider harness between every one of those
 * assertions and the thing asserted.
 *
 * So the connection lives here instead, and it is the whole of it: the desk needs the document,
 * not the fit, which is why it is the one entry in the registry that ignores the bag every other
 * desk is handed.
 */
export const MetadataDeskEntry = () => {
    const { metadata, setMetadata, segments, calls } = useWorkDocument();
    const { isEditorMode } = useMode();

    // `InsertMetadata` writes `<metadata>` rather than an instruction, so counting it would make
    // an otherwise empty document report a call it does not have.
    const callCount = useMemo(() => calls.filter(describesPerformance).length, [calls]);

    return (
        <MetadataDesk
            metadata={metadata}
            setMetadata={setMetadata}
            isEditorMode={isEditorMode}
            segmentCount={segments.length}
            callCount={callCount}
        />
    );
};
