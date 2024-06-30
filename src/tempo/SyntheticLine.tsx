import { TempoPoint } from "./TempoDesk"
import { useState } from "react"

interface SyntheticLineProps {
    onPlay: () => void
    points: TempoPoint[]
    stretchX: number
    stretchY: number
}

export const SyntheticLine = ({ onPlay, points, stretchX, stretchY }: SyntheticLineProps) => {
    const [hovered, setHovered] = useState(false)

    return (
        <g  
            className='syntheticLine'
            onMouseOver={() => setHovered(true)}
            onMouseOut={() => setHovered(false)}
            onClick={onPlay}
        >
            {points.map((p, i) => (
                <circle
                    key={`p_${p.date}_${i}`}
                    cx={p.time * stretchX}
                    cy={p.bpm * -stretchY}
                    r={hovered ? 2 : 1}
                    fill='gray' />
            ))}
        </g>
    )
}