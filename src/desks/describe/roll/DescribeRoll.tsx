import { useCallback, useMemo, useState, useSyncExternalStore, type PointerEvent, type ReactNode } from 'react';
import { Box } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import { usePhysicalZoom } from '../../../hooks/ZoomProvider';
import { useScrollRegistration } from '../../../hooks/useScrollRegistration';
import { svgPoint } from '../../../utils/svgPoint';
import {
    barLinesOf,
    beatLinesOf,
    clamp,
    clockOf,
    describedOf,
    frameOf,
    gutterOf,
    lastMs,
    msOf,
    notationOf,
    noteAt,
    pedalRowsOf,
    placeNotes,
    scaleOf,
    TOP,
    xOf,
} from './geometry';
import { Apart, Bars, Graces, Gutter, Notes, Pedals, Playhead, Ruler, Shadows, Staves, type Dimming } from './layers';
import { Held, Lanes, Pencil, Preview, Remarks, Said, type Lane } from './marks';
import { LANE, lanesOf, markOf, markPath, measurer, rowY, seatAll, widthOfWords, type Seated } from './shapes';
import { aboutOf, caughtBy, endOf, hasMoved, notesOf, remarkAt, wholePiece, type Drag } from './strokes';
import { useTones, WORDS_FONT } from './tones';
import type { About, RollGrace, RollNote, RollPedals, RollRemark, RollView } from './types';

export interface DescribeRollProps {
    notes: readonly RollNote[];
    graces: readonly RollGrace[];
    pedals: RollPedals;
    /** The score's beats on the recording's clock, as the tempo so far places them. */
    beats: readonly { date: number; ms: number }[];
    /** In ticks. */
    bars: readonly { n: number; from: number; to: number }[];
    /** Ticks over which the tempo is only assumed: the bar lines are dashed there. */
    assumed: readonly { from: number; to: number }[];
    remarks: readonly RollRemark[];
    /** The selection being described: drawn like a remark without words, the rest dimmed. */
    draft?: About | null;
    /** The remark that is lit (pointed at or called up): its notes stand out, the rest dim. */
    lit?: string | null;
    /** Notes the lit remark was fitted to, where known; otherwise its `about` decides. */
    evidence?: ReadonlySet<string>;
    playheadMs?: number | null;
    view: RollView;
    /** False: no strokes and no picking; a click still calls up a remark, or seeks. */
    editable: boolean;
    /** A note was clicked; `additive` with shift, ctrl or cmd held. */
    onPick?: (noteId: string, additive: boolean) => void;
    /**
     * A passage, a box of notes or an arrow was drawn; or, with `kind: 'piece'`, the line that
     * waits for a remark about the whole piece was clicked.
     */
    onStroke?: (about: About, additive: boolean) => void;
    /** A remark was clicked. */
    onRemark?: (id: string) => void;
    /** The pointer came to rest on a remark, or left it. */
    onHover?: (id: string | null) => void;
    /** A click on nothing, or on the ruler. */
    onSeek?: (ms: number) => void;
    /** Rendered by the roll at the draft's place: the pen. */
    pen?: ReactNode;
    /** Rendered by the roll at the lit remark's words: its popover. */
    popover?: ReactNode;
}

/** Past the last sound, so that its words have somewhere to be. */
const MARGIN = 60;
/** The size taken where nothing lays the page out, as in a test. */
const UNMEASURED = { width: 1100, height: 560 };
const LEAST_HEIGHT = 240;
/** How far what the desk hangs on a mark may follow it along the roll: as wide as a popover is. */
const REACH = 340;
/** How wide a pen is taken to be, to stand centred over its mark. */
const PEN = 150;
/** A popover goes over its remark where less than this is left under it. */
const POPOVER_ROOM = 220;

interface Size {
    width: number;
    height: number;
}

/**
 * The measure of the remarks' words, taken anew when a font has loaded: words measured in the
 * fallback face are not as wide as they will be drawn.
 */
