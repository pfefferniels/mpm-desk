import { useState } from 'react'
import type { AlignedPedal } from '../../fitting/alignment'
import type { InsertPedalOptions } from '../../fitting/transformers/pedal/InsertPedalInstructions'
import { ROW_HEIGHT } from './layout'

/** Which movement a click asks for: the foot landing, or lifting again. */
export type Direction = InsertPedalOptions['direction']

const PRESS = 'lightblue'
const PICKED = '#60a5fa'
const ANCHOR = '#1d4ed8'
const INK = '#1f2937'
const SEAM = '#ffffff'

/** How tall the ↓ / ↑ glyph is drawn. */
const ARROW_HEIGHT = 11

/** How far the glyph stands from the edge it acts on. */
const ARROW_INSET = 9

/** No glyph in a half narrower than this: it would cross the seam. */
const ARROW_ROOM = 14

/** Under this a press is thinner than the seam would be, so there is nothing to divide. */
const SEAM_ROOM = 6

/** Drawn pointing down, and turned over for the other direction. */
const Arrow = ({ direction, x, y, opacity }: {
    direction: Direction
    x: number
    y: number
    opacity: number
}) => (
    <path
        d={`M 0 ${-ARROW_HEIGHT / 2} V ${ARROW_HEIGHT / 2} M -3.5 ${ARROW_HEIGHT / 2 - 4}` +
            ` L 0 ${ARROW_HEIGHT / 2} L 3.5 ${ARROW_HEIGHT / 2 - 4}`}
        transform={`translate(${x}, ${y})${direction === 'up' ? ' rotate(180)' : ''}`}
        fill='none'
        stroke={INK}
        strokeOpacity={opacity}
        strokeWidth={1.5}
        strokeLinecap='round'
        strokeLinejoin='round'
        pointerEvents='none'
    />
)

interface PressBoxProps {
    pedal: AlignedPedal
    /** Where the press falls on the tick grid, and how long it is held. */
    date: number
    duration: number
    /** The top of the row it is drawn on. */
    y: number
    stretchX: number
    /** How far down the anchor reaches, so a press meets the lanes it will be written into. */
    guideTo: number
    onPick: (pedal: AlignedPedal, direction: Direction) => void
}

/**
 * One recorded press, split down the middle into the two movements it can be read as.
 *
 * The halves are the press itself: `InsertPedal` anchors a `down` where the foot lands and an `up`
 * where it lifts, so the left half stands for the left edge and the right half for the right one.
 * Which of the two is being asked for is settled by where the press is clicked, and the dialog
 * opens on that reading rather than on a default.
 */
export const PressBox = ({
    pedal,
    date,
    duration,
    y,
    stretchX,
    guideTo,
    onPick,
}: PressBoxProps) => {
    const [hovered, setHovered] = useState<Direction>()

    const x = date * stretchX
    const width = duration * stretchX
    const half = width / 2
    const middle = y + ROW_HEIGHT / 2

    const halves = [
        { direction: 'down' as const, left: x, anchor: date, arrowX: x + ARROW_INSET },
        {
            direction: 'up' as const,
            left: x + half,
            anchor: date + duration,
            arrowX: x + width - ARROW_INSET,
        },
    ]

    return (
        <g
            className='pedalPress'
            data-id={`pedalPress_${pedal['xml:id']}`}
            onMouseLeave={() => setHovered(undefined)}
        >
            <rect x={x} y={y} width={width} height={ROW_HEIGHT} fill={PRESS} />

            {width >= SEAM_ROOM && (
                <line
                    x1={x + half}
                    y1={y}
                    x2={x + half}
                    y2={y + ROW_HEIGHT}
                    stroke={SEAM}
                    strokeOpacity={0.8}
                    pointerEvents='none'
                />
            )}

            {halves.map(({ direction, left, anchor, arrowX }) => (
                <g key={direction}>
                    {hovered === direction && (
                        <>
                            <rect
                                x={left}
                                y={y}
                                width={half}
                                height={ROW_HEIGHT}
                                fill={PICKED}
                                pointerEvents='none'
                            />
                            <line
                                x1={anchor * stretchX}
                                y1={y}
                                x2={anchor * stretchX}
                                y2={y + ROW_HEIGHT}
                                stroke={ANCHOR}
                                strokeWidth={3}
                                pointerEvents='none'
                            />
                            <line
                                x1={anchor * stretchX}
                                y1={y + ROW_HEIGHT}
                                x2={anchor * stretchX}
                                y2={guideTo}
                                stroke={ANCHOR}
                                strokeOpacity={0.4}
                                strokeDasharray='2 3'
                                pointerEvents='none'
                            />
                        </>
                    )}

                    {half >= ARROW_ROOM && (
                        <Arrow
                            direction={direction}
                            x={arrowX}
                            y={middle}
                            opacity={hovered === direction ? 0.9 : 0.4}
                        />
                    )}

                    <rect
                        data-direction={direction}
                        x={left}
                        y={y}
                        width={half}
                        height={ROW_HEIGHT}
                        fill='transparent'
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={() => setHovered(direction)}
                        onClick={() => onPick(pedal, direction)}
                    >
                        <title>{`${direction} @${anchor}`}</title>
                    </rect>
                </g>
            ))}
        </g>
    )
}
