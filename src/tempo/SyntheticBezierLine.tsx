import { BezierCurve } from "mpmify"
import { TempoPoint } from "./TempoDesk"
import { useState } from "react"

interface SyntheticLineProps {
    curve: BezierCurve
    stretchX: number
    stretchY: number
}

export const SyntheticLine = ({ curve, stretchX, stretchY }: SyntheticLineProps) => {
    const [hovered, setHovered] = useState(false)
    // const { play, stop } = usePiano()
    // const { slice } = useNotes()

    /*    const handlePlay = useCallback(() => {
            const notes = structuredClone(slice(curve.date, curve.endDate))
            // TODO: filter by part
    
            for (const note of notes) {
                note["midi.onset"] = computeMillisecondsAt(note.date, curve) / 1000
                note["midi.duration"] = computeMillisecondsAt(note.date + note.duration, curve) / 1000 - note["midi.onset"]
            }
    
            // emulating a metronome by inserting very high-pitched notes
            for (let i = curve.date; i <= curve.endDate; i += (curve.beatLength * 4 * 720) / 2) {
                notes.push({
                    date: i,
                    duration: 5,
                    'midi.pitch': i === curve.endDate ? 120: 127,
                    'xml:id': `metronome-${i}`,
                    part: 0,
                    pitchname: 'C',
                    accidentals: 0,
                    octave: 4,
                    'midi.onset': computeMillisecondsAt(i, curve) / 1000,
                    'midi.duration': 0.01,
                    'midi.velocity': 80
                })
            }
    
            notes.sort((a, b) => a.date - b.date)
    
            const midi = asMIDI(notes)
            if (midi) {
                stop()
                play(midi, () => {
                    // if (e.type === 'meta' && e.subtype === 'text') {
                    //     setDatePlayed(+e.text)
                    // }
                })
            }
        }, [curve, play, stop, slice])*/

    const tempoCurve = (t: number) => (60000 * (curve.P2[0] - curve.P0[0])) / (curve.derivative.y(t) * 0.25 * 4 * 720)
    const step = 0.01
    const points: TempoPoint[] = []
    for (let t = 0; t < 1; t += step) {
        points.push({
            date: curve.x(t),
            time: curve.y(t) / 1000,
            bpm: tempoCurve(t)
        })
    }

    // console.log('points', points)

    return (
        <g
            className='syntheticLine'
            onMouseOver={() => setHovered(true)}
            onMouseOut={() => setHovered(false)}
            onClick={/*handlePlay*/ () => { }}
        >
            {/*hovered && (
                <>
                    <text x={points[0].time * stretchX} y={-stretchY * points[0].bpm - 10} fontSize={12}>
                        {curve.bpm}
                    </text>
                    <text x={points[points.length - 1].time * stretchX} y={-stretchY * points[points.length - 1].bpm - 10} fontSize={12}>
                        {curve["transition.to"]}
                    </text>
                </>
            )*/}
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