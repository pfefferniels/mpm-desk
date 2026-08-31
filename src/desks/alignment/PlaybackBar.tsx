/**
 * The controls for listening to a performance: play, stop, and which part of it.
 *
 * The range is two thumbs on one slider rather than a pair of fields, because
 * what is being chosen is a stretch of music and the useful gesture is to grab
 * one end of it and move it. Everything else here is the piano saying whether it
 * is ready: its samples are fetched a file per note from another host, so the
 * first press of play can be several seconds away and silence would look like a
 * fault.
 */

import { IconButton, Slider, Stack, Typography } from "@mui/material";
import { PlayArrow, Stop, SettingsBackupRestore } from "@mui/icons-material";
import { SampleProgress } from "../../components/SampleLoading";
import { sampleLoadingHint, useSampleLoading } from "../../performance/piano";
import { clock, type Playback } from "./useRecordingPlayback";

interface PlaybackBarProps {
    playback: Playback;
    /** How wide the range slider is drawn */
    width?: string;
}

export const PlaybackBar = ({ playback, width = "14rem" }: PlaybackBarProps) => {
    const { durationMs, range, setRange, whole, playing, play, stop, status } = playback;
    const samples = useSampleLoading();

    if (durationMs === 0) return null;

    return (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <IconButton
                color="primary"
                onClick={playing ? stop : play}
                disabled={status !== "done"}
                title={
                    samples.loading || samples.failed
                        ? sampleLoadingHint(samples)
                        : playing
                          ? "Stop"
                          : `Play ${clock(range[0])} to ${clock(range[1])}`
                }
            >
                {samples.loading ? <SampleProgress size={24} /> : playing ? <Stop /> : <PlayArrow />}
            </IconButton>

            <Stack sx={{ width }}>
                <Slider
                    size="small"
                    min={0}
                    max={durationMs}
                    step={100}
                    value={range}
                    onChange={(_, value) => setRange(value as [number, number])}
                    valueLabelDisplay="auto"
                    valueLabelFormat={clock}
                    disableSwap
                    disabled={status !== "done"}
                />
                <Typography variant="caption" color="text.secondary" sx={{ mt: -0.5 }}>
                    {whole
                        ? `whole performance · ${clock(durationMs)}`
                        : `${clock(range[0])} – ${clock(range[1])}`}
                </Typography>
            </Stack>

            {!whole && (
                <IconButton
                    size="small"
                    onClick={() => setRange([0, durationMs])}
                    title="Play the whole performance again"
                >
                    <SettingsBackupRestore fontSize="small" />
                </IconButton>
            )}

            {samples.loading && (
                <Typography variant="caption" color="text.secondary">
                    Loading piano samples · {samples.loaded} of {samples.total}
                </Typography>
            )}

            {samples.failed && (
                <Typography variant="body2" color="error">
                    The piano samples could not be loaded
                </Typography>
            )}
        </Stack>
    );
};
