import { MouseEventHandler } from "react"
import { PartialBy } from "../utils"
import { Frame as FrameData } from "mpmify/lib/transformers"

interface FrameProps {
    frame: PartialBy<FrameData, 'length'>
    stretchX: number
    height: number
    onRemove: () => void
    onClick: MouseEventHandler
}

export const Frame = ({ frame, stretchX, height, onRemove, onClick }: FrameProps) => {
    return (
        <rect
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

