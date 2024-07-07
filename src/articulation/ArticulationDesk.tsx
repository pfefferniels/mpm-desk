
import { Button, Stack } from "@mui/material"
import { ScopedTransformerViewProps } from "../DeskSwitch"
import { Part } from "../../../mpm-ts/lib"
import { usePiano } from "react-pianosound"
import { useNotes } from "../hooks/NotesProvider"
import { MsmNote } from "mpmify/lib/msm"
import { useState } from "react"
import { asMIDI, numberToColor } from "../utils"

interface ArticulatedNoteProps {
    note: MsmNote
    stretchX: number
    stretchY: number
}

const ArticulatedNote = ({ note, stretchX, stretchY }: ArticulatedNoteProps) => {
    const { play, stop } = usePiano()
    const { slice } = useNotes()

    const [hovered, setHovered] = useState(false)

    if (note.relativeVolume === undefined) return null

    const isOnset = note.date
    const isDuration = note.tickDuration || note["midi.duration"]
    const shouldDuration = note.duration

    const handleMouseOver = () => {
        setHovered(true)
        const notes = slice(note.date, note.date + 1)
        const midi = asMIDI(notes)
        if (midi) {
            stop()
            play(midi)
        }
    }

    const handleMouseOut = () => {
        setHovered(false)
        stop()
    }

    return (
        <>
            <line
                data-date={note.date}
                strokeWidth={2.5}
                stroke={numberToColor(note.relativeVolume, { start: -5, end: 5 })}
                strokeOpacity={hovered ? 1 : 0.8}
                x1={isOnset * stretchX}
                x2={(isOnset + shouldDuration) * stretchX}
                y1={(127 - note["midi.pitch"]) * stretchY}
                y2={(127 - note["midi.pitch"]) * stretchY}
                key={`accentuation_${note["xml:id"]}`}
                onMouseOver={handleMouseOver}
                onMouseOut={handleMouseOut}
            />
            <line
                data-date={note.date}
                strokeWidth={0.5}
                stroke='black'
                strokeOpacity={hovered ? 1 : 0.8}
                x1={isOnset * stretchX}
                x2={(isOnset + isDuration) * stretchX}
                y1={(127 - note["midi.pitch"]) * stretchY}
                y2={(127 - note["midi.pitch"]) * stretchY}
                key={`accentuation_${note["xml:id"]}`}
                onMouseOver={handleMouseOver}
                onMouseOut={handleMouseOut}
            />
            <line
                strokeWidth={0.2}
                stroke='black'
                x1={(isOnset + isDuration) * stretchX}
                x2={(isOnset + isDuration) * stretchX}
                y1={(127 - note["midi.pitch"]) * stretchY - 2}
                y2={(127 - note["midi.pitch"]) * stretchY + 2}
                onMouseOver={handleMouseOver}
                onMouseOut={handleMouseOut}
            />
        </>
    )
}

export const ArticulationDesk = ({ msm, part }: ScopedTransformerViewProps) => {
    const stretchX = 0.04
    const stretchY = 5

    const centerLineY = 20

    const volumes = []
    for (const [, notes] of msm.asChords(part as Part)) {
        for (const note of notes) {
            volumes.push((
                <ArticulatedNote
                    key={`articulatedNote_${note["xml:id"]}`}
                    note={note}
                    stretchX={stretchX}
                    stretchY={stretchY}
                />
            ))
        }
    }
    return (
        <div style={{ width: '80vw', overflow: 'scroll' }}>
            <Stack spacing={1} direction='row'>
                <Button>Insert into MPM</Button>
            </Stack>

            <svg width={10000} height={600}>
                <line
                    stroke='black'
                    strokeWidth={1}
                    x1={0}
                    x2={10000}
                    y1={centerLineY * stretchY}
                    y2={centerLineY * stretchY} />
                {volumes}
            </svg>
        </div>
    )
}
