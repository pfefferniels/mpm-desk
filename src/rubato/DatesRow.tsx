import { ChordMap } from "mpmify/lib/msm"
import { InsertRubatoOptions } from "mpmify/lib/transformers"
import { asMIDI, PartialBy } from "../utils/utils"
import { usePiano } from "react-pianosound"
import { useNotes } from "../hooks/NotesProvider"
import { useState } from "react"
import { Frame } from "./Frame"

export type Frame = PartialBy<Omit<InsertRubatoOptions, 'scope'>, 'length'>

interface DatesRowProps {
    stretchX: number
    height: number
    width: number
    chords: ChordMap
    frame?: Frame
    setFrame: React.Dispatch<React.SetStateAction<Frame | undefined>>
}

export const DatesRow = ({ stretchX, height, width, chords, frame, setFrame }: DatesRowProps) => {
    const { play, stop } = usePiano()
    const { slice } = useNotes()

    const [hovered, setHovered] = useState<number>()

    const dates = []

    const playFrame = (frame: Frame) => {
        if (!frame.length) return
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
        console.log('add marker', date)
        setFrame(prev => {
            console.log('prev', prev)
            if (!prev) return { date }
            if (!prev.length) {
                prev.length = date - prev.date
            }
            else {
                prev.date = date
            }
            return { ...prev }
        })
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

    const boxes = frame && (
        <Frame
            key={`frame_${frame.date}_${frame.length}`}
            frame={frame}
            stretchX={stretchX}
            height={height}
            onRemove={() => {
                // ...                
            }}
            onClick={() => {
                if (frame.length) playFrame(frame)
            }}
        />
    )

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