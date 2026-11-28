import { Box, Tooltip, Typography } from '@mui/material';
import { amountOf, matchOf, METERS, shareLeft, type Left } from './match';

interface MatchProps {
    /** What is left as the document stands; null until its first run is in. */
    now: Left | null;
    /** What there was with nothing described. */
    was: Left | null;
    /** A run is under way, and the figures are of the one before it. */
    stale: boolean;
}

const Track = ({ share, width, stale }: { share: number; width: number | string; stale: boolean }) => (
    <Box sx={{ width, height: 4, borderRadius: 1, bgcolor: 'divider', overflow: 'hidden', flexShrink: 0 }}>
        <Box
            sx={{
                height: '100%',
                width: `${String(Math.min(100, Math.max(2, share * 100)))}%`,
                bgcolor: 'text.primary',
                opacity: stale ? 0.45 : 1,
                transition: 'width 500ms ease',
                '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            }}
        />
    </Box>
);

/**
 * One figure for how well the MPM matches the playing, which opens under the pointer into the
 * four it is made of.
 *
 * In the toolbar, and of one width whatever it reads, so that nothing beside it moves while the
 * figure changes.
 */
export const Match = ({ now, was, stale }: MatchProps) => {
    const match = now && was ? matchOf(now, was) : null;
    const figure = match === null ? '–' : `${String(Math.round(match * 100))} %`;
    return (
        <Tooltip
            describeChild
            placement="bottom-end"
            slotProps={{ tooltip: { sx: { bgcolor: 'background.paper', color: 'text.primary', border: 1, borderColor: 'divider', boxShadow: 3, maxWidth: 360, p: 1.5 } } }}
            title={
                <Box data-match-parts>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                        A note is what the MPM so far renders, its shadow the same note as it was played. Each number is the distance
                        between the two over all the notes; at nought the MPM plays what was played. The match is the share of what there
                        was with nothing described that is gone, each of the four counting a quarter.
                    </Typography>
                    {METERS.map(({ key, name, says }) => (
                        <Box key={key} data-meter={key} sx={{ mb: 0.75 }}>
                            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                                <Typography variant="overline" sx={{ color: 'text.primary', flex: '0 0 5.5rem' }}>
                                    {name}
                                </Typography>
                                <Track share={now && was ? shareLeft(key, now, was) : 1} width="100%" stale={stale} />
                                <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', flex: '0 0 4.5rem', textAlign: 'right' }}>
                                    {now ? amountOf(key, now[key]) : '–'}
                                </Typography>
                            </Box>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                {says}
                                {now && was && ` ${amountOf(key, was[key])} with nothing described.`}
                            </Typography>
                        </Box>
                    ))}
                </Box>
            }
        >
            <Box
                data-match
                role="img"
                aria-label={`Match with the playing: ${match === null ? 'not measured yet' : figure}`}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'default' }}
            >
                <Track share={match ?? 0} width={72} stale={stale} />
                <Typography
                    variant="caption"
                    aria-hidden
                    sx={{ minWidth: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'text.primary' }}
                >
                    {figure}
                </Typography>
            </Box>
        </Tooltip>
    );
};
