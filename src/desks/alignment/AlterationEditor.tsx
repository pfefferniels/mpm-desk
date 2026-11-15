import {
    Box,
    IconButton,
    Popover,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    type PopoverActions,
} from "@mui/material";
import {
    Add,
    ChevronLeft,
    ChevronRight,
    InfoOutlined,
    Remove,
    RestartAlt,
    SwapVert,
} from "@mui/icons-material";
import { useCallback, useRef, type ReactElement } from "react";
import type { Divergence } from "../../alignment/divergences";
import { choiceHeading, choiceLabel, labelOf, timestamp } from "../../alignment/readings";
import { pitchName } from "../../performance/pitch";
import type { Notation, NoteEdit, Outcome, WrittenNoteInfo } from "../../alignment/transcription";
import { BarPreview } from "./BarPreview";

interface AlterationEditorProps {
    divergence?: Divergence;
    /** What the transcriber made of it, which is what the score shows */
    outcome?: Outcome;
    /** The notehead or cross it was opened on */
    anchor?: Element;
    /** The score on the page, for the bar to be drawn from */
    mei?: string;
    /** Colours a drawing of the score the way the page is coloured */
    paint: (root: HTMLElement) => void;
    /** The written-in note the reader clicked, where they clicked one */
    noteId?: string;
    /** Whether the reader has changed anything here */
    changed: boolean;
    onChoose: (divergence: Divergence, notation: Notation) => void;
    onEdit: (noteId: string, edit: NoteEdit) => void;
    /** Hand it back to the transcriber */
    onReset: (divergence: Divergence) => void;
    onClose: () => void;
}

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
 * What happened and how it was read, for whoever asks.
 *
 * Behind a small mark rather than in the card: it is what the transcriber would say if it were
 * asked to account for itself, and most of the time nobody is asking.
 */
const accountOf = (divergence: Divergence, outcome: Outcome | undefined): string => {
    const what =
        divergence.kind === "added"
            ? `${timestamp(divergence.onsetMs)} · ${divergence.pitches.slice(0, 8).map(pitchName).join(" ")}${
                  divergence.pitches.length > 8 ? " …" : ""
              }`
            : divergence.kind === "replaced"
              ? `${timestamp(divergence.onsetMs)} · ${pitchName(divergence.pitches[0])} written, ${pitchName(
                    divergence.pitches[1],
                )} played`
              : `${String(divergence.scoreIds.length)} written`;
    return `${labelOf(divergence)}. ${what}. ${outcome?.because ?? divergence.because}`;
};

/** One small button, which says what it does only when asked. */
const Tool = ({
    name,
    disabled,
    onClick,
    children,
}: {
    name: string;
    disabled?: boolean;
    onClick: () => void;
    children: ReactElement;
}) => (
    <Tooltip title={name}>
        <span>
            <IconButton size="small" aria-label={name} disabled={disabled} onClick={onClick}>
                {children}
            </IconButton>
        </span>
    </Tooltip>
);

/**
 * One thing the performer did differently, and the hands to change how it is written.
 *
 * No words. The bar is drawn the ordinary way with the note in it, and under it are the things
 * that can be done to the note: write it as something else, move it along the bar, make it
 * longer or shorter, put it on the other staff. Every one of them redraws the bar, which is the
 * explanation.
 *
 * The arrow keys move the note too, and plus and minus change its length.
 */
