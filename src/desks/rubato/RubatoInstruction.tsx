import { calculateRubatoOnDate, ChordMap, MsmNote } from "mpmify"
import { Rubato } from "../../../../mpm-ts/lib"
import { MouseEventHandler, useState } from "react"
import { MidiFile } from "midifile-ts"
import { asMIDI } from "../../utils/utils"

interface RubatoInstructionProps {
    rubato: Rubato
    onsetDates: number[]
    stretchX: number
    height: number
    onClick: MouseEventHandler<SVGRectElement>
    active: boolean
    chords: ChordMap
    play: (midi: MidiFile) => void
    stop: () => void
}

const getHighestPitchBeforeDate = (chords: ChordMap, date: number): number => {
    const chordDates = Array.from(chords.keys()).filter((d: number) => d <= date).sort((a: number, b: number) => b - a)
    if (chordDates.length === 0) return 60 // C4

    const lastChord = chords.get(chordDates[0])!
    const highestNote = lastChord.reduce((max: MsmNote, note: MsmNote) =>
        note['midi.pitch'] > max['midi.pitch'] ? note : max
    )
    return highestNote['midi.pitch']
}

export const RubatoInstruction = ({ active, onClick, rubato, onsetDates, stretchX, height, chords, play, stop }: RubatoInstructionProps) => {
    const [hovered, setHovered] = useState(false)
    const lines: JSX.Element[] = []

    const handleClick = () => {
        const n = 4
        const gap = 0.02
        const notes = []

        for (let i = 0; i < n; i++) {
            const symbolicDate = rubato.date + rubato.frameLength / n * i
            const tickDate = calculateRubatoOnDate(symbolicDate, rubato) - rubato.date
            const nextSymbolicDate = rubato.date + rubato.frameLength / n * (i + 1)
            const nextTickDate = calculateRubatoOnDate(nextSymbolicDate, rubato) - rubato.date
            const duration = (nextTickDate - tickDate) / 720 - gap
            const pitch = getHighestPitchBeforeDate(chords, symbolicDate)

            notes.push({
                'xml:id': `rubato_tick_${i}`,
                'part': 1,
                'date': symbolicDate,
                'duration': 180,
                'pitchname': '',
                'accidentals': 0,
                'octave': 0,
                'midi.onset': tickDate / 720,
                'midi.duration': Math.max(duration, 0.05),
                'midi.pitch': pitch,
                'midi.velocity': 80
            } as MsmNote)
        }

        const midi = asMIDI(notes)
        if (midi) {
            stop()
            play(midi)
        }
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
