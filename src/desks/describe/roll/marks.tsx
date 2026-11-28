import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import type { Frame } from './geometry';
import { BADGE, badgeOf, BRACE, bracePath, LANE, rowY, shown, type Seated } from './shapes';
import { isFlat, remarkAt, type Drag } from './strokes';
import { DESCRIBED, WORDS_FAMILY, WORDS_SIZE, type Tones } from './tones';
import type { RollRemark } from './types';

/**
 * What is written on the roll and over it: the remarks with their marks and their words, the
 * stroke while it is being drawn, and what the desk hangs on them.
 */

interface WordsProps {
    remark: RollRemark;
    /** Where the words begin, and their middle. */
    x: number;
    y: number;
    /** How wide they are, badge included. */
    width: number;
    /** Whether they stand on a ground of their own, as they must over the notes. */
    ground: boolean;
    lit: boolean;
    tones: Tones;
}

/**
 * A remark's words, and how it stands: pulsing while it waits to be read, a badge where the
 * expert asks back or something went wrong, struck through when it is set aside, underlined when
 * it is the one in hand.
 */
const Words = ({ remark, x, y, width, ground, lit, tones }: WordsProps) => {
    const badge = badgeOf(remark);
    const muted = remark.state === 'muted';
    const colour = muted ? tones.faint : tones.ink;
    const words = width - (badge ? BADGE : 0);
    const line = muted ? y + 1 : y + 9.5;
    return (
        <g style={{ cursor: 'pointer' }}>
            {/* The ground is also what the pointer finds, between the letters as on them. */}
            <rect x={x - 4} y={y - 10} width={width + 8} height={20} rx={3} fill={tones.paper} fillOpacity={ground ? 0.76 : 0} />
            <text
                className={remark.state === 'pending' ? 'describe-roll-pending' : undefined}
                x={x}
                y={y + 0.5}
                dominantBaseline="central"
                fontFamily={WORDS_FAMILY}
                fontSize={WORDS_SIZE}
                fill={colour}
            >
                {shown(remark.text)}
            </text>
            {(muted || lit) && <line x1={x} y1={line} x2={x + words} y2={line} stroke={colour} />}
            {badge && (
                <>
                    <circle cx={x + words + 11} cy={y} r={7} fill={badge === '?' ? DESCRIBED : tones.trouble} />
                    <text
                        x={x + words + 11}
                        y={y + 0.5}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontFamily={tones.type}
                        fontSize={10.5}
                        fontWeight={600}
                        fill="#fff"
                    >
                        {badge}
                    </text>
                </>
            )}
        </g>
    );
};

interface PencilProps {
    seat: Seated<unknown>;
    alpha: number;
    tones: Tones;
}

/** A mark as the reader's pencil left it: a brace, a hull with a breath of fill, or an arrow. */
export const Pencil = ({ seat, alpha, tones }: PencilProps) => (
    <path
        data-mark={seat.mark.kind}
        d={seat.path}
        fill={seat.mark.kind === 'hull' ? tones.pencil : 'none'}
        fillOpacity={alpha * 0.05}
        stroke={tones.pencil}
        strokeWidth={1.25}
        strokeOpacity={alpha}
        strokeLinejoin="round"
        pointerEvents="none"
    />
);

interface RemarksProps {
    seated: readonly Seated<RollRemark>[];
    lit: string | null;
    tones: Tones;
}

/** The marks of what is said of passages, of sets of notes and of where the playing goes. */
export const Remarks = ({ seated, lit, tones }: RemarksProps) => (
    <g data-layer="remarks">
        {seated.map((seat) => {
            const { item: remark, mark, spot } = seat;
            const active = lit === remark.id;
            return (
                <g key={remark.id} data-remark={remark.id} data-kind={remark.about.kind} data-state={remark.state} data-lit={active || undefined}>
                    <Pencil seat={seat} alpha={remark.state === 'muted' ? 0.35 : active ? 1 : 0.7} tones={tones} />
                    {/* A brace can be pointed at along all its length; a hull and an arrow only by their words, or no note under them could be reached. */}
                    {mark.kind === 'brace' && (
                        <rect x={spot.xa} y={spot.point - 1} width={spot.xb - spot.xa} height={spot.y - spot.point + 3} fill="transparent" style={{ cursor: 'pointer' }} />
                    )}
                </g>
            );
        })}
    </g>
);

