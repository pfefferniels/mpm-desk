import type { Ref } from 'react';
import {
    AppBar,
    Box,
    CircularProgress,
    Divider,
    MenuItem,
    Select,
    Slider,
    Stack,
    Typography,
} from '@mui/material';
import { PlayArrow, Redo, Save, Stop, Undo, UploadFile, ZoomIn } from '@mui/icons-material';
import type { Scope } from '../../fitting/instructions/index';
import { usePlayback } from '../../hooks/PlaybackProvider';
import { useWorkDocument } from '../../hooks/WorkDocument';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, useZoom } from '../../hooks/ZoomProvider';
import { shortcut } from '../../utils/shortcut';
import { ToolbarButton } from './ToolbarButton';

interface EditorAppBarProps {
    /**
     * Row two's node, as a callback ref. The desks portal their controls into it — see the
     * note beside `deskRow` in `App.tsx` for why it reaches them through state and not a ref.
     */
    deskRowRef: Ref<HTMLDivElement>;
    /** What the open desk calls itself, off the registry — `displayName ?? aspect`. */
    deskName: string;
    /**
     * The parts of the score, ascending, for the scope picker — each with the name the voice
     * layout gives it, or `Part n` where nothing has named it.
     */
    parts: readonly { scope: number; label: string }[];
    scope: Scope;
    setScope: (scope: Scope) => void;
    /** True while the chain is refitting. */
    pending: boolean;
    /** True when the document has changed since the last save. */
    dirty: boolean;
    /** Whether the reconstruction has anything to hear yet. */
    canPlay: boolean;
    /** False where there is nothing to write — no MEI, or an empty chain. */
    canSave: boolean;
    onSave: () => void;
    onOpen: () => void;
}

/** How wide the fit indicator's slot is, occupied or not. See the note where it is rendered. */
const STATUS_WIDTH = 92;

/** One row of the bar. Both rows are this tall, and neither ever changes height — see below. */
const ROW_HEIGHT = 44;

/**
 * How much of the window the bar occupies, for a desk that has to size itself against what is
 * left. It is `position: sticky`, so it takes its height out of the desk's share of the viewport
 * without any layout saying so — a desk written as `height: 70vh` overflows a short window and
 * leaves a wide one part empty, which is what the markup desk did before it read this.
 */
export const APP_BAR_HEIGHT = 2 * ROW_HEIGHT;

/**
 * The editor's chrome, in two rows.
 *
 * Row one is what is true of the **document**: what it is called, whether it is saved, what can
 * be undone, what is playing, which part is in scope, how far it is zoomed, and whether the
 * chain is still running. Row two is what is true of the **open desk**, and is where every desk
 * portals its own controls.
 *
 * Before this there was one row, and `AppMenu`'s File/Play/Scope sat in it as flat siblings of
 * whatever the open desk had contributed — so nothing on screen said where the app ended and
 * the desk began, and the document's own title, which was computed and passed in, was used only
 * to name the zip and never shown.
 *
 * ## Nothing here changes shape
 *
 * Every slot in row one is fixed-width except the title, which truncates. The dirty dot fades
 * rather than mounting; the fit indicator holds its width whether or not it has anything to
 * say; Play is disabled rather than hidden when there is nothing to hear. The old bar moved
 * every control to the right of whatever had just appeared, and changed height with it, which
 * pushed the plot below up and down while you worked.
 *
 * ## Why row one places its own rules and row two does not
 *
 * `ToolGroup` draws its own left border unless it is first, which is right for a row whose
 * contents are unknown until a desk arrives. Row one is a fixed composition with a `flexGrow`
 * spacer in the middle of it, and an automatic rule would land immediately after that gap. So
 * the rules here are `<Divider>`s placed by hand, and only row two's are automatic.
 */
export const EditorAppBar = ({
    deskRowRef,
    deskName,
    parts,
    scope,
    setScope,
    pending,
    dirty,
    canPlay,
    canSave,
    onSave,
    onOpen,
}: EditorAppBarProps) => {
    const { metadata, undo, redo, canUndo, canRedo } = useWorkDocument();
    const { isPlaying, play, stop } = usePlayback();
    const { stretchX, setStretchX } = useZoom();

    return (
        <AppBar
            position="sticky"
            color="transparent"
            elevation={0}
            sx={{
                bgcolor: 'background.paper',
                // Not `inherit`. `color="transparent"` sets `color: inherit`, and the page's
                // own colour is whatever the document root says — which is not this bar's
                // business to depend on.
                color: 'text.primary',
                borderBottom: 1,
                borderColor: 'divider',
            }}
        >
            <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{ minHeight: ROW_HEIGHT, px: 1 }}
            >
                <Stack
                    direction="row"
                    alignItems="baseline"
                    spacing={0.75}
                    // `minWidth: 0` is what lets `noWrap`'s ellipsis fire at all: a flex item
                    // defaults to `min-width: auto`, so without this the title refuses to
                    // shrink and pushes the actions off the end instead of truncating.
                    //
                    // 30% of the row rather than a fixed width, because a title here is a
                    // sentence — `MetadataDesk` holds it in a growing textarea for that reason —
                    // so no pixel count is ever the right one and the honest question is how much
                    // of the bar it may claim. Truncating is fine: the whole title is one click
                    // away on the metadata desk.
                    sx={{ minWidth: 0, maxWidth: '30%', flexShrink: 1 }}
                >
                    <Typography variant="subtitle2" noWrap sx={{ minWidth: 0 }}>
                        {metadata.title || 'Untitled'}
                    </Typography>
                    {metadata.author && (
                        <Typography
                            variant="caption"
                            color="text.secondary"
                            noWrap
                            // The author does not shrink, and the title absorbs all of it. A name
                            // is short and bounded where a title is neither, and splitting the
                            // squeeze between them spent it on the half that had none to give —
                            // it rendered as `Niel…`, which is worse than absent.
                            sx={{ flexShrink: 0 }}
                        >
                            {metadata.author}
                        </Typography>
                    )}
                </Stack>

                {/* Faded rather than unmounted, so the two controls after it never move. It is
                    `aria-hidden` because a coloured dot is not an announcement; what the state
                    is reaches a reader through the Save button's own description below. */}
                <Box
                    aria-hidden
                    sx={{
                        flexShrink: 0,
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        bgcolor: 'warning.main',
                        opacity: dirty ? 1 : 0,
                        transition: 'opacity 150ms',
                    }}
                />

                <Divider orientation="vertical" flexItem sx={{ my: 1 }} />

                <ToolbarButton
                    icon={<Undo fontSize="small" />}
                    label="Undo"
                    tooltip={`Undo (${shortcut('Z')})`}
                    disabled={!canUndo}
                    onClick={undo}
                />
                <ToolbarButton
                    icon={<Redo fontSize="small" />}
                    label="Redo"
                    tooltip={`Redo (${shortcut('Z', true)})`}
                    disabled={!canRedo}
                    onClick={redo}
                />

                <Divider orientation="vertical" flexItem sx={{ my: 1 }} />

                {/* Stop, not Pause: `PlaybackProvider` has no pause, and the button used to
                    show one for a handler that called `stop()`. And rendered always rather
                    than only when the MPM has something in it — a control that disappears
                    teaches nothing about why it is unavailable. */}
                <ToolbarButton
                    icon={isPlaying ? <Stop fontSize="small" /> : <PlayArrow fontSize="small" />}
                    label={isPlaying ? 'Stop' : 'Play'}
                    tooltip={
                        canPlay
                            ? isPlaying
                                ? 'Stop (Space)'
                                : 'Play (Space)'
                            : 'Nothing to play yet — the chain has written no instructions'
                    }
                    disabled={!canPlay}
                    onClick={() => {
                        if (isPlaying) stop();
                        else play();
                    }}
                />

                <Divider orientation="vertical" flexItem sx={{ my: 1 }} />

                {/*
                    A `Select`, where this was a `ToggleButtonGroup` with one button per part.

                    Three things follow from the change. It cannot be deselected, and MUI's
                    exclusive group answered a click on the already-selected button with
                    `null` — which is not a `Scope`, emptied every plot, and still went into
                    the saved call, where `scope + 1` landed it in part one. It is one width
                    whatever the score, where the group grew a button per part. And it says
                    `Part 1` where the group showed the raw index `0`, while the desks have
                    always captioned the same value `Part ${part + 1}`.
                */}
                <Select<Scope>
                    size="small"
                    value={scope}
                    onChange={(event) => setScope(event.target.value as Scope)}
                    inputProps={{ 'aria-label': 'Scope' }}
                    sx={{ minWidth: 108, flexShrink: 0 }}
                >
                    <MenuItem value="global">Global</MenuItem>
                    {parts.map(({ scope: part, label }) => (
                        <MenuItem key={part} value={part}>
                            {label}
                        </MenuItem>
                    ))}
                </Select>

                <Divider orientation="vertical" flexItem sx={{ my: 1 }} />

                <ZoomIn fontSize="small" sx={{ color: 'text.disabled', flexShrink: 0 }} />
                <Slider
                    size="small"
                    aria-label="Zoom"
                    value={stretchX}
                    min={ZOOM_MIN}
                    max={ZOOM_MAX}
                    step={ZOOM_STEP}
                    onChange={(_, value) => setStretchX(value as number)}
                    sx={{ width: 110, flexShrink: 0 }}
                />

                <Box sx={{ flexGrow: 1 }} />

                {/*
                    Present whether or not it has anything to say, at a width that does not
                    depend on what it says. Two reasons. A slot that appears shoves everything
                    beside it, and this one appears on every gesture. And a live region that is
                    unmounted while idle announces nothing when it comes back — the region has
                    to already be in the accessibility tree for a change inside it to be seen.
                */}
                <Box
                    role="status"
                    aria-live="polite"
                    sx={{
                        width: STATUS_WIDTH,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: 0.5,
                        color: 'warning.main',
                    }}
                >
                    {pending && (
                        <>
                            <CircularProgress size={13} color="inherit" />
                            <Typography variant="caption">refitting</Typography>
                        </>
                    )}
                </Box>

                <ToolbarButton
                    icon={<UploadFile fontSize="small" />}
                    tooltip={`Open a ZIP or MEI (${shortcut('O')})`}
                    onClick={onOpen}
                >
                    Open
                </ToolbarButton>
                <ToolbarButton
                    primary
                    icon={<Save fontSize="small" />}
                    label="Save"
                    tooltip={
                        canSave
                            ? dirty
                                ? `Save — unsaved changes (${shortcut('S')})`
                                : `Save (${shortcut('S')})`
                            : 'Nothing to save yet'
                    }
                    disabled={!canSave}
                    onClick={onSave}
                />
            </Stack>

            <Box
                role="group"
                aria-label={`${deskName} desk`}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    minHeight: ROW_HEIGHT,
                    px: 1,
                    gap: 1,
                    borderTop: 1,
                    borderColor: 'divider',
                    // The tempo desk alone contributes four groups on top of a desk name, and
                    // a narrow window used to put the rightmost of them out of reach entirely.
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    scrollbarWidth: 'thin',
                    '&::-webkit-scrollbar': { height: 5 },
                }}
            >
                <Typography
                    variant="subtitle2"
                    noWrap
                    // The registry's aspects are lowercase — 'tempo', 'source choice'.
                    sx={{ flexShrink: 0, fontWeight: 600, textTransform: 'capitalize', pr: 0.5 }}
                >
                    {deskName}
                </Typography>

                {/*
                    The portal target, and it holds nothing that React owns.

                    React inserts a child of its own into a parent by looking for the next host
                    sibling it *tracks* and calling `insertBefore`; where every other child came
                    from a portal there is no such sibling, so it appends. A desk name rendered
                    into this box would therefore land after every desk's controls rather than
                    before them — which is exactly what the old `{pending && <span>refitting…
                    </span>}` did in the bar it shared with nine portals, and why that span
                    always appeared at the far right.

                    `:not(:empty)` rather than a `borderRight` on the name above, so the rule
                    between the two exists only when there is something on the other side of
                    it — the dangling-divider problem `ToolGroup` exists to solve, one level up.
                */}
                <Box
                    ref={deskRowRef}
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        flexShrink: 0,
                        '&:not(:empty)': { borderLeft: 1, borderColor: 'divider' },
                    }}
                />
            </Box>
        </AppBar>
    );
};