let measure: ((text: string) => number) | null = null;
const currentMeasure = () => (measure ??= measurer(WORDS_FONT));
const watchFonts = (notify: () => void) => {
    if (typeof document === 'undefined' || !document.fonts) return () => undefined;
    const fonts = document.fonts;
    const loaded = () => {
        measure = measurer(WORDS_FONT);
        notify();
    };
    fonts.addEventListener('loadingdone', loaded);
    return () => fonts.removeEventListener('loadingdone', loaded);
};

const pulse = keyframes({ from: { opacity: 0.15 }, to: { opacity: 0.75 } });

// ---------------------------------------------------------------------------------------------
// The roll
// ---------------------------------------------------------------------------------------------

/**
 * The piano roll of a recorded performance, laid over a grand staff, on which a reader's remarks
 * stand over the passages they are about.
 *
 * The roll is on the recording's clock. Its notes are what the MPM so far renders, and behind
 * each stands its shadow, the same note as it was played. A reader writes on it as on paper: a
 * stroke along it brackets a passage, a stroke down it boxes some of its notes, a stroke from one
 * note to another is an arrow, and a click picks a note.
 *
 * **It draws and it reports, and holds nothing.** The remarks, the selection being described and
 * which remark is lit are the desk's, handed in; a gesture is handed out as what it would be
 * about, and changes nothing here until the desk hands it back as `draft`. What this component
 * keeps is only what belongs to the pointer: the stroke under way, and what it rests on.
 *
 * **Its size is the box it is put in.** It fills its parent in both directions and lays the
 * staves out in whatever height that comes to, so the desk decides how tall the roll is by
 * giving it a box of that height. Across, it is as long as the recording at the Desk's physical
 * zoom, and scrolls with every other physical scroller.
 */
