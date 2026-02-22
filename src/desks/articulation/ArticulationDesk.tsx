
import { Button } from "@mui/material"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { usePiano } from "react-pianosound"
import { useNotes } from "../../hooks/NotesProvider"
import { MouseEventHandler, SVGProps, useCallback, useState } from "react"
import { asMIDI } from "../../utils/utils"
import { ArticulationProperty, InsertArticulation, MakeDefaultArticulation, MsmNote } from "mpmify"
import { Articulation, ArticulationDef } from "../../../../mpm-ts/lib"
import { v4 } from "uuid"
import { UnitDialog } from "./UnitDialog"
import { useSymbolicZoom } from "../../hooks/ZoomProvider"
import { useScrollSync } from "../../hooks/ScrollSyncProvider"
import { useSelection } from "../../hooks/SelectionProvider"
import { Ribbon } from "../../components/Ribbon"
import { createPortal } from "react-dom"
import { Add } from "@mui/icons-material"
import { ArticulationOverlay } from "./ArticulationOverlay"

interface ArticulatedNoteProps extends SVGProps<SVGRectElement> {
    note: MsmNote
    stretchX: number
    stretchY: number

    selected: boolean
    onClick: MouseEventHandler
}

const ArticulatedNote = ({ note, stretchX, stretchY, onClick, selected, ...svgProps }: ArticulatedNoteProps) => {
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

    const max = 90 // 127

    return (
        <g onClick={onClick}>
            <rect
                data-date={note.date}
                x={isOnset * stretchX}
                y={(max - note["midi.pitch"]) * stretchY - (((note.absoluteVelocityChange || 1) + 2) * (hovered ? 2 : 1)) / 2}
                width={Math.max(1, ((isOnset + isDuration) * stretchX) - (isOnset * stretchX))}
                height={((note.absoluteVelocityChange || 1) + 2) * (hovered ? 2 : 1)}
                rx={2}
                ry={2}
                onMouseOver={handleMouseOver}
                onMouseOut={handleMouseOut}
                key={`accentuation_${note.part}_${note["xml:id"]}`}
                strokeWidth={selected ? 2 : 0}
                stroke='black'
                {...svgProps}
            />

            <line
                strokeWidth={hovered ? 1.2 : 0.8}
                stroke='black'
                x1={(isOnset + isDuration) * stretchX}
                x2={(isOnset + isDuration) * stretchX}
                y1={(max - note["midi.pitch"]) * stretchY - 2}
                y2={(max - note["midi.pitch"]) * stretchY + 2}
                onMouseOver={handleMouseOver}
                onMouseOut={handleMouseOut}
            />
            <line
                strokeWidth={hovered ? 1.2 : 0.8}
                stroke='black'
                x1={(isOnset + shouldDuration) * stretchX}
                x2={(isOnset + shouldDuration) * stretchX}
                y1={(max - note["midi.pitch"]) * stretchY - 7}
                y2={(max - note["midi.pitch"]) * stretchY + 7}
                onMouseOver={handleMouseOver}
                onMouseOut={handleMouseOut}
                strokeDasharray='1 1'
            />

            {hovered && (
                <text
                    x={isOnset * stretchX + 2}
                    y={(max - note["midi.pitch"]) * stretchY - 13}
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

export const ArticulationDesk = ({ msm, mpm, part, addTransformer, appBarRef }: ScopedTransformerViewProps<InsertArticulation | MakeDefaultArticulation>) => {
    const { activeElements, setActiveElement } = useSelection();
    const { register, unregister } = useScrollSync();
    const [currentUnit, setCurrentUnit] = useState<UnitWithDef>()
    const [unitDialogOpen, setUnitDialogOpen] = useState(false)

    const scrollContainerRef = useCallback((element: HTMLDivElement | null) => {
        if (element) {
            register('articulation-desk', element, 'symbolic');
        } else {
            unregister('articulation-desk');
        }
    }, [register, unregister]);

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

    const artics = mpm.getInstructions<Articulation>('articulation', part)

    const articulatedNotes = []
    for (const [, notes] of msm.asChords(part)) {
        for (const note of notes) {
            const effectiveArtic = artics.find(a => {
                return a.noteid?.split(' ').includes(`#${note["xml:id"]}`)
            })

            const active = effectiveArtic && activeElements.includes(effectiveArtic["xml:id"]) || false

            articulatedNotes.push((
                <ArticulatedNote
                    key={`articulatedNote_${note["xml:id"]}`}
                    note={note}
                    stretchX={stretchX}
                    stretchY={stretchY}
                    selected={currentUnit?.notes.includes(note) || false}
                    fill={active ? 'red' : effectiveArtic ? 'orange' : 'gray'}
                    onClick={(e) => {
                        if (effectiveArtic) {
                            setActiveElement(effectiveArtic["xml:id"])
                            return
                        }

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

    const allNotes = msm.notesInPart(part)

    const overlays = artics.map(artic => {
        const def = artic["name.ref"] ? mpm.getDefinition('articulationDef', artic["name.ref"]) as ArticulationDef | null : null
        return (
            <ArticulationOverlay
                key={`overlay_${artic["xml:id"]}`}
                instruction={artic}
                def={def ?? undefined}
                notes={allNotes}
                stretchX={stretchX}
                stretchY={stretchY}
                active={activeElements.includes(artic["xml:id"])}
                onClick={() => setActiveElement(artic["xml:id"])}
            />
        )
    })

    return (
        <div ref={scrollContainerRef} style={{ width: '100vw', overflow: 'scroll', position: 'relative' }}>
            {appBarRef && createPortal((
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
            ), appBarRef?.current ?? document.body)}

            <svg width={msm.end * stretchX} height={900}>
                {overlays}
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
