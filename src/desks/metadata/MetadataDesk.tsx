import { Box } from "@mui/material";
import { useRef, useState } from "react";
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

/** The column, kept clear of the `AspectSelect` card that floats at the top right. */
const page = {
    padding: '5rem 15rem 4rem 3rem',
    maxWidth: '46rem',
} as const;

const titleType = {
    fontFamily: WORD_FONT_FAMILY,
    fontSize: 'clamp(2rem, 5vw, 3.25rem)',
    fontWeight: 400,
    lineHeight: 1.15,
    color: '#111827',
} as const;

const authorType = {
    fontFamily: WORD_FONT_FAMILY,
    fontSize: '1.125rem',
    fontStyle: 'italic',
    fontWeight: 400,
    lineHeight: 1.4,
    color: '#6b7280',
} as const;

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
    transition: 'background-color 120ms ease, box-shadow 120ms ease',
    '&::placeholder': { color: '#9ca3af', fontStyle: 'italic', opacity: 1 },
    '&:hover': { backgroundColor: '#f3f4f6' },
    '&:focus': { backgroundColor: '#ffffff', boxShadow: 'inset 0 -1px 0 #e5e7eb' },
} as const;

const rule = {
    height: '1px',
    backgroundColor: '#e5e7eb',
    margin: '1.25rem 0 1rem',
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

    const commit = () => {
        if (reverting.current) {
            reverting.current = false;
            return;
        }
        if (draft.title === metadata.title && draft.author === metadata.author) return;
        setMetadata(draft);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
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
                    component="input"
                    aria-label="Title"
                    placeholder="Untitled"
                    value={draft.title}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
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

            <Box sx={rule} />

            {isEditorMode ? (
                <Box
                    component="input"
                    aria-label="Author"
                    placeholder="Unattributed"
                    value={draft.author}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        setDraft((current) => ({ ...current, author: event.target.value }));
                    }}
                    onKeyDown={handleKeyDown}
                    onBlur={commit}
                    sx={{ ...authorType, ...field }}
                />
            ) : (
                <Box component="span" sx={{ ...authorType, display: 'block' }}>
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
