import { Box, Tooltip, Typography } from '@mui/material';

interface LegendEntry {
    colour: string;
    count: number;
    /** One or two words: what the colour means */
    name: string;
    /** A sentence saying it in full, for whoever hovers */
    meaning: string;
}

/**
 * What the colours in the score mean, and how much of each there is.
 *
 * In the toolbar and not beside the score, because it is the first thing a reader needs and the
 * only thing they need before looking: three dots in the colours the notes are drawn in, each
 * with its word and its count. A reader who has seen it knows what a green note is without
 * having clicked one.
 */
export const Legend = ({ entries }: { entries: readonly LegendEntry[] }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mx: 0.5 }}>
        {entries.map((entry) => (
            <Tooltip key={entry.name} describeChild title={entry.meaning}>
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, whiteSpace: 'nowrap' }}>
                    <Box
                        aria-hidden
                        sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: entry.colour, flexShrink: 0 }}
                    />
                    <Typography
                        variant="caption"
                        sx={{
                            fontVariantNumeric: 'tabular-nums',
                            color: entry.count > 0 ? 'text.primary' : 'text.disabled',
                        }}
                    >
                        {entry.count} {entry.name}
                    </Typography>
                </Box>
            </Tooltip>
        ))}
    </Box>
);
