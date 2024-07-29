
import { Button, Stack } from "@mui/material"
import { ScopedTransformerViewProps } from "../DeskSwitch"
import { MouseEventHandler, useState } from "react"
import { usePiano } from "react-pianosound"
import { useNotes } from "../hooks/NotesProvider"
import { asMIDI, PartialBy } from "../utils"
import { Frame as FrameData, InterpolateRubato } from "mpmify/lib/transformers"

interface FrameProps {
    frame: PartialBy<FrameData, 'length'>
    stretchX: number
    stretchY: number
    centerLineY: number
    height: number
    onRemove: () => void
    onClick: MouseEventHandler
}

const Frame = ({ frame, stretchX, stretchY, centerLineY, height, onRemove, onClick }: FrameProps) => {
    return (
        <rect
            x={frame.date * stretchX}
            y={(centerLineY - height) * stretchY}
            width={(frame.length || 0) * stretchX}
            height={height * 2 * stretchY}
            strokeWidth={2}
            stroke='black'
            fill='gray'
            fillOpacity={0.2}
            onClick={(e) => {
                if (e.altKey && e.shiftKey) onRemove()
                else onClick(e)
            }}
        />
    )
}

export const RubatoDesk = ({ msm, mpm, setMSM, setMPM, part }: ScopedTransformerViewProps) => {
    const { play, stop } = usePiano()
    const { slice } = useNotes()

    const [hovered, setHovered] = useState<number>()
    const [frames, setFrames] = useState<PartialBy<FrameData, 'length'>[]>([])

    const stretchX = 0.06
    const stretchY = 5
    const centerLineY = 50
    const height = 10

    const dates = []

    const handleInsert = () => {
        const insert = new InterpolateRubato({
            part,
            frames: frames.filter(f => f.length !== undefined) as FrameData[]
        })

        insert.transform(msm, mpm)

        setMSM(msm.clone())
        setMPM(mpm.clone())
    }



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

    for (const [date, notes] of msm.asChords(part)) {
        dates.push((
            <line
                data-date={date}
                className='shouldTick'
                strokeWidth={hovered === date ? 3 : 1.5}
                stroke='black'
                x1={date * stretchX}
                x2={date * stretchX}
                y1={centerLineY * stretchY}
                y2={(centerLineY + height) * stretchY}
                key={`shouldTick_${date}`}
                onMouseOver={() => handleMouseOver(date)}
                onMouseOut={handleMouseOut}
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
                    y1={centerLineY * stretchY}
                    y2={(centerLineY - height) * stretchY}
                    onMouseOver={() => handleMouseOver(date)}
                    onMouseOut={handleMouseOut}
                    onClick={() => addMarker(date)}
                />
            ))
        }
    }

    const boxes = frames.map(frame => {
        return (
            <Frame
                key={`frame_${frame.date}_${frame.length}`}
                frame={frame}
                stretchX={stretchX}
                stretchY={stretchY}
                centerLineY={centerLineY}
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
        <div style={{ width: '80vw', overflow: 'scroll' }}>
            <Stack spacing={1} direction='row'>
                <Button variant='contained' onClick={handleInsert}>Insert into MPM</Button>
            </Stack>

            <svg width={10000} height={600}>
                <line
                    stroke='black'
                    strokeWidth={1}
                    x1={0}
                    x2={10000}
                    y1={centerLineY * stretchY}
                    y2={centerLineY * stretchY} />
                {boxes}
                {dates}
            </svg>
        </div>
    )
}