export const DescribeRoll = ({
    notes,
    graces,
    pedals,
    beats,
    bars,
    assumed,
    remarks,
    draft = null,
    lit = null,
    evidence,
    playheadMs = null,
    view,
    editable,
    onPick,
    onStroke,
    onRemark,
    onHover,
    onSeek,
    pen,
    popover,
}: DescribeRollProps) => {
    const pxPerSecond = usePhysicalZoom();
    const tones = useTones();
    const measureWords = useSyncExternalStore(watchFonts, currentMeasure, currentMeasure);

    // The scroller is measured as well as registered: what it has room for is what the roll is
    // laid out in, less the scrollbar, which `clientHeight` already leaves out.
    const joinScroll = useScrollRegistration('describe-roll', 'physical');
    const [viewport, setViewport] = useState<Size | null>(typeof ResizeObserver === 'undefined' ? UNMEASURED : null);
    const scroller = useCallback(
        (element: HTMLDivElement | null) => {
            if (!element) return;
            const quit = joinScroll(element);
            if (typeof ResizeObserver === 'undefined') return quit;
            const observer = new ResizeObserver(() => {
                const { clientWidth: width, clientHeight: height } = element;
                setViewport((known) => (known && known.width === width && known.height === height ? known : { width, height }));
            });
            observer.observe(element);
            return () => {
                observer.disconnect();
                quit?.();
            };
        },
        [joinScroll],
    );

    const [drag, setDrag] = useState<Drag | null>(null);
    const [pointed, setPointed] = useState<string | null>(null);
    const [hovered, setHovered] = useState<string | null>(null);

    const size = viewport ?? UNMEASURED;
    const height = Math.max(size.height, LEAST_HEIGHT);

    // What is written, and the recording's own loudness: neither moves with the window or the zoom.
    const notation = useMemo(() => notationOf(notes, graces), [notes, graces]);
    const scale = useMemo(() => scaleOf(notes.map((note) => note.played.velocity)), [notes]);
    const end = useMemo(() => endOf(notes, bars), [notes, bars]);
    const pedalRows = useMemo(() => pedalRowsOf(pedals), [pedals]);
    const gutter = gutterOf(view.staff, notation.signature);

    // The remarks about the whole piece, in rows over the roll, with one spare for the next.
    const widths = useMemo(
        () => new Map(remarks.map((remark) => [remark.id, widthOfWords(measureWords, remark)])),
        [remarks, measureWords],
    );
    const lanes = useMemo(() => {
        const whole = remarks.filter((remark) => remark.about.kind === 'piece');
        const laid = lanesOf(
            whole.map((remark) => widths.get(remark.id) ?? 0),
            8,
            size.width - 8,
        );
        return {
            rows: laid.rows,
            placed: whole.map((remark, i): Lane => ({ remark, ...laid.places[i], width: widths.get(remark.id) ?? 0 })),
        };
    }, [remarks, widths, size.width]);
    const laneRows = Math.min(lanes.rows + (editable ? 1 : 0), 6);
    const freeRow = Math.min(lanes.rows, Math.max(0, laneRows - 1));
    const lanesHeight = laneRows * LANE;

    // The roll itself: what is left of the height, and as long as the recording.
    const rollHeight = height - lanesHeight;
    const frame = useMemo(
        () => frameOf({ height: rollHeight, pedalRows: pedalRows.length, staff: view.staff, reach: notation.reach }),
        [rollHeight, pedalRows.length, view.staff, notation.reach],
    );
    const total = useMemo(() => lastMs(notes, beats, pedals), [notes, beats, pedals]);
    const width = Math.max(size.width, Math.ceil(xOf(total, pxPerSecond) + MARGIN));
    const placed = useMemo(
        () => placeNotes(notes, notation, { frame, scale, gain: view.loudnessGain, pxPerSecond }),
        [notes, notation, frame, scale, view.loudnessGain, pxPerSecond],
    );
    const byId = useMemo(() => new Map(placed.map((entry) => [entry.note.id, entry])), [placed]);

    const ruled = useMemo(() => {
        const clock = clockOf(beats);
        const xAt = (date: number) => xOf(clock(date), pxPerSecond);
        return {
            xAt,
            lines: barLinesOf(bars, assumed, xAt),
            beats: beatLinesOf(bars, beats, assumed, xAt),
            described: describedOf(assumed, end).map(([from, to]) => [Math.max(0, xAt(from)), xAt(to)] as const),
        };
    }, [beats, bars, assumed, end, pxPerSecond]);

    // Every mark in the roll with its words, and the selection being described after them.
    const seated = useMemo(() => {
        const written: { item: RollRemark | null; about: About; width: number | null }[] = remarks
            .filter((remark) => remark.about.kind !== 'piece')
            .map((remark) => ({ item: remark, about: remark.about, width: widths.get(remark.id) ?? 0 }));
        if (draft && draft.kind !== 'piece') written.push({ item: null, about: draft, width: null });
        return seatAll(written, { notes: placed, byId, xAt: ruled.xAt, shadows: view.shadows }, { top: frame.top, left: 0, right: width });
    }, [remarks, widths, draft, placed, byId, ruled.xAt, view.shadows, frame.top, width]);
    const said = seated.filter((seat): seat is Seated<RollRemark> => seat.item !== null);
    const drafted = seated.find((seat) => seat.item === null);

    // Which notes stand out: those the lit remark was fitted to or is about; else those in hand.
    const litRemark = lit === null ? undefined : remarks.find((remark) => remark.id === lit);
    const dimming = useMemo((): Dimming | null => {
        if (litRemark) {
            const keep = evidence && evidence.size > 0 ? evidence : new Set(notesOf(litRemark.about, notes));
            return keep.size > 0 ? { keep, left: 0.22 } : null;
        }
        return draft && draft.kind !== 'piece' ? { keep: new Set(notesOf(draft, notes)), left: 0.4 } : null;
    }, [litRemark, evidence, draft, notes]);

    // -----------------------------------------------------------------------------------------
    // The pointer
    // -----------------------------------------------------------------------------------------

    const hover = (id: string | null) => {
        if (id === hovered) return;
        setHovered(id);
        onHover?.(id);
    };

    const onRuler = (y: number) => y < TOP - 5;

    /** The stroke with the pointer at `at`: how far it has come, and whether it has reached another note. */
    const reached = (stroke: Drag, at: { x: number; y: number }): Drag => {
        const next = { ...stroke, x1: at.x, y1: at.y };
        const moved = stroke.moved || hasMoved(next);
        const from = stroke.note === null ? undefined : byId.get(stroke.note);
        const over = from && moved ? noteAt(placed, at.x, at.y, view.shadows) : null;
        return { ...next, moved, aim: from && over && over.note.date !== from.note.date ? over.note.id : null };
    };

    const press = (event: PointerEvent<SVGSVGElement>) => {
        if (event.button > 0) return;
        const at = svgPoint(event.currentTarget, event.clientX, event.clientY);
        if (!at) return;
        const mark = remarkAt(event.target);
        const ruler = onRuler(at.y);
        const note = mark !== null || ruler || !editable ? null : (noteAt(placed, at.x, at.y, view.shadows)?.note.id ?? null);
        // A finger scrolls the roll, so it only taps; and a reader who may not write only clicks.
        const tap = event.pointerType === 'touch' || !editable;
        if (!tap) {
            try {
                event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
                // Capture is optional; without it the stroke ends at the edge of the roll.
            }
        }
        setDrag({
            x0: at.x,
            y0: at.y,
            x1: at.x,
            y1: at.y,
            ruler,
            note,
            mark,
            additive: event.shiftKey || event.metaKey || event.ctrlKey,
            tap,
            moved: false,
            aim: null,
        });
    };

    const move = (event: PointerEvent<SVGSVGElement>) => {
        const at = svgPoint(event.currentTarget, event.clientX, event.clientY);
        if (!at) return;
        if (drag) {
            if (!drag.tap) setDrag(reached(drag, at));
            return;
        }
        if (event.pointerType === 'touch') return;
        const mark = remarkAt(event.target);
        hover(mark);
        setPointed(mark !== null || onRuler(at.y) ? null : (noteAt(placed, at.x, at.y, view.shadows)?.note.id ?? null));
    };

    const release = (event: PointerEvent<SVGSVGElement>) => {
        if (!drag) return;
        setDrag(null);
        const at = svgPoint(event.currentTarget, event.clientX, event.clientY);
        if (!at) return;
        if (drag.tap && Math.hypot(at.x - drag.x0, at.y - drag.y0) >= 8) return;
        // The release is the stroke's last word: it is read from where the pointer is lifted,
        // whether or not the move that brought it there has been drawn yet.
        const done = drag.tap ? drag : reached(drag, at);
        if (done.tap || !done.moved) {
            if (done.mark !== null) onRemark?.(done.mark);
            else if (done.note !== null) onPick?.(done.note, done.additive);
            else onSeek?.(Math.max(0, msOf(done.x0, pxPerSecond)));
            return;
        }
        const from = done.note === null ? undefined : byId.get(done.note);
        const aim = done.aim === null ? undefined : byId.get(done.aim);
        if (from && aim) {
            onStroke?.(aboutOf('arrow', [from.note, aim.note], notes, end), false);
            return;
        }
        const caught = caughtBy(done, placed);
        if (caught) onStroke?.(aboutOf(caught.kind, caught.notes, notes, end), done.additive);
    };

    const leave = () => {
        hover(null);
        setPointed(null);
    };

    // -----------------------------------------------------------------------------------------
    // What is drawn only while something is going on
    // -----------------------------------------------------------------------------------------

    const stroke = drag && !drag.tap && drag.moved ? drag : null;
    const strokeFrom = stroke && stroke.note !== null ? byId.get(stroke.note) : undefined;
    const strokeAim = stroke && stroke.aim !== null ? byId.get(stroke.aim) : undefined;
    const arrowMark =
        strokeFrom && strokeAim
            ? markOf(aboutOf('arrow', [strokeFrom.note, strokeAim.note], notes, end), { notes: placed, byId, xAt: ruled.xAt, shadows: view.shadows })
            : null;

    // How far a note is from its shadow is there to be read by anyone; only a writer can pick it up.
    const pointedNote = pointed !== null && !drag ? byId.get(pointed) : undefined;
    const cursor = hovered !== null || (editable && pointedNote) ? 'pointer' : editable ? 'crosshair' : 'default';

    // Where the desk's own things are held: the pen at the draft, the popover at the lit remark.
    const litSeat = litRemark ? said.find((seat) => seat.item.id === litRemark.id) : undefined;
    const litLane = litRemark ? lanes.placed.find((lane) => lane.remark.id === litRemark.id && lane.row < laneRows) : undefined;
    const litWords = litSeat?.spot.words;
    const popoverBelow = litSeat && litWords ? lanesHeight + litWords.y + 18 : 0;
    const popoverUnder = popoverBelow + POPOVER_ROOM <= height;
    const stretchOf = (xa: number, xb: number) => ({ from: Math.max(0, xa - REACH), to: Math.min(width, xb + REACH) });

    const draftSpan = draft && draft.kind === 'span' ? { xa: Math.max(0, ruled.xAt(draft.from)), xb: Math.min(width, ruled.xAt(draft.to)) } : null;

    return (
        <Box
            data-describe-roll
            sx={{
                position: 'relative',
                display: 'flex',
                width: '100%',
                height: '100%',
                minHeight: LEAST_HEIGHT + 20,
                bgcolor: 'background.paper',
                userSelect: 'none',
                '& .describe-roll-pending': {
                    animation: `${pulse} 820ms ease-in-out infinite alternate`,
                    '@media (prefers-reduced-motion: reduce)': { animation: 'none', opacity: 0.5 },
                },
            }}
        >
            {/* The gutter has a column of its own beside the scroller, as the lane names of the
                corrections roll have, so a clef still stands on its staff once the roll has been
                scrolled on, and second zero of the recording is the scroller's own left edge. */}
            <div style={{ flex: '0 0 auto', width: gutter, paddingTop: lanesHeight }}>
                {viewport && (
                    <Gutter frame={frame} width={gutter} height={rollHeight} signature={notation.signature} pedalRows={pedalRows} tones={tones} />
                )}
            </div>

            <div ref={scroller} style={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden', position: 'relative' }}>
                {viewport && (
                    <>
                        {/* What is said of the whole piece is not at any place along the roll, and stays where it is. */}
                        <div style={{ position: 'sticky', left: 0, width: size.width, height: lanesHeight }}>
                            <Lanes
                                lanes={lanes.placed}
                                rows={laneRows}
                                width={size.width}
                                lit={lit}
                                prompt={
                                    editable
                                        ? {
                                              row: freeRow,
                                              text: draft
                                                  ? null
                                                  : remarks.length > 0
                                                    ? 'write here about the whole piece…'
                                                    : 'write here about the whole piece, or drag across the notes to hold a passage in a brace…',
                                          }
                                        : null
                                }
                                tones={tones}
                                onHover={hover}
                                onRemark={(id) => onRemark?.(id)}
                                onPrompt={() => onStroke?.(wholePiece(end), false)}
                            />
                            {/* A draft with no place on the roll is still being written, so its pen is here too. */}
                            {pen !== undefined && draft && !drafted && (
                                <div data-held="pen" style={{ position: 'absolute', left: 8, top: rowY(freeRow) - 1, zIndex: 3, userSelect: 'text' }}>
                                    {pen}
                                </div>
                            )}
                            {popover !== undefined && litRemark && !litSeat && (
                                <div
                                    data-held="popover"
                                    style={{
                                        position: 'absolute',
                                        left: clamp((litLane?.x ?? 8) - 4, 8, size.width - REACH),
                                        top: rowY(litLane?.row ?? freeRow) + LANE + 6,
                                        maxHeight: height - rowY(litLane?.row ?? freeRow) - LANE - 14,
                                        overflowY: 'auto',
                                        zIndex: 3,
                                        userSelect: 'text',
                                    }}
                                >
                                    {popover}
                                </div>
                            )}
                        </div>

                        <svg
                            data-layer="roll"
                            aria-label="Piano roll on the recording's clock: the notes as the MPM so far renders them, each with a shadow where it was played."
                            width={width}
                            height={rollHeight}
                            viewBox={[0, 0, width, rollHeight].join(' ')}
                            style={{ display: 'block', cursor, touchAction: 'pan-x' }}
                            onPointerDown={press}
                            onPointerMove={move}
                            onPointerUp={release}
                            onPointerCancel={() => setDrag(null)}
                            onPointerLeave={leave}
                        >
                            <Staves frame={frame} width={width} tones={tones} />
                            {draftSpan && draftSpan.xb > draftSpan.xa && (
                                <rect
                                    data-draft-span
                                    x={draftSpan.xa}
                                    y={frame.top}
                                    width={draftSpan.xb - draftSpan.xa}
                                    height={frame.bottom - frame.top}
                                    fill={tones.pencil}
                                    fillOpacity={0.05}
                                    pointerEvents="none"
                                />
                            )}
                            <Bars lines={ruled.lines} beats={ruled.beats} frame={frame} tones={tones} />
                            {view.shadows && <Shadows placed={placed} dimming={dimming} tones={tones} />}
                            <Notes placed={placed} frame={frame} dimming={dimming} tones={tones} />
                            {view.shadows && pointedNote && <Apart entry={pointedNote} tones={tones} />}
                            <Pedals pedals={pedals} rows={pedalRows} frame={frame} shadows={view.shadows} pxPerSecond={pxPerSecond} end={total} tones={tones} />
                            <Graces graces={graces} notation={notation} frame={frame} pxPerSecond={pxPerSecond} dimmed={litRemark !== undefined && dimming !== null} />
                            <Remarks seated={said} lit={lit} tones={tones} />
                            {drafted && draft && (
                                <g data-draft={draft.kind}>
                                    <Pencil seat={drafted} alpha={0.6} tones={tones} />
                                </g>
                            )}
                            {stroke && <Preview drag={stroke} arrow={arrowMark ? markPath(arrowMark, arrowMark) : null} frame={frame} tones={tones} />}
                            <Ruler lines={ruled.lines} described={ruled.described} width={width} tones={tones} />
                            {playheadMs !== null && <Playhead x={xOf(playheadMs, pxPerSecond)} frame={frame} tones={tones} />}
                        </svg>

                        {said.map((seat) => (
                            <Said
                                key={seat.item.id}
                                seat={seat}
                                width={widths.get(seat.item.id) ?? 0}
                                offset={lanesHeight}
                                lit={lit === seat.item.id}
                                tones={tones}
                                onHover={hover}
                                onRemark={(id) => onRemark?.(id)}
                            />
                        ))}

                        {pen !== undefined && drafted && (
                            <Held
                                name="pen"
                                {...stretchOf(drafted.spot.xa, drafted.spot.xb)}
                                at={(drafted.spot.xa + drafted.spot.xb) / 2 - PEN / 2}
                                top={2}
                                bottom={lanesHeight + drafted.spot.point - 2}
                                grows="up"
                            >
                                {pen}
                            </Held>
                        )}
                        {popover !== undefined && litSeat && litWords && (
                            <Held
                                name="popover"
                                {...stretchOf(Math.min(litSeat.spot.xa, litWords.x), Math.max(litSeat.spot.xb, litWords.x + (widths.get(litSeat.item.id) ?? 0)))}
                                at={litWords.x - 4}
                                top={popoverUnder ? popoverBelow : 8}
                                bottom={popoverUnder ? height - 8 : lanesHeight + litWords.y - 18}
                                grows={popoverUnder ? 'down' : 'up'}
                            >
                                {popover}
                            </Held>
                        )}
                    </>
                )}
            </div>
        </Box>
    );
};
