import { approximateTempo, computeMillisecondsAt, getTempoAt, TempoSegment, TempoWithEndDate } from "mpmify"
import { TempoPoint } from "./TempoDesk"
import { MouseEventHandler, useCallback, useEffect, useState } from "react"
import { MsmNote } from "mpmify/lib/msm"
import { usePiano } from "react-pianosound"
import { useNotes } from "../hooks/NotesProvider"
import { asMIDI } from "../utils"
import { CurveHandle } from "./CurveHandle"

interface SyntheticLineProps {
    notes: MsmNote[]
    segment: TempoSegment
    onChange: (newSegment: TempoSegment) => void
    stretchX: number
    stretchY: number
    onClick: MouseEventHandler
}

export const SyntheticLine = ({ notes, segment, stretchX, stretchY, onClick, onChange }: SyntheticLineProps) => {
    const [hovered, setHovered] = useState(false)
    const [tempo, setTempo] = useState<TempoWithEndDate>()

    const { play, stop } = usePiano()
    const { slice } = useNotes()

    const handlePlay = useCallback(() => {
        if (!tempo) return

        const notes = structuredClone(slice(tempo.date, tempo.endDate))
        // TODO: filter by part

        for (const note of notes) {
            note["midi.onset"] = computeMillisecondsAt(note.date, tempo) / 1000
            note["midi.duration"] = computeMillisecondsAt(note.date + note.duration, tempo) / 1000 - note["midi.onset"]
        }

        // emulating a metronome by inserting very high-pitched notes
        for (let i = tempo.date; i <= tempo.endDate; i += (tempo.beatLength * 4 * 720) / 2) {
            notes.push({
                date: i,
                duration: 5,
                'midi.pitch': i === tempo.endDate ? 120 : 127,
                'xml:id': `metronome-${i}`,
                part: 0,
                pitchname: 'C',
                accidentals: 0,
                octave: 4,
                'midi.onset': computeMillisecondsAt(i, tempo) / 1000,
                'midi.duration': 0.01,
                'midi.velocity': 80
            })
        }

        notes.sort((a, b) => a.date - b.date)

        const midi = asMIDI(notes)
        if (midi) {
            stop()
            play(midi, (/*e*/) => {
                // if (e.type === 'meta' && e.subtype === 'text') {
                //     setDatePlayed(+e.text)
                // }
            })
        }
    }, [tempo, play, stop, slice])

    useEffect(() => {
        const firstOnset = notes[0]['midi.onset']
        setTempo(
            approximateTempo(
                notes
                    .map(n => [n.date, (n["midi.onset"] - firstOnset) * 1000] as [number, number])
                    .filter((item, index, self) => self.findIndex(i => i[0] === item[0]) === index),
                segment.startBPM,
                segment.endBPM,
                segment.meanTempoAt,
                segment.beatLength / 4 / 720
            )
        )
    }, [notes, segment])

    if (!tempo) return null

    const step = 20
    const points: TempoPoint[] = []
    for (let i = tempo.date; i <= tempo.endDate; i += step) {
        points.push({
            date: i,
            time: notes[0]['midi.onset'] + (computeMillisecondsAt(i, tempo) / 1000),
            bpm: getTempoAt(i, tempo)
        })
    }

    return (
        <g
            className='syntheticLine'
            onMouseOver={() => setHovered(true)}
            onMouseOut={() => setHovered(false)}
            onClick={onClick}
            onMouseEnter={handlePlay}
            onMouseLeave={stop}
        >
            <CurveHandle
                x={points[0].time * stretchX}
                y={-stretchY * points[0].bpm}
                onDrag={(newY) => {
                    const newBPM = -newY / stretchY
                    onChange({
                        ...segment,
                        startBPM: newBPM
                    })
                }}
            />
            <CurveHandle
                x={points[points.length - 1].time * stretchX}
                y={-stretchY * points[points.length - 1].bpm}
                onDrag={(newY) => {
                    const newBPM = -newY / stretchY
                    onChange({
                        ...segment,
                        endBPM: newBPM
                    })
                }}
            />

            {hovered && (
                <>
                    <text x={points[0].time * stretchX} y={-stretchY * points[0].bpm - 10} fontSize={12}>
                        {tempo.bpm.toFixed(2)}
                    </text>
                    <text x={points[points.length - 1].time * stretchX} y={-stretchY * points[points.length - 1].bpm - 10} fontSize={12}>
                        {tempo["transition.to"]?.toFixed(2)}
                    </text>
                </>
            )}
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