import { approximateTempo, computeMillisecondsAt, computeTotalError, getTempoAt, Point, TempoSegment, TempoWithEndDate } from "mpmify"
import { TempoPoint } from "./TempoDesk"
import { MouseEventHandler, useCallback, useEffect, useRef, useState } from "react"
import { usePiano } from "react-pianosound"
import { useNotes } from "../hooks/NotesProvider"
import { asMIDI } from "../utils/utils"
import { CurveHandle } from "./CurveHandle"

interface SyntheticLineProps {
    points: Point[]
    startTime: number
    segment: TempoSegment
    onChange: (newSegment: TempoSegment) => void
    stretchX: number
    stretchY: number
    chartHeight: number
    onClick: MouseEventHandler
    active: boolean
}

export const SyntheticLine = ({ points, startTime, segment, stretchX, stretchY, chartHeight, onClick, onChange, active }: SyntheticLineProps) => {
    const [hovered, setHovered] = useState(false)
    const [tempo, setTempo] = useState<TempoWithEndDate>()
    const [flashKey, setFlashKey] = useState(0)
    const prevActive = useRef(false)

    useEffect(() => {
        if (active && !prevActive.current) {
            setFlashKey(k => k + 1)
        }
        prevActive.current = active
    }, [active])

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
        if (points.length <= 1) return

        setTempo(
            approximateTempo(
                points,
                segment.startBPM,
                segment.endBPM,
                segment.meanTempoAt,
                segment.beatLength
            )
        )
    }, [points, segment])

    if (!tempo) return null

    const step = 20
    const curvePoints: TempoPoint[] = []
    for (let i = tempo.date; i <= tempo.endDate; i += step) {
        curvePoints.push({
            date: i,
            time: startTime + (computeMillisecondsAt(i, tempo)) / 1000,
            bpm: getTempoAt(i, tempo)
        })
    }

    if (curvePoints.length === 0) return null
    if (points.length === 0) return null

    const meanTempoDate = (tempo.endDate - tempo.date) * (tempo.meanTempoAt || 0.5)
    const meanTempoMs = (points[0][0] * 1000) + computeMillisecondsAt(tempo.date + meanTempoDate, tempo)
    const meanTempo = (tempo["transition.to"] || tempo.bpm) + 0.5 * (tempo.bpm - (tempo["transition.to"] || tempo.bpm))

    const totalError = computeTotalError(tempo, points)
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
    const t = clamp((totalError - 200) / (1000 - 200), 0, 1)
    const hue = (1 - t) * 120  // 120 => green, 0 => red
    const color = `hsl(${hue}, 85%, 30%)`

    return (
        <g
            className='syntheticLine'
            onMouseOver={() => setHovered(true)}
            onMouseOut={() => setHovered(false)}
            onClick={onClick}
            onMouseEnter={handlePlay}
            onMouseLeave={stop}
        >
            {hovered && (
                <>
                    <text x={curvePoints[0].time * stretchX} y={-stretchY * curvePoints[0].bpm - 10} fontSize={12}>
                        {tempo.bpm.toFixed(2)}
                    </text>
                    <text x={curvePoints[curvePoints.length - 1].time * stretchX} y={-stretchY * curvePoints[curvePoints.length - 1].bpm - 10} fontSize={12}>
                        {tempo["transition.to"]?.toFixed(2)}
                    </text>

                    <circle
                        cx={(meanTempoMs / 1000) * stretchX}
                        cy={meanTempo * -stretchY}
                        r={5}
                        fill="lightcoral"
                    />

                    {tempo.meanTempoAt && (
                        <text
                            x={(meanTempoMs / 1000) * stretchX}
                            y={meanTempo * -stretchY - 10}
                            fontSize={12}
                        >
                            {tempo.meanTempoAt.toFixed(2)}
                        </text>
                    )}
                </>
            )}

            {flashKey > 0 && (
                <rect
                    key={`flash_${flashKey}`}
                    x={curvePoints[0].time * stretchX}
                    y={chartHeight}
                    width={(curvePoints[curvePoints.length - 1].time - curvePoints[0].time) * stretchX}
                    height={-chartHeight}
                    fill="steelblue"
                    pointerEvents="none"
                    style={{
                        animation: 'tempo-highlight-fade 3.5s ease-out forwards',
                    }}
                />
            )}

            <polyline
                points={curvePoints.map(p => `${p.time * stretchX},${p.bpm * -stretchY}`).join(' ')}
                fill="none"
                strokeWidth={hovered ? 3 : 2}
                stroke={color}
                strokeOpacity={hovered ? 1 : 0.7}
            />

            <style>{`
                @keyframes tempo-highlight-fade {
                    from { opacity: 0.2; }
                    to { opacity: 0; }
                }
            `}</style>

            <CurveHandle
                x={curvePoints[0].time * stretchX}
                y={-stretchY * curvePoints[0].bpm}
                onDrag={(newY) => {
                    const newBPM = -newY / stretchY
                    onChange({
                        ...segment,
                        startBPM: newBPM
                    })
                }}
            />
            <CurveHandle
                x={curvePoints[curvePoints.length - 1].time * stretchX}
                y={-stretchY * curvePoints[curvePoints.length - 1].bpm}
                onDrag={(newY) => {
                    const newBPM = -newY / stretchY
                    onChange({
                        ...segment,
                        endBPM: newBPM
                    })
                }}
            />
        </g>
    )
}