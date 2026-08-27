import {
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
} from 'react';
import { Box, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { Download } from '@mui/icons-material';
import { DeskToolbar } from '../../components/DeskToolbar';
import { APP_BAR_HEIGHT } from '../../components/toolbar/EditorAppBar';
import { ToolCheckbox } from '../../components/toolbar/ToolCheckbox';
import { ToolGroup } from '../../components/toolbar/ToolGroup';
import { ToolStatus } from '../../components/toolbar/ToolStatus';
import { ToolbarButton } from '../../components/toolbar/ToolbarButton';
import { useCallSelection } from '../../hooks/CallSelection';
import { useWorkDocument } from '../../hooks/WorkDocument';
import { getLaneColor } from '../../segment-stack/spanColors';
import { renderPerformance } from '../../utils/espressivo';
import { documentSlug, downloadAsFile } from '../../utils/utils';
import { indexMarkup } from './markupIndex';
import type { ViewProps } from '../TransformerViewProps';

/** Which of the two documents is on screen. */
type Pane = 'MPM' | 'MSM';

const CAPTIONS: Record<Pane, string> = {
    MPM: 'The performance markup this editor writes — the same document Save puts in the archive as performance.mpm. Click an instruction to open the desk that wrote it.',
    MSM: 'The score with the recording laid on it: velocities and millisecond onsets as measured. Not the score-only document the MIDI render is given, which states no timing of its own.',
};

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// The gray ramp `theme.ts` collects, written out here because the rows are raw elements rather
// than `sx` — over a thousand of them, and Emotion has no business serialising one style object
// per line.
const GRAY_200 = '#e5e7eb';
const GRAY_400 = '#9ca3af';
const GRAY_100 = '#f3f4f6';

/**
 * Two shapes, because the row's width and the wrap setting are the same decision.
 *
 * Unwrapped, the row is as wide as its longest line — `min-width: 100%` so a short one still
 * fills the pane — and that is what lets a selected line's background reach across the part of
 * the document that is scrolled out to the right. A row left at the pane's width would paint its
 * highlight only over the first screenful of a 202-character line.
 *
 * Wrapped, `max-content` would be a bug rather than a nicety: it sizes the row to the unbroken
 * line and nothing ever wraps. So the row goes back to the pane's width and the text is allowed
 * to shrink into it — `min-width: 0`, because a flex item defaults to `auto` and refuses.
 */
const ROW: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    width: 'max-content',
    minWidth: '100%',
};
const ROW_WRAPPED: CSSProperties = { display: 'flex', alignItems: 'flex-start' };

const TEXT: CSSProperties = { whiteSpace: 'pre' };
const TEXT_WRAPPED: CSSProperties = {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    minWidth: 0,
};

interface RowProps {
    line: number;
    text: string;
    /** The element this line opens, where it carries an id — the lane colour's key. */
    type?: string;
    id?: string;
    /** One of the selected calls wrote this element. */
    active: boolean;
    wrap: boolean;
    onOpen: (id: string) => void;
}

/**
 * One line, and every state it can be in.
 *
 * `memo` because the list is over a thousand long and both things that change here — the
 * selection and the wrap — change while the user is looking at it. Every prop is a primitive
 * except `onOpen`, which the desk holds stable, so the comparison is the default one.
 *
 * The line *number* is not here. It is drawn by the container as a CSS counter, for the reason
 * given where that rule is written.
 */
const Row = memo(({ line, text, type, id, active, wrap, onOpen }: RowProps) => {
    const style: CSSProperties = {
        ...(wrap ? ROW_WRAPPED : ROW),
        // The tree's own colour for this element type, so a `<tempo>` reads here as the same
        // thing it is over there. Unknown types answer `#666`, which is the neutral this wants.
        borderLeft: `3px solid ${type === undefined ? 'transparent' : getLaneColor(type)}`,
        ...(active && { background: GRAY_200 }),
    };

    return (
        <div
            data-line={line}
            {...(id !== undefined && {
                'data-id': id,
                title: `${id}\nOpen the desk that wrote this`,
            })}
            {...(active && { 'data-active': '' })}
            onClick={id === undefined ? undefined : () => onOpen(id)}
            style={style}
        >
            <span style={wrap ? TEXT_WRAPPED : TEXT}>{text}</span>
        </div>
    );
});
Row.displayName = 'Row';