interface SaidProps {
    seat: Seated<RollRemark>;
    /** How wide its words are, badge included. */
    width: number;
    /** How far down the scroller the roll begins. */
    offset: number;
    lit: boolean;
    tones: Tones;
    onHover: (id: string | null) => void;
    onRemark: (id: string) => void;
}

/**
 * The words of a remark in the roll, over its mark.
 *
 * They are laid over the roll rather than drawn in it, for one reason: a passage can be longer
 * than the window, and what is said of it has to be readable from any part of it. So the words
 * are `sticky` inside the stretch their mark takes, as what the desk hangs on a mark is (see
 * `Held`): in the middle of the brace while that is in view, at the edge of the window while
 * only part of the brace is, and gone with it. Marks whose stretches overlap are seated at
 * different heights, so words that slide along their own stretch still never meet.
 */
export const Said = ({ seat, width, offset, lit, tones, onHover, onRemark }: SaidProps) => {
    const { item: remark, spot } = seat;
    if (!spot.words) return null;
    const from = Math.min(spot.xa, spot.words.x - 4);
    const to = Math.max(spot.xb, spot.words.x + width + 4);
    return (
        <div
            data-said={remark.id}
            style={{ position: 'absolute', left: from, width: to - from, top: offset + spot.words.y - 10, height: 20, display: 'flex', pointerEvents: 'none', zIndex: 1 }}
        >
            <div style={{ flex: `0 0 ${String(spot.words.x - 4 - from)}px` }} />
            <svg
                data-words={remark.id}
                data-state={remark.state}
                width={width + 8}
                height={20}
                viewBox={[-4, -10, width + 8, 20].join(' ')}
                style={{ position: 'sticky', left: 2, right: 4, flex: '0 0 auto', display: 'block', pointerEvents: 'auto' }}
                onPointerEnter={() => onHover(remark.id)}
                onPointerLeave={() => onHover(null)}
                onClick={() => onRemark(remark.id)}
            >
                <Words remark={remark} x={0} y={0} width={width} ground lit={lit} tones={tones} />
            </svg>
        </div>
    );
};

interface PreviewProps {
    drag: Drag;
    /** The arrow the stroke has become, as path data. */
    arrow: string | null;
    frame: Frame;
    tones: Tones;
}

/** The stroke while it is being drawn: the stretch it would bracket, the box it would draw, or the arrow. */
export const Preview = ({ drag, arrow, frame, tones }: PreviewProps) => {
    const x = Math.min(drag.x0, drag.x1);
    const width = Math.abs(drag.x1 - drag.x0);
    if (arrow) {
        return <path data-preview="arrow" d={arrow} fill="none" stroke={tones.pencil} strokeWidth={1.25} strokeOpacity={0.6} pointerEvents="none" />;
    }
    if (!isFlat(drag)) {
        return (
            <rect
                data-preview="box"
                x={x + 0.5}
                y={Math.min(drag.y0, drag.y1) + 0.5}
                width={width}
                height={Math.abs(drag.y1 - drag.y0)}
                fill="none"
                stroke={tones.pencil}
                strokeDasharray="4 3"
                pointerEvents="none"
            />
        );
    }
    return (
        <g data-preview="span" pointerEvents="none">
            <rect x={x} y={frame.top} width={width} height={frame.bottom - frame.top} fill={tones.pencil} fillOpacity={0.06} />
            {width > 14 && (
                <path
                    d={bracePath(x, x + width, Math.max(drag.y0 - 10, frame.top + 12 + BRACE))}
                    fill="none"
                    stroke={tones.pencil}
                    strokeWidth={1.25}
                    strokeOpacity={0.6}
                />
            )}
        </g>
    );
};

/** A remark about the whole piece, and where it is written over the roll. */
export interface Lane {
    remark: RollRemark;
    x: number;
    row: number;
    width: number;
}