export const AlterationEditor = ({
    divergence,
    outcome,
    anchor,
    mei,
    paint,
    noteId,
    changed,
    onChoose,
    onEdit,
    onReset,
    onClose,
}: AlterationEditorProps) => {
    // The card is placed when it opens, which is before its bar has been engraved, and the bar
    // is most of its height. So it is placed again whenever its size changes: a card opened low
    // on the page would otherwise grow past the window's edge and take its buttons with it.
    const position = useRef<PopoverActions>(null);
    const watching = useRef<ResizeObserver | undefined>(undefined);
    const watch = useCallback((paper: HTMLDivElement | null) => {
        watching.current?.disconnect();
        watching.current = undefined;
        if (!paper || typeof ResizeObserver === "undefined") return;
        watching.current = new ResizeObserver(() => position.current?.updatePosition());
        watching.current.observe(paper);
    }, []);

    if (!divergence || !anchor) return null;

    const current = writtenAs(outcome);
    const choices = choicesFor(divergence, outcome);

    // The note the hands are on: the one that was clicked, or the first there is
    const notes = outcome?.notes ?? [];
    const note: WrittenNoteInfo | undefined =
        notes.find((entry) => entry.id === noteId) ?? notes.find((entry) => !entry.grace);
    const movable = note && !note.grace ? note : undefined;

    const at = movable ? movable.places.findIndex((place) => Math.abs(place - movable.onset) < 1e-6) : -1;
    const earlier = movable && at > 0 ? movable.places[at - 1] : undefined;
    const later = movable && at >= 0 && at < movable.places.length - 1 ? movable.places[at + 1] : undefined;

    const length = movable?.values ? movable.values.indexOf(movable.units ?? NaN) : -1;
    const longer = movable?.values && length > 0 ? movable.values[length - 1] : undefined;
    const shorter =
        movable?.values && length >= 0 && length < movable.values.length - 1
            ? movable.values[length + 1]
            : undefined;

    const otherStaff =
        movable && movable.staves.length > 1
            ? movable.staves[(movable.staves.indexOf(movable.staff) + 1) % movable.staves.length]
            : undefined;

    const move = (onset: number | undefined) => {
        if (movable && onset !== undefined) onEdit(movable.id, { onset });
    };
    const resize = (units: number | undefined) => {
        if (movable && units !== undefined) onEdit(movable.id, { units });
    };

    return (
        <Popover
            open
            action={position}
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
                paper: {
                    ref: watch,
                    sx: { p: 1.5, minWidth: "17rem", maxWidth: "44rem", pointerEvents: "auto" },
                    onKeyDown: (event: React.KeyboardEvent) => {
                        if (event.key === "ArrowLeft") move(earlier);
                        else if (event.key === "ArrowRight") move(later);
                        else if (event.key === "+" || event.key === "=") resize(longer);
                        else if (event.key === "-") resize(shorter);
                        else return;
                        event.preventDefault();
                    },
                },
            }}
        >
            {mei && outcome?.measure !== undefined && (
                <BarPreview mei={mei} measure={outcome.measure} paint={paint} />
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
                    sx={{ mt: 0.5 }}
                >
                    {choices.map((choice) => (
                        <ToggleButton
                            key={choice}
                            value={choice}
                            sx={{ textTransform: "none", py: 0.25, whiteSpace: "nowrap" }}
                        >
                            {choiceLabel(divergence, choice)}
                        </ToggleButton>
                    ))}
                </ToggleButtonGroup>
            )}

            <Box sx={{ mt: 0.75, display: "flex", alignItems: "center", gap: 0.25 }}>
                {movable && (
                    <>
                        <Tool name="Earlier" disabled={earlier === undefined} onClick={() => move(earlier)}>
                            <ChevronLeft fontSize="small" />
                        </Tool>
                        <Tool name="Later" disabled={later === undefined} onClick={() => move(later)}>
                            <ChevronRight fontSize="small" />
                        </Tool>
                        <Box sx={{ width: 12 }} />
                        <Tool name="Shorter" disabled={shorter === undefined} onClick={() => resize(shorter)}>
                            <Remove fontSize="small" />
                        </Tool>
                        <Tool name="Longer" disabled={longer === undefined} onClick={() => resize(longer)}>
                            <Add fontSize="small" />
                        </Tool>
                        <Box sx={{ width: 12 }} />
                        <Tool
                            name="Other staff"
                            disabled={otherStaff === undefined}
                            onClick={() => {
                                if (otherStaff) onEdit(movable.id, { staff: otherStaff });
                            }}
                        >
                            <SwapVert fontSize="small" />
                        </Tool>
                    </>
                )}
                <Box sx={{ flexGrow: 1 }} />
                {changed && (
                    <Tool
                        name="Back to automatic"
                        onClick={() => {
                            onReset(divergence);
                        }}
                    >
                        <RestartAlt fontSize="small" />
                    </Tool>
                )}
                <Tooltip title={accountOf(divergence, outcome)}>
                    <InfoOutlined
                        fontSize="small"
                        aria-label="What this is"
                        sx={{ color: "text.disabled", mx: 0.5 }}
                    />
                </Tooltip>
            </Box>
        </Popover>
    );
};
