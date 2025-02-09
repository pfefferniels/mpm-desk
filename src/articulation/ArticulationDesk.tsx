
import { Button, Stack } from "@mui/material"
import { ScopedTransformerViewProps } from "../DeskSwitch"
import { usePiano } from "react-pianosound"
import { useNotes } from "../hooks/NotesProvider"
import { MsmNote } from "mpmify/lib/msm"
import { useState } from "react"
import { asMIDI } from "../utils"
import { InsertRelativeDuration } from "mpmify"

interface ArticulatedNoteProps {
    note: MsmNote
    stretchX: number
    stretchY: number

    selected: boolean
    onClick: (id: string) => void
}

const ArticulatedNote = ({ note, stretchX, stretchY, selected, onClick }: ArticulatedNoteProps) => {
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
            <rect
                data-date={note.date}
                stroke='black'
                strokeWidth={selected ? 2 : 0.2}
                fill='gray'
                fillOpacity={hovered ? 1 : 0.8}
                x={isOnset * stretchX}
                width={shouldDuration * stretchX}
                y={(127 - note["midi.pitch"]) * stretchY - 2}
                height={4}
                key={`articulatedNote_${note.part}_${note["xml:id"]}`}
                onMouseOver={handleMouseOver}
                onMouseOut={handleMouseOut}
                onClick={() => onClick(note["xml:id"])}
            />
            <line
                data-date={note.date}
                strokeWidth={hovered ? 2 : 1}
                stroke='black'
                strokeOpacity={hovered ? 1 : 0.8}
                x1={isOnset * stretchX}
                x2={(isOnset + isDuration) * stretchX}
                y1={(127 - note["midi.pitch"]) * stretchY}
                y2={(127 - note["midi.pitch"]) * stretchY}
                key={`accentuation_${note.part}_${note["xml:id"]}`}
                onMouseOver={handleMouseOver}
                onMouseOut={handleMouseOut}
            />
            <line
                strokeWidth={hovered ? 1.2 : 0.8}
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

export const ArticulationDesk = ({ msm, mpm, setMSM, setMPM, part }: ScopedTransformerViewProps) => {
    const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set())

    const insert = () => {
        const insertArticulation = new InsertRelativeDuration({
            scope: part,
            noteIDs: selectedNotes.size === 0 ? undefined : [...selectedNotes]
        })

        mpm.removeInstructions('articulation', part)
        insertArticulation.transform(msm, mpm)
        insertArticulation.insertMetadata(mpm)

        setMSM(msm.clone())
        setMPM(mpm.clone())
    }

    const stretchX = 0.08
    const stretchY = 8

    const articulatedNotes = []
    for (const [, notes] of msm.asChords(part)) {
        for (const note of notes) {
            articulatedNotes.push((
                <ArticulatedNote
                    key={`articulatedNote_${note["xml:id"]}`}
                    note={note}
                    stretchX={stretchX}
                    stretchY={stretchY}
                    selected={selectedNotes.has(note["xml:id"])}
                    onClick={(id) => {
                        setSelectedNotes(prev => {
                            if (prev.has(id)) prev.delete(id)
                            else prev.add(id)
                            return new Set([...prev])
                        })
                    }}
                />
            ))
        }
    }

    return (
        <div style={{ width: '80vw', overflow: 'scroll' }}>
            <Stack
                spacing={1}
                direction='row'
            >
                <Button
                    variant='contained'
                    onClick={insert}
                >
                    Insert into MPM
                </Button>
            </Stack>

            <svg width={10000} height={900}>
                {articulatedNotes}
            </svg>
        </div>
    )
}
