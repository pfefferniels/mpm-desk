import { ChordMap } from "mpmify/lib/msm"
import { Frame as FrameData } from "mpmify/lib/transformers"
import { asMIDI, PartialBy } from "../utils/utils"
import { usePiano } from "react-pianosound"
import { useNotes } from "../hooks/NotesProvider"
import { useState } from "react"
import { Frame } from "./Frame"

interface DatesRowProps {
    stretchX: number
    height: number
    width: number
    chords: ChordMap
    frames: PartialBy<FrameData, 'length'>[]
    setFrames: React.Dispatch<React.SetStateAction<PartialBy<FrameData, 'length'>[]>>
}

export const DatesRow = ({ stretchX, height, width, chords, frames, setFrames }: DatesRowProps) => {
    const { play, stop } = usePiano()
    const { slice } = useNotes()

    const [hovered, setHovered] = useState<number>()

    const dates = []

    const playFrame = (frame: FrameData) => {
        const notes = slice(frame.date, frame.date + frame.length)
        const midi = asMIDI(notes)
        if (!midi) return

        stop()
        play(midi)
    }

    const handleMouseOver = (date: number) => {
        setHovered(date)
        const notes = slice(date, date + 1)
        const midi = asMIDI(notes)
        if (midi) {
            stop()
            play(midi)
        }
    }

    const handleMouseOut = () => {
        setHovered(undefined)
        stop()
    }

    const addMarker = (date: number) => {
        const last = frames.at(-1)
        if (!last || last.length) {
            frames.push({ date })
        }
        else {
            last.length = date - last.date
        }
        setFrames([...frames])
    }

    for (const [date, notes] of chords) {
        dates.push((
            <line
                data-date={date}
                className='shouldTick'
                strokeWidth={hovered === date ? 3 : 1.5}
                stroke='black'
                x1={date * stretchX}
                x2={date * stretchX}
                y1={-10}
                y2={height + 10}
                key={`shouldTick_${date}`}
                onMouseOver={() => handleMouseOver(date)}
                onMouseOut={handleMouseOut}
                strokeDasharray={'5 5'}
            />
        ))

        for (const note of notes) {
            if (note.tickDate === undefined) continue

            dates.push((
                <line
                    key={`tickShift_${note["xml:id"]}`}
                    data-date={date}
                    data-tickDate={note.tickDate}
                    stroke='blue'
                    strokeWidth={hovered === date ? 3 : 1.5}
                    x1={note.tickDate * stretchX}
                    x2={note.tickDate * stretchX}
                    y1={0}
                    y2={height}
                    onMouseOver={() => handleMouseOver(date)}
                    onMouseOut={handleMouseOut}
                    onClick={() => addMarker(date)}
                />
            ))
        }
    }

    console.log(frames)

    const boxes = frames.map(frame => {
        return (
            <Frame
                key={`frame_${frame.date}_${frame.length}`}
                frame={frame}
                stretchX={stretchX}
                height={height}
                onRemove={() => setFrames(prev => {
                    const index = prev.indexOf(frame)
                    if (index !== -1) prev.splice(index, 1)
                    return [...prev]
                })}
                onClick={() => {
                    if (frame.length) playFrame(frame as FrameData)
                }}
            />
        )
    })

    return (
        <g>
            <line
                stroke='black'
                strokeWidth={1}
                x1={0}
                x2={width}
                y1={0}
                y2={0} />
            <line
                stroke='black'
                strokeWidth={1}
                x1={0}
                x2={width}
                y1={height}
                y2={height} />

            {boxes}
            {dates}
        </g>
    )
}