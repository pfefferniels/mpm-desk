import { Box, Typography } from '@mui/material';
import { WORDS_FAMILY } from './roll/tones';

interface PenProps {
    value: string;
    onChange: (value: string) => void;
    /** What it asks for while nothing is written: what the remark will be about. */
    placeholder: string;
    /** What Enter and Esc will do, said under the line. */
    hint: string;
    /** Enter. */
    onSend: () => void;
    /** Esc. */
    onDrop: () => void;
    /**
     * Whether it stands on its place and grows upwards, as over a mark on the roll, or hangs from
     * it, as on the line over the roll. The line that is written on is the one nearest the place.
     */
    grows: 'up' | 'down';
}

const type = { fontFamily: WORDS_FAMILY, fontSize: 17, lineHeight: 1.3 } as const;

/**
 * Where a remark is written: one line on the roll, in the roll's own serif, as wide as what is
 * written on it.
 *
 * Enter sends it, Esc drops it, Shift-Enter breaks the line. It takes the focus when it appears,
 * since it appears because the reader has just said what they are about to write about.
 *
 * It sizes itself to its text without measuring anything: the text is set a second time, unseen,
 * in the same cell of a grid, and the field fills the cell that sets out.
 */
export const Pen = ({ value, onChange, placeholder, hint, onSend, onDrop, grows }: PenProps) => (
    <Box data-pen sx={{ display: 'flex', flexDirection: grows === 'up' ? 'column-reverse' : 'column', alignItems: 'flex-start', gap: 0.5 }}>
        <Box
            data-sized={value || placeholder}
            sx={{
                display: 'inline-grid',
                minWidth: 150,
                maxWidth: 320,
                bgcolor: 'rgba(255, 255, 255, 0.92)',
                borderBottom: '1.5px solid',
                borderColor: 'primary.light',
                '&::after': {
                    content: 'attr(data-sized) " "',
                    visibility: 'hidden',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                },
                '& > textarea, &::after': { ...type, gridArea: '1 / 1 / 2 / 2', padding: '1px 3px 2px', margin: 0, border: 0 },
                '& > textarea': {
                    resize: 'none',
                    overflow: 'hidden',
                    outline: 'none',
                    background: 'none',
                    color: 'text.primary',
                    minWidth: 0,
                    '&::placeholder': { color: 'text.disabled', fontStyle: 'italic' },
                },
            }}
        >
            <textarea
                // The reader has just pointed at what this is about, and is about to say it.
                autoFocus
                rows={1}
                aria-label="Your remark"
                autoComplete="off"
                spellCheck={false}
                placeholder={placeholder}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        onSend();
                    } else if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        onDrop();
                    }
                }}
            />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ bgcolor: 'rgba(255, 255, 255, 0.92)', borderRadius: 0.5, px: 0.5, whiteSpace: 'nowrap' }}>
            {hint}
        </Typography>
    </Box>
);