interface LanesProps {
    lanes: readonly Lane[];
    /** How many rows are shown. */
    rows: number;
    width: number;
    lit: string | null;
    /** The row that waits for the next remark about the whole piece, and what it says while it waits. */
    prompt: { row: number; text: string | null } | null;
    tones: Tones;
    onHover: (id: string | null) => void;
    onRemark: (id: string) => void;
    onPrompt: () => void;
}

/** What is said about the whole piece, in rows above the roll. */
export const Lanes = ({ lanes, rows, width, lit, prompt, tones, onHover, onRemark, onPrompt }: LanesProps) => (
    <svg
        data-layer="lanes"
        width={width}
        height={rows * LANE}
        viewBox={[0, 0, width, rows * LANE].join(' ')}
        style={{ display: 'block' }}
        onPointerMove={(event) => onHover(remarkAt(event.target))}
        onPointerLeave={() => onHover(null)}
        onClick={(event) => {
            const remark = remarkAt(event.target);
            if (remark !== null) onRemark(remark);
        }}
    >
        {prompt && (
            <g data-prompt onClick={onPrompt} style={{ cursor: 'text' }}>
                <rect x={0} y={rowY(prompt.row)} width={width} height={LANE} fill="transparent" />
                {prompt.text !== null && (
                    <text
                        x={8}
                        y={rowY(prompt.row) + 10.5}
                        dominantBaseline="central"
                        fontFamily={WORDS_FAMILY}
                        fontSize={WORDS_SIZE - 1}
                        fontStyle="italic"
                        fill={tones.faint}
                    >
                        {prompt.text}
                    </text>
                )}
            </g>
        )}
        {lanes
            .filter((lane) => lane.row < rows)
            .map(({ remark, x, row, width: wide }) => (
                <g key={remark.id} data-remark={remark.id} data-kind="piece" data-state={remark.state} data-lit={lit === remark.id || undefined}>
                    <Words remark={remark} x={x} y={rowY(row) + 10} width={wide} ground={false} lit={lit === remark.id} tones={tones} />
                </g>
            ))}
    </svg>
);

interface HeldProps {
    name: 'pen' | 'popover';
    /** The stretch of the roll it may be anywhere in, and where in it it would be with all of it in view. */
    from: number;
    to: number;
    at: number;
    /** The room it has, from the top of the roll down: it hangs from `top`, or stands on `bottom`. */
    top: number;
    bottom: number;
    grows: 'up' | 'down';
    children: ReactNode;
}

/**
 * Something of the desk's, held at a place on the roll.
 *
 * It scrolls with the roll, but is kept in view for as long as any of its stretch is: it is
 * `sticky` to both edges of the scroller, inside a box no wider than the mark it belongs to with
 * its own width either side. So a pen stays whole while the passage it writes about is on screen,
 * and leaves with it. That is the browser's doing, and takes no knowledge of where the roll is
 * scrolled to.
 *
 * What stands before it in its box is a spacer and not a margin: a margin is part of what has to
 * stay inside the box, and would keep it from ever being moved to the left.
 *
 * Standing on its place it grows upwards; where it is taller than the room over it, it is let
 * down from the top instead of running out of the roll.
 */
export const Held = ({ name, from, to, at, top, bottom, grows, children }: HeldProps) => (
    <Box
        data-held={name}
        sx={{
            position: 'absolute',
            left: from,
            width: to - from,
            top,
            height: Math.max(0, bottom - top),
            display: 'flex',
            alignItems: grows === 'up' ? 'flex-end' : 'flex-start',
            '@supports (align-items: safe flex-end)': { alignItems: grows === 'up' ? 'safe flex-end' : 'flex-start' },
            pointerEvents: 'none',
            zIndex: 2,
        }}
    >
        <Box sx={{ flex: `0 0 ${String(Math.max(0, at - from))}px` }} />
        <Box
            sx={{
                position: 'sticky',
                left: 8,
                right: 8,
                flex: '0 0 auto',
                maxHeight: grows === 'down' ? '100%' : undefined,
                overflowY: grows === 'down' ? 'auto' : undefined,
                pointerEvents: 'auto',
                userSelect: 'text',
            }}
        >
            {children}
        </Box>
    </Box>
);
