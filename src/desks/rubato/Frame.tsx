import { MouseEventHandler } from "react"
import { Frame } from "./DatesRow"

interface FrameBoxProps {
    frame: Frame
    stretchX: number
    height: number
    onClick: MouseEventHandler
}

export const FrameBox = ({ frame, stretchX, height, onClick }: FrameBoxProps) => {
    return (
        <rect
            className='frame'
            x={frame.date * stretchX}
            y={0}
            width={(frame.length || 0) * stretchX}
            height={height}
            strokeWidth={2}
            stroke='black'
            fill='gray'
            fillOpacity={0.2}
            onClick={(e) => {
                // The row underneath turns a click into a marker. This one is spoken for.
                e.stopPropagation()
                onClick(e)
            }}
        />
    )
}

interface PendingFrameProps {
    /** Where the first click landed. */
    date: number
    /** The date under the cursor, or `undefined` once it has left the row. */
    cursor?: number
    stretchX: number
    height: number
}

/**
 * The frame being marked: the anchor the first click set, and the box it would make with the
 * date under the cursor.
 *
 * Dashed and untouchable — it is a promise about the next click rather than something to click
 * on. Without it the first click produced nothing at all on screen: a `<rect>` of width zero is
 * not rendered, so the frame appeared only once the second click gave it a length.
 */
export const PendingFrame = ({ date, cursor, stretchX, height }: PendingFrameProps) => {
    const from = Math.min(date, cursor ?? date)
    const to = Math.max(date, cursor ?? date)

    return (
        <g className='pendingFrame' pointerEvents='none'>
            {to > from && (
                <>
                    <rect
                        x={from * stretchX}
                        y={0}
                        width={(to - from) * stretchX}
                        height={height}
                        strokeWidth={1}
                        strokeDasharray='4 4'
                        stroke='black'
                        fill='gray'
                        fillOpacity={0.12}
                    />
                    <text
                        x={((from + to) / 2) * stretchX}
                        y={height * 0.45}
                        fontSize={12}
                        textAnchor='middle'
                        fill='black'
                    >
                        {to - from}
                    </text>
                </>
            )}
            <line
                x1={date * stretchX}
                x2={date * stretchX}
                y1={0}
                y2={height}
                stroke='black'
                strokeWidth={2}
            />
        </g>
    )
}
