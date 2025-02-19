import { calculateRubatoOnDate } from "mpmify"
import { Rubato } from "../../../mpm-ts/lib"
import { useState } from "react"

interface RubatoInstructionProps {
    rubato: Rubato
    onsetDates: number[]
    stretchX: number
    height: number
    onClick: () => void
    active: boolean
}

export const RubatoInstruction = ({ active, onClick, rubato, onsetDates, stretchX, height }: RubatoInstructionProps) => {
    const [hovered, setHovered] = useState(false)
    const lines = []

    for (const date of onsetDates) {
        const tickDate = calculateRubatoOnDate(date, rubato)
        lines.push((
            <line
                key={`rubatoLine_${rubato.date}`}
                x1={tickDate * stretchX}
                x2={tickDate * stretchX}
                y1={0}
                y2={height}
                stroke='black'
                strokeWidth={1}
            />
        ))
    }

    return (
        <g className="rubatoInstruction">
            <rect
                key={`rubato_${rubato.date}`}
                x={rubato.date * stretchX}
                y={0}
                width={rubato.frameLength * stretchX}
                height={height}
                fill={active ? 'blue' : 'gray'}
                fillOpacity={hovered ? 0.5 : 0.2}
                onMouseOver={() => setHovered(true)}
                onMouseOut={() => setHovered(false)}
                onClick={onClick}
            />

            {lines}
        </g>
    )
}
