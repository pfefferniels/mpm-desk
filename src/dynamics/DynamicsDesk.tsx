import { useEffect, useState } from "react";
import { Part } from "../../../mpm-ts/lib";
import { usePiano } from "react-pianosound";
import { useNotes } from "../hooks/NotesProvider";
import { asMIDI } from "../utils";
import { Scope, ScopedTransformerViewProps } from "../DeskSwitch";
import { MSM, MsmNote } from "mpmify/lib/msm";
import { expandRange, Range } from "../tempo/Tempo";

interface DynamicsSegment {
    date: Range
    velocity: number
    active: boolean
}

const extractDynamicsSegments = (msm: MSM, part: Scope) => {
    const segments: DynamicsSegment[] = []
    msm.asChords(part as Part).forEach((notes, date) => {
        if (!notes.length) return

        for (const note of notes) {
            if (segments.findIndex(s => s.date.start === date && s.velocity === note['midi.velocity']) !== -1) continue
            segments.push({
                date: {
                    start: date,
                    end: date
                },
                velocity: note['midi.velocity'],
                active: false
            })
        }
    })

    return segments
}

export const DynamicsDesk = ({ part, msm }: ScopedTransformerViewProps) => {
    const { play, stop } = usePiano()
    const { slice } = useNotes()

    const [datePlayed, setDatePlayed] = useState<number>()
    const [segments, setSegments] = useState<DynamicsSegment[]>([])

    const stretchY = 5
    const stretchX = 0.03
    const margin = 10

    useEffect(() => setSegments(extractDynamicsSegments(msm, part)), [msm, part])

    const handlePlay = (from: number, to?: number) => {
        let notes =
            slice(from, to).map(n => {
                const partial: Partial<MsmNote> = { ...n }
                delete partial['midi.onset']
                delete partial['midi.duration']
                return partial as Omit<MsmNote, 'midi.onset' | 'midi.duration'>
            })

        if (typeof part === 'number') notes = notes.filter(n => n.part - 1 === part)
        const midi = asMIDI(notes)
        if (midi) {
            stop()
            play(midi, (e) => {
                if (e.type === 'meta' && e.subtype === 'text') {
                    setDatePlayed(+e.text)
                }
            })
        }
    }

    const handleClick = (e: MouseEvent, segment: DynamicsSegment) => {
        if (e.altKey && e.shiftKey) {
            const index = segments.indexOf(segment)
            if (index !== -1) {
                segments.splice(index, 1)
                setSegments([...segments])
            }
        }
        if (e.shiftKey) {
            const active = segments.find(s => s.active)
            if (!active) return
            active.date = expandRange(active.date, segment.date)
            active.velocity = (active.velocity + segment.velocity) / 2
            setSegments([...segments])
        }
        else {
            const active = segments.find(s => s.active)
            if (active) active.active = false

            setSegments([...segments, {
                date: {
                    start: segment.date.start,
                    end: segment.date.end
                },
                velocity: segment.velocity,
                active: true
            }])
        }
    }

    const circles: JSX.Element[] = segments.map((segment, i) => {
        if (segment.date.start === segment.date.end) {
            return (
                <circle
                    cx={segment.date.start * stretchX + margin}
                    cy={350 - segment.velocity * stretchY}
                    key={`velocity_segment_${segment.date}_${i}`}
                    r={3}
                    fill={datePlayed === segment.date.start ? 'blue' : 'black'}
                    fillOpacity={0.4}
                    stroke={'black'}
                    strokeWidth={segment.active ? 3 : 1}
                    onMouseOver={() => handlePlay(segment.date.start, segment.date.start + 1)}
                    onClick={(e) => {
                        handlePlay(segment.date.start)
                        handleClick(e as unknown as MouseEvent, segment)
                    }} />
            )
        }
        else {
            return (
                <line
                    x1={segment.date.start * stretchX + margin}
                    x2={segment.date.end * stretchX + margin}
                    y1={350 - segment.velocity * stretchY}
                    y2={350 - segment.velocity * stretchY}
                    stroke={'black'}
                    strokeWidth={segment.active ? 3 : 1}
                    key={`velocity_segment_${segment.date}_${i}`}
                    fill='black'
                    onClick={(e) => {
                        handleClick(e as unknown as MouseEvent, segment)
                    }} />
            )
        }
    })

    return (
        <div>
            {part !== 'global' && <div>Part {part + 1}</div>}
            <svg width={1000} height={300}>
                {circles}
            </svg>
        </div>
    )
}

