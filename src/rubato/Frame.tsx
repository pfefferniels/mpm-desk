import { MouseEventHandler } from "react"
import { Frame } from "./DatesRow"

interface FrameBoxProps {
    frame: Frame
    stretchX: number
    height: number
    onRemove: () => void
    onClick: MouseEventHandler
}

export const FrameBox = ({ frame, stretchX, height, onRemove, onClick }: FrameBoxProps) => {
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
                if (e.altKey && e.shiftKey) onRemove()
                else onClick(e)
            }}
        />
    )
}

