/**
 * What the wait for the piano's samples looks like.
 *
 * Two pieces, because there are two ways to ask for sound. A transport has a button, and the ring
 * takes the play icon's place in it so the control itself says how far along the loading is. A
 * gesture auditioned by clicking it has no control to speak through, so a refused play raises the
 * notice instead — see `performance/piano.ts`, which does the refusing.
 */

import { useState } from 'react';
import { Box, CircularProgress, Paper, Snackbar, Typography } from '@mui/material';
import { ErrorOutline } from '@mui/icons-material';
import { useRefusedPlays, useSampleLoading } from '../performance/piano';

/**
 * How far the samples have got, drawn at the size of an icon.
 *
 * Two rings: MUI's determinate variant draws only the arc, so without one behind it there is
 * nothing on screen at all until the first samples land. Indeterminate while the count is still
 * zero, which is the honest reading — the download has been asked for and nothing has come back.
 */
export const SampleProgress = ({ size = 20 }: { size?: number }) => {
    const { percent } = useSampleLoading();

    return (
        <Box sx={{ position: 'relative', display: 'inline-flex', width: size, height: size }}>
            <CircularProgress
                variant='determinate'
                value={100}
                size={size}
                thickness={5}
                sx={{ color: 'grey.200', position: 'absolute' }}
            />
            <CircularProgress
                variant={percent === 0 ? 'indeterminate' : 'determinate'}
                value={percent}
                size={size}
                thickness={5}
                aria-label={`Loading piano samples, ${String(percent)}%`}
            />
        </Box>
    );
};

/**
 * The notice a play gets when the samples are not there.
 *
 * Open while the refusal is newer than the last dismissal and the piano is still not ready, so it
 * closes itself the moment the samples arrive without an effect to time it. Mounted once per tree,
 * inside the `PianoContextProvider` whose piano it reports on.
 */
export const SampleLoadingNotice = () => {
    const loading = useSampleLoading();
    const refusals = useRefusedPlays();
    const [dismissed, setDismissed] = useState(0);

    const open = refusals > dismissed && (loading.loading || loading.failed);

    return (
        <Snackbar
            open={open}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            onClose={() => setDismissed(refusals)}
            autoHideDuration={loading.failed ? 6000 : null}
        >
            <Paper
                elevation={6}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 2,
                    py: 1.25,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                }}
            >
                {loading.failed ? (
                    <ErrorOutline color='error' fontSize='small' />
                ) : (
                    <SampleProgress />
                )}
                <Typography variant='body2'>
                    {loading.failed
                        ? 'The piano samples could not be loaded, so there is nothing to hear'
                        : `The piano is still loading its samples — ${String(loading.loaded)} of ${String(loading.total)}`}
                </Typography>
            </Paper>
        </Snackbar>
    );
};
