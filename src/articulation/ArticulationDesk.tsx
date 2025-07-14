
import { Button } from "@mui/material"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { usePiano } from "react-pianosound"
import { useNotes } from "../hooks/NotesProvider"
import { MsmNote } from "mpmify/lib/msm"
import { MouseEventHandler, useState } from "react"
import { asMIDI } from "../utils/utils"
import { ArticulationProperty, InsertArticulation, MakeDefaultArticulation, MergeArticulations } from "mpmify"
import { ArticulationDef } from "../../../mpm-ts/lib"
import { v4 } from "uuid"
import { UnitDialog } from "./UnitDialog"
import { useSymbolicZoom } from "../hooks/ZoomProvider"
import { Ribbon } from "../Ribbon"
import { createPortal } from "react-dom"
import { Add } from "@mui/icons-material"

interface ArticulatedNoteProps {
    note: MsmNote
    stretchX: number
    stretchY: number

    selected: boolean
    onClick: MouseEventHandler
}

const ArticulatedNote = ({ note, stretchX, stretchY, onClick, selected }: ArticulatedNoteProps) => {
    const { play, stop } = usePiano()
    const { slice } = useNotes()

    const [hovered, setHovered] = useState(false)

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
        <g onClick={onClick}>
            <line
                data-date={note.date}
                strokeWidth={((note.absoluteVelocityChange || 1) + 2) * (hovered ? 2 : 1)}
                stroke='black'
                strokeOpacity={(hovered || selected) ? 1 : 0.4}
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
            <line
                strokeWidth={hovered ? 1.2 : 0.8}
                stroke='black'
                x1={(isOnset + shouldDuration) * stretchX}
                x2={(isOnset + shouldDuration) * stretchX}
                y1={(127 - note["midi.pitch"]) * stretchY - 7}
                y2={(127 - note["midi.pitch"]) * stretchY + 7}
                onMouseOver={handleMouseOver}
                onMouseOut={handleMouseOut}
                strokeDasharray='1 1'
            />

            {hovered && (
                <text
                    x={isOnset * stretchX + 2}
                    y={(127 - note["midi.pitch"]) * stretchY - 13}
                    fontSize={10}
                    fill="black"
                >
                    {note.date}
                </text>
            )}
        </g>
    )
}

export type UnitWithDef = {
    notes: MsmNote[]
    aspects: Set<ArticulationProperty>
    name: string
    def?: ArticulationDef
}

export const ArticulationDesk = ({ msm, part, addTransformer, appBarRef }: ScopedTransformerViewProps<InsertArticulation | MakeDefaultArticulation | MergeArticulations>) => {
    const [currentUnit, setCurrentUnit] = useState<UnitWithDef>()
    const [unitDialogOpen, setUnitDialogOpen] = useState(false)

    const insert = (unit: UnitWithDef) => {
        addTransformer(new InsertArticulation({
            scope: part,
            noteIDs: unit.notes.map(n => n["xml:id"]),
            aspects: unit.aspects,
            name: unit.name
        }))
    }

    const makeDefault = () => {
        addTransformer(new MakeDefaultArticulation({
            scope: part
        }))
    }

    const stretchX = useSymbolicZoom()
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
                    selected={currentUnit?.notes.includes(note) || false}
                    onClick={(e) => {
                        if ((e.metaKey || e.shiftKey) && currentUnit !== undefined) {
                            if (currentUnit.notes.includes(note)) {
                                const shrunk = {
                                    ...currentUnit,
                                    notes: currentUnit.notes.filter(n => n !== note)
                                }

                                setCurrentUnit(shrunk)
                            }
                            else {
                                const expanded = {
                                    ...currentUnit,
                                    notes: [...currentUnit.notes, note]
                                }

                                setCurrentUnit(expanded)
                            }
                        }
                        else {
                            const newUnit: UnitWithDef = {
                                notes: [note],
                                aspects: new Set(),
                                name: v4()
                            }
                            setCurrentUnit(newUnit)
                        }
                    }}
                />
            ))
        }
    }

    return (
        <div style={{ width: '80vw', overflow: 'scroll', position: 'relative' }}>
            {createPortal((
                <Ribbon title="Articulation">
                    {currentUnit && (
                        <>
                            <Button
                                size='small'
                                variant='outlined'
                                onClick={() => setUnitDialogOpen(true)}
                                startIcon={<Add />}
                            >
                                Insert
                            </Button>
                            <Button
                                size='small'
                                variant='outlined'
                                onClick={() => {
                                    setCurrentUnit(undefined)
                                }}
                            >
                                Clear Unit
                            </Button>
                        </>
                    )}
                    <Button
                        size='small'
                        variant='outlined'
                        onClick={makeDefault}
                        startIcon={<Add />}
                    >
                        Insert Default
                    </Button>
                </Ribbon>
            ), appBarRef.current || document.body)}

            <svg width={10000} height={900}>
                {articulatedNotes}
            </svg>

            {(unitDialogOpen && currentUnit) && (
                <UnitDialog
                    open={unitDialogOpen}
                    onClose={() => setUnitDialogOpen(false)}
                    unit={currentUnit}
                    onDone={(unit) => {
                        insert(unit)
                        setUnitDialogOpen(false)
                        setCurrentUnit(undefined)
                    }}
                />
            )}
        </div>
    )
}
