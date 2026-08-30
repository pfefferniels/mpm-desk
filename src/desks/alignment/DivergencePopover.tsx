import { Box, Button, Popover, Stack, Typography } from "@mui/material";
import type { Divergence } from "../../alignment/divergences";
import { pitchName } from "../../performance/pitch";
import {
    ACTIONS,
    ACTION_LABELS,
    defaultAction,
    labelOf,
    timestamp,
    type Action,
    type Resolution,
} from "../../alignment/readings";

interface DivergencePopoverProps {
    divergence?: Divergence;
    /** The notehead or cross it was opened on */
    anchor?: Element;
    resolution?: Resolution;
    onResolve: (id: string, resolution: Resolution) => void;
    onClose: () => void;
    onNext: () => void;
    remaining: number;
}

/**
 * What one disagreement is, asked at the note it happened on.
 *
 * There is no list any more. A score laid out along performed time already puts
 * every one of these somewhere - a cross where an extra note was played, a grey
 * notehead where a written one was not - so the question belongs there rather
 * than in a table beside it, where reading a row means finding the bar it refers
 * to all over again.
 */
export const DivergencePopover = ({
    divergence,
    anchor,
    resolution,
    onResolve,
    onClose,
    onNext,
    remaining,
}: DivergencePopoverProps) => {
    if (!divergence || !anchor) return null;

    const action = resolution?.action ?? defaultAction(divergence);
    const actions = ACTIONS[divergence.reading] ?? ["record"];

    const choose = (chosen: Action) => {
        onResolve(divergence.id, { reading: divergence.reading, action: chosen });
    };

    return (
        <Popover
            open
            anchorEl={anchor as HTMLElement}
            onClose={onClose}
            anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            transformOrigin={{ vertical: "top", horizontal: "center" }}
            // The score has to stay clickable underneath: moving from one note to
            // the next is the whole gesture here, and a modal backdrop would
            // swallow the click that starts it, making every step take two. The
            // score's own click handler closes this when the click lands on music
            // rather than on a disagreement.
            sx={{ pointerEvents: "none" }}
            slotProps={{
                paper: { sx: { p: 2, maxWidth: "24rem", pointerEvents: "auto" } },
            }}
        >
            <Typography variant="subtitle2">{labelOf(divergence)}</Typography>

            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {divergence.because}
            </Typography>

            <Typography variant="body2" sx={{ mt: 1.5 }}>
                {divergence.kind === "added" ? (
                    <>
                        {timestamp(divergence.onsetMs)} ·{" "}
                        {divergence.pitches.slice(0, 12).map(pitchName).join(" ")}
                        {divergence.pitches.length > 12 ? " …" : ""}
                    </>
                ) : divergence.kind === "replaced" ? (
                    // Both halves, in the order the reader reads them: what stands
                    // in the score, and what came out of the instrument instead
                    <>
                        {timestamp(divergence.onsetMs)} · {pitchName(divergence.pitches[0])}{" "}
                        written, {pitchName(divergence.pitches[1])} played
                    </>
                ) : (
                    <>
                        {divergence.scoreIds.length} written note
                        {divergence.scoreIds.length === 1 ? "" : "s"}
                    </>
                )}
            </Typography>

            <Stack spacing={0.5} sx={{ mt: 1.5 }}>
                {actions.map((option) => (
                    <Button
                        key={option}
                        size="small"
                        variant={option === action ? "contained" : "outlined"}
                        onClick={() => choose(option)}
                        sx={{ justifyContent: "flex-start" }}
                    >
                        {ACTION_LABELS[option]}
                    </Button>
                ))}
            </Stack>

            <Box sx={{ mt: 1.5, display: "flex", justifyContent: "space-between" }}>
                <Button size="small" onClick={onClose}>
                    Close
                </Button>
                <Button size="small" onClick={onNext} disabled={remaining === 0}>
                    Next undecided ({remaining})
                </Button>
            </Box>
        </Popover>
    );
};