/**
 * The document, as text.
 *
 * ## What it is for
 *
 * Every other desk draws one dimension of the performance. This one draws the artefact all of
 * them are writing, so that what a gesture put in the file can be read back — and, since
 * `CallSelection` speaks in the same `xml:id`s the markup carries, so that reading it and acting
 * on it are the same place. Selecting a claim lands here on its elements; clicking an
 * instruction here opens the desk that wrote it.
 *
 * It was called the result desk, which named a stage of a pipeline run rather than an aspect of
 * the work — the vocabulary the 2026-08-26 rewrite left behind — and showed both documents as
 * unlabelled `<pre>`s, the second in literal blue. See `markupIndex.ts` for why those were two
 * horizontal ribbons rather than anything readable.
 *
 * ## Only one export survives
 *
 * There were three: Download MPM, Download MIDI, Copy to Clipboard. `buildWorkArchive` already
 * writes `transcription.mei`, `work.json`, `performance.mpm` and `score.msm` into the archive
 * Save produces, and its `performance.mpm` is the same document this desk shows — so two of the
 * three handed the user a file they had just been given. The MIDI is the one that renders
 * something the archive does not contain, so it is the one that stays, and it is this desk's
 * single `primary`.
 *
 * ## No find field
 *
 * Deliberately none. Every line of the document is in the DOM — there is no virtualisation to
 * hide a match from the browser — so the browser's own find is better at this than anything
 * worth building here, and it is the one search UI nobody has to learn. The line numbers stay
 * out of its way by being CSS counters rather than text.
 *
 * ## No scroll registration
 *
 * `ScrollSyncProvider`'s two domains are ticks and the recording's elapsed seconds. This desk's
 * axis is neither — it is a document — so it joins no domain and must not be given one.
 */
