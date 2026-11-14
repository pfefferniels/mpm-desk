import { Box, Button, Popover, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import type { Divergence } from "../../alignment/divergences";
import { choiceHeading, choiceLabel, labelOf, timestamp } from "../../alignment/readings";
import type { Notation, Outcome } from "../../alignment/transcription";
import { pitchName } from "../../performance/pitch";

interface DivergencePopoverProps {
    divergence?: Divergence;
    /** What the transcriber made of it, which is what the score shows */
    outcome?: Outcome;
    /** The notehead or cross it was opened on */
    anchor?: Element;
    /** Whether the reader has overruled the transcriber here */
    decided: boolean;
    onChoose: (divergence: Divergence, notation: Notation) => void;
    /** Hand it back to the transcriber */
    onReset: (divergence: Divergence) => void;
    onClose: () => void;
    onStep: (direction: -1 | 1) => void;
    /** Where this one stands among all of them, from one, and how many there are */
    position: number;
    total: number;
    /** The colour this kind of difference is drawn in, which the card repeats */
    colour: string;
}

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** What the score shows now, as the choice that would ask for it. */
const writtenAs = (outcome: Outcome | undefined): Notation => {
    switch (outcome?.written) {
        case "measured":
        case "mixed":
            return "measured";
        case "grace":
            return "grace";
        case "sign":
            return "sign";
        case "omitted":
        case "variant":
            return "auto";
        case "as-written":
            return "as-written";
        default:
            return "none";
    }
};

/**
 * The ways of writing a divergence that are worth a button.
 *
 * Not `auto` beside the notations it would choose between: for an added note that is one of
 * `Notes` and `Grace notes`, and offering it as a third thing would be offering a choice whose
 * answer is one of the other two.
 */
const choicesFor = (divergence: Divergence, outcome: Outcome | undefined): Notation[] => {
    const offers = outcome?.offers ?? [];
    if (divergence.kind === "added") {
        return offers.filter((offer) => offer !== "auto" && offer !== "as-written");
    }
    if (divergence.kind === "replaced" && divergence.reading === "unmatched-pair") return [];
    return offers.filter((offer) => offer === "auto" || offer === "none");
};

/**
 * One thing the performer did differently, and how it is written.
 *
 * Opened on the note itself. The score has already been written, so this does not ask what to
 * do: it says what was played, how the transcriber wrote it and on what grounds, and offers the
 * other ways of writing it. One click writes it another way and the score redraws.
 */
export const DivergencePopover = ({
    divergence,
    outcome,
    anchor,
    decided,
    onChoose,
    onReset,
    onClose,
    onStep,
    position,
    total,
    colour,
}: DivergencePopoverProps) => {
    if (!divergence || !anchor) return null;

    const current = writtenAs(outcome);
    const choices = choicesFor(divergence, outcome);

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
                paper: { sx: { p: 2, width: "22rem", pointerEvents: "auto" } },
            }}
        >
            {/* What happened, in the word and the colour the legend uses for it */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                <Box
                    aria-hidden
                    sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: colour, flexShrink: 0 }}
                />
                <Typography variant="subtitle2">
                    {divergence.kind === "added"
                        ? divergence.perfIds.length === 1
                            ? "Added note"
                            : `${String(divergence.perfIds.length)} added notes`
                        : divergence.kind === "missing"
                          ? divergence.scoreIds.length === 1
                              ? "Note left out"
                              : `${String(divergence.scoreIds.length)} notes left out`
                          : "Note changed"}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                    {divergence.kind === "missing" ? "" : timestamp(divergence.onsetMs)}
                </Typography>
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                {divergence.kind === "added" ? (
                    <>
                        {divergence.pitches.slice(0, 12).map(pitchName).join(" ")}
                        {divergence.pitches.length > 12 ? " …" : ""} · {lowerFirst(labelOf(divergence))}
                    </>
                ) : divergence.kind === "replaced" ? (
                    <>
                        {pitchName(divergence.pitches[0])} written, {pitchName(divergence.pitches[1])}{" "}
                        played
                    </>
                ) : (
                    lowerFirst(labelOf(divergence))
                )}
            </Typography>

            <Typography variant="body2" sx={{ mt: 1.25 }}>
                {outcome?.because ?? divergence.because}
            </Typography>

            {choices.length > 1 && (
                <Typography variant="overline" component="div" sx={{ mt: 1.25, lineHeight: 1.6 }}>
                    {choiceHeading(divergence)}
                </Typography>
            )}
            {choices.length > 1 && (
                <ToggleButtonGroup
                    exclusive
                    fullWidth
                    size="small"
                    color="primary"
                    aria-label={choiceHeading(divergence)}
                    value={current}
                    onChange={(_, chosen: Notation | null) => {
                        if (chosen !== null) onChoose(divergence, chosen);
                    }}
                    sx={{ mt: 0.25 }}
                >
                    {choices.map((choice) => (
                        <ToggleButton
                            key={choice}
                            value={choice}
                            sx={{ textTransform: "none", py: 0.5, lineHeight: 1.3 }}
                        >
                            {choiceLabel(divergence, choice)}
                        </ToggleButton>
                    ))}
                </ToggleButtonGroup>
            )}

            <Box sx={{ mt: 1.5, display: "flex", alignItems: "center", gap: 0.5 }}>
                <Button
                    size="small"
                    aria-label="Previous"
                    onClick={() => {
                        onStep(-1);
                    }}
                    disabled={total < 2}
                    sx={{ minWidth: 0 }}
                >
                    ‹
                </Button>
                <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {position} of {total}
                </Typography>
                <Button
                    size="small"
                    aria-label="Next"
                    onClick={() => {
                        onStep(1);
                    }}
                    disabled={total < 2}
                    sx={{ minWidth: 0 }}
                >
                    ›
                </Button>
                <Box sx={{ flexGrow: 1 }} />
                {decided && (
                    <Button
                        size="small"
                        onClick={() => {
                            onReset(divergence);
                        }}
                    >
                        Undo my choice
                    </Button>
                )}
            </Box>
        </Popover>
    );
};
