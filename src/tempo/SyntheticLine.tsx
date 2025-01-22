import { computeMillisecondsAt, getTempoAt } from "mpmify"
import { TempoCurve, TempoPoint } from "./TempoDesk"
import { useState } from "react"

interface SyntheticLineProps {
    curve: TempoCurve
    stretchX: number
    stretchY: number
}

export const SyntheticLine = ({ curve, stretchX, stretchY }: SyntheticLineProps) => {
    const [hovered, setHovered] = useState(false)

    const step = 20
    const points: TempoPoint[] = []
    for (let i = curve.date; i <= curve.endDate; i += step) {
        points.push({
            date: i,
            time: (curve.startMs + computeMillisecondsAt(i, curve)) / 1000,
            bpm: getTempoAt(i, curve)
        })
    }

    const handlePlay = () => {
        console.log('play')
    }

    return (
        <g
            className='syntheticLine'
            onMouseOver={() => setHovered(true)}
            onMouseOut={() => setHovered(false)}
            onClick={handlePlay}
        >
            {points.map((p, i, arr) => {
                if (i >= arr.length - 1) return null

                return (
                    <line
                        key={`p_${p.date}_${i}`}
                        x1={p.time * stretchX}
                        y1={p.bpm * -stretchY}
                        x2={arr[i + 1].time * stretchX}
                        y2={arr[i + 1].bpm * -stretchY}
                        strokeWidth={hovered ? 3 : 2}
                        stroke="black"
                    />
                )
            })}
        </g>
    )
}