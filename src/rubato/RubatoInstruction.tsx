import { calculateRubatoOnDate } from "mpmify"
import { Rubato } from "../../../mpm-ts/lib"
import { MouseEventHandler, useState } from "react"
import * as Tone from "tone"

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
    const lines: JSX.Element[] = []

    const handleClick = () => {
        const transport = Tone.getTransport()
        transport.stop()
        transport.position = 0
        transport.cancel()

        const synth = new Tone.Synth().toDestination();

        const n = 8
        for (let i = 0; i < n; i++) {
            const date = rubato.date + rubato.frameLength / n * i
            const tickDate = calculateRubatoOnDate(date, rubato) - rubato.date
            transport.schedule((time) => {
                synth.triggerAttackRelease("G4", "8n", time);
            }, tickDate / 720)
        }
        transport.start()
    }

    onsetDates.forEach((date, i) => {
        const tickDate = calculateRubatoOnDate(date, rubato)
        lines.push((
            <g key={`rubatoLine_${rubato.date}`}>
                <line
                    x1={tickDate * stretchX}
                    x2={tickDate * stretchX}
                    y1={i === 0 ? -7 : 0}
                    y2={height}
                    stroke='black'
                    strokeWidth={1}
                />

                {(onsetDates.indexOf(date) === 0 && rubato.lateStart) && (
                    <text
                        className='rubatoLateStart'
                        transform={`rotate(90, ${tickDate * stretchX}, ${height})`}
                        x={tickDate * stretchX + 5}
                        y={height}
                        fontSize={10}
                        fill={hovered ? 'black' : 'gray'}
                    >
                        {`${(rubato.lateStart * 100).toFixed(2)}%`}
                    </text>
                )}
                {(onsetDates.indexOf(date) === onsetDates.length - 1 && rubato.earlyEnd) && (
                    <text
                        transform={`rotate(90, ${tickDate * stretchX - 10}, ${height})`}
                        x={tickDate * stretchX - 10}
                        y={height}
                        fontSize={10}
                        fill={hovered ? 'black' : 'gray'}
                    >
                        {rubato.earlyEnd.toFixed(2)}
                    </text>
                )}
            </g>
        ))
    })

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
                onClick={(e) => {
                    handleClick()
                    onClick(e)
                }}
            />
            {lines}

            <text
                x={(rubato.date * stretchX) + margin}
                y={0}
                fontSize={12}
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
