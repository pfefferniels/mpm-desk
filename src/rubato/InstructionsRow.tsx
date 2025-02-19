import { calculateRubatoOnDate } from "mpmify"
import { Rubato } from "../../../mpm-ts/lib"
import { MsmNote } from "mpmify/lib/msm"
import { useState } from "react"

interface RubatoInstructionProps {
    rubato: Rubato
    onsetDates: number[]
    stretchX: number
    height: number
}

export const RubatoInstruction = ({ rubato, onsetDates, stretchX, height }: RubatoInstructionProps) => {
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
                fill='gray'
                fillOpacity={hovered ? 0.5 : 0.2}
                onMouseOver={() => setHovered(true)}
                onMouseOut={() => setHovered(false)}
            />

            {lines}
        </g>
    )
}

interface InstructionsRowProps {
    rubatos: Rubato[]
    notes: MsmNote[]
    stretchX: number
    height: number
}

export const InstructionsRow = ({ rubatos, notes, stretchX, height }: InstructionsRowProps) => {
    const instructions = rubatos.map(rubato => {
        const affected = new Set(notes
            .filter(note => note.date >= rubato.date && note.date <= rubato.date + rubato.frameLength)
            .map(note => note.date)
        )

        return (
            <RubatoInstruction
                key={`rubatoInstruction_${rubato.date}`}
                rubato={rubato}
                onsetDates={Array.from(affected)}
                stretchX={stretchX}
                height={height}
            />
        )
    })

    return (
        <g className="instructions">
            {instructions}
        </g>
    )
}
