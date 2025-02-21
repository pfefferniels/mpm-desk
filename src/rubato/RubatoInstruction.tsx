import { calculateRubatoOnDate } from "mpmify"
import { Rubato } from "../../../mpm-ts/lib"
import { MouseEventHandler, useState } from "react"

interface RubatoInstructionProps {
    rubato: Rubato
    onsetDates: number[]
    stretchX: number
    height: number
    onClick: MouseEventHandler<SVGRectElement>
    active: boolean
}

export const RubatoInstruction = ({ active, onClick, rubato, onsetDates, stretchX, height }: RubatoInstructionProps) => {
    const [hovered, setHovered] = useState(false)
    const lines = []

    for (const date of onsetDates) {
        const tickDate = calculateRubatoOnDate(date, rubato)
        lines.push((
            <g key={`rubatoLine_${rubato.date}`}>
                <line
                    x1={tickDate * stretchX}
                    x2={tickDate * stretchX}
                    y1={0}
                    y2={height}
                    stroke='black'
                    strokeWidth={1}
                />

                {(onsetDates.indexOf(date) === 0 && rubato.lateStart) && (
                    <text
                        transform={`rotate(90, ${tickDate * stretchX}, ${height})`}
                        x={tickDate * stretchX}
                        y={height}
                        fontSize={10}
                        fill={hovered ? 'black' : 'gray'}
                    >
                        {rubato.lateStart.toFixed(2)}
                    </text>
                )}
                {(onsetDates.indexOf(date) === onsetDates.length - 1 && rubato.earlyEnd) && (
                    <text
                        transform={`rotate(90, ${tickDate * stretchX}, ${height})`}
                        x={tickDate * stretchX}
                        y={height}
                        fontSize={10}
                        fill={hovered ? 'black' : 'gray'}
                    >
                        {rubato.earlyEnd.toFixed(2)}
                    </text>
                )}
            </g>
        ))
    }

    const margin = 2.5

    return (
        <g className="rubatoInstruction">
            <rect
                key={`rubato_${rubato.date}`}
                x={(rubato.date * stretchX) + margin}
                y={0}
                width={(rubato.frameLength * stretchX) - margin * 2}
                height={height}
                fill={active ? 'blue' : 'gray'}
                fillOpacity={hovered ? 0.5 : 0.2}
                onMouseOver={() => setHovered(true)}
                onMouseOut={() => setHovered(false)}
                onClick={onClick}
            />
            {lines}

            <text
                x={(rubato.date * stretchX) + margin}
                y={0}
                fontSize={10}
                fill={hovered ? 'black' : 'gray'}
            >
                {rubato.intensity?.toFixed(2)}
            </text>

            {rubato.loop && (
                <text
                    x={((rubato.date + rubato.frameLength) * stretchX) + margin}
                    y={height / 2}
                    fontSize={10}
                    fill='black'
                >
                    [...]
                </text>
            )}
        </g>
    )
}