export const MarkupDesk = ({ msm, performanceXml }: ViewProps) => {
    const { metadata } = useWorkDocument();
    const { activeElements, callForElement, focusCall } = useCallSelection();

    const [pane, setPane] = useState<Pane>('MPM');
    const [wrap, setWrap] = useState(false);
    const [exported, setExported] = useState<'' | 'saved' | 'failed'>('');

    const viewRef = useRef<HTMLDivElement>(null);

    // The MSM is built by espressivo from the alignment, so it is derived only when it is the
    // pane being shown; the MPM is the string the fit already produced.
    const source = useMemo(
        () => (pane === 'MPM' ? performanceXml : (msm.serialize() ?? '')),
        [pane, performanceXml, msm],
    );
    const doc = useMemo(() => indexMarkup(source), [source]);

    const activeLines = useMemo(() => {
        const set = new Set<number>();
        for (const id of activeElements) {
            const line = doc.lineOf.get(id);
            if (line !== undefined) set.add(line);
        }
        return set;
    }, [activeElements, doc]);

    const firstActive = activeLines.size === 0 ? undefined : Math.min(...activeLines);

    useEffect(() => {
        if (firstActive === undefined) return;
        // `nearest`, so the playhead passing through a selection nudges the pane into range
        // rather than yanking it to the middle — the choice the narrative desk's rows make.
        viewRef.current
            ?.querySelector(`[data-line="${firstActive}"]`)
            ?.scrollIntoView({ block: 'nearest' });
    }, [firstActive, doc]);

    /**
     * Open the desk that wrote this element.
     *
     * `focusCall` is the editor's existing answer to "take me to the decision behind this": it
     * switches desk by the call's `transformerName` — through `TRANSFORMER_ALIASES`, so a retired
     * name still lands — puts the call's own scope on the picker, names it in the URL hash and
     * selects it. A call whose transformer has no desk of its own is still selected and still
     * linkable; it simply has nowhere to go, which is the honest outcome.
     *
     * The miss is left silent on purpose. Whether an element is claimed is only answerable by
     * scanning the run's outcomes, and asking it of all 684 identified lines up front would be a
     * few hundred thousand comparisons on every refit to grey out a state that barely occurs —
     * everything in the MPM was written by something. So the question is asked once, on the
     * click, and an unclaimed element leaves the editor where it was.
     */
    const open = useCallback(
        (id: string) => {
            const call = callForElement(id);
            if (call) focusCall(call);
        },
        [callForElement, focusCall],
    );

    /**
     * The performance as MIDI, through the module that owns rendering rather than around it.
     *
     * `renderPerformance` is where spotlighting, the exaggeration scalar and the render cache
     * live; this was the one MIDI path in the app that reached past it to `renderExpressiveMidi`.
     * The file is a plain render — the document as it stands, not as the playback knob is
     * currently colouring it.
     */
    const downloadMidi = useCallback(() => {
        try {
            const midi = renderPerformance({
                // The score half only. The recording states itself in the very attributes a
                // render writes, so a document carrying both is ambiguous about which timing it
                // means — `Alignment.serializeScore` exists for exactly this call.
                msm: msm.serializeScore() ?? '',
                mpm: performanceXml,
            });
            downloadAsFile(
                new Blob([midi as BlobPart]),
                `${documentSlug(metadata.title)}.mid`,
                'audio/midi',
            );
            setExported('saved');
        } catch (error) {
            console.error('Failed to render the performance to MIDI:', error);
            setExported('failed');
        }
    }, [msm, performanceXml, metadata.title]);

    return (
        <div>
            <DeskToolbar>
                <ToolGroup label='View'>
                    <ToggleButtonGroup
                        value={pane}
                        exclusive
                        // An exclusive group answers a click on the pressed button with `null`,
                        // and types it `any` so nothing catches it. There is no "no document"
                        // here, so that click leaves the switch where it is.
                        onChange={(_, next: Pane | null) => {
                            if (next === null || next === pane) return;
                            setPane(next);
                        }}
                        size='small'
                    >
                        <ToggleButton value='MPM'>MPM</ToggleButton>
                        <ToggleButton value='MSM'>MSM</ToggleButton>
                    </ToggleButtonGroup>
                    <ToolCheckbox
                        checked={wrap}
                        onChange={setWrap}
                        label='Wrap'
                        tooltip='Break long lines instead of scrolling sideways'
                    />
                </ToolGroup>

                <ToolGroup label='Document'>
                    <ToolbarButton
                        primary
                        icon={<Download fontSize='small' />}
                        label='Download MIDI'
                        tooltip='Render the performance to a MIDI file and save it. The markup itself is already in the archive Save writes.'
                        onClick={downloadMidi}
                    >
                        Download MIDI
                    </ToolbarButton>
                    {/* The clipboard and the MIDI both used to fail into a `catch` that said
                        nothing, so a failed export looked exactly like a successful one. */}
                    <ToolStatus width={52} tone={exported === 'failed' ? 'warning' : 'default'}>
                        {exported}
                    </ToolStatus>
                </ToolGroup>
            </DeskToolbar>

            <Box
                sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    // The bar is `position: sticky`, so it takes its height out of the viewport
                    // without any layout saying so. This desk is the one that fills what is left.
                    height: `calc(100dvh - ${APP_BAR_HEIGHT}px)`,
                }}
            >
                <Typography
                    variant='caption'
                    color='text.secondary'
                    sx={{
                        flexShrink: 0,
                        px: 2,
                        py: 0.75,
                        borderBottom: 1,
                        borderColor: 'divider',
                        // `AspectSelect` floats over this corner; the caption keeps clear of it,
                        // as `MetadataDesk` does with the same gutter.
                        pr: '15rem',
                    }}
                >
                    {CAPTIONS[pane]}
                </Typography>

                <Box
                    ref={viewRef}
                    sx={{
                        flex: 1,
                        minHeight: 0,
                        overflow: 'auto',
                        fontFamily: MONO,
                        fontSize: 12,
                        lineHeight: 1.55,
                        py: 1,
                        counterReset: 'markup-line',
                        // One serialisation for the whole list rather than one per line, and the
                        // only way a raw element gets a hover state at all.
                        '& [data-id]': { cursor: 'pointer' },
                        '& [data-id]:hover': { background: GRAY_100 },
                        '& [data-line]': { counterIncrement: 'markup-line' },
                        /*
                            The line number, as generated content rather than as a `<span>`.

                            Two reasons, and the first is the one that matters. Find-in-page does
                            not match CSS generated content, so the numbers stay out of the way of
                            the browser's own search — which is this desk's search. A gutter of
                            real text would answer a hunt for `1440` with line 1440 as well as
                            every `date="1440"`, and the numbers would win by being first.

                            The second is that it takes a thousand elements out of the tree.

                            `position: sticky` works here because the row is a flex container, so
                            its `::before` is a flex item with a box of its own. It needs the
                            opaque background to be worth sticking: the longest line in the
                            shipped MPM is 202 characters and wrapping is off by default, so
                            without it the code would scroll under a transparent gutter.
                        */
                        '& [data-line]::before': {
                            content: 'counter(markup-line)',
                            position: 'sticky',
                            left: 0,
                            flexShrink: 0,
                            width: '4.5ch',
                            pr: '1.5ch',
                            textAlign: 'right',
                            color: GRAY_400,
                            background: '#ffffff',
                            userSelect: 'none',
                            fontVariantNumeric: 'tabular-nums',
                        },
                    }}
                >
                    {doc.lines.map((line, index) => (
                        <Row
                            key={index}
                            line={index}
                            text={line.text}
                            {...(line.type !== undefined && { type: line.type })}
                            {...(pane === 'MPM' && line.id !== undefined && { id: line.id })}
                            active={activeLines.has(index)}
                            wrap={wrap}
                            onOpen={open}
                        />
                    ))}
                </Box>
            </Box>
        </div>
    );
};
