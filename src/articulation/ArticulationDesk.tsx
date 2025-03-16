
import { Box, Button, Checkbox, IconButton, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Stack } from "@mui/material"
import { ScopedTransformerViewProps } from "../DeskSwitch"
import { usePiano } from "react-pianosound"
import { useNotes } from "../hooks/NotesProvider"
import { MsmNote } from "mpmify/lib/msm"
import { MouseEventHandler, useEffect, useState } from "react"
import { asMIDI } from "../utils/utils"
import { ArticulationProperty, InsertArticulation, MakeDefaultArticulation, MergeArticulations } from "mpmify"
import { ArticulationDef } from "../../../mpm-ts/lib"
import { v4 } from "uuid"
import { Edit } from "@mui/icons-material"
import { UnitDialog } from "./UnitDialog"

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

export const ArticulationDesk = ({ msm, mpm, part, activeTransformer, addTransformer }: ScopedTransformerViewProps<InsertArticulation | MakeDefaultArticulation | MergeArticulations>) => {
    const [units, setUnits] = useState<UnitWithDef[]>([])
    const [currentUnit, setCurrentUnit] = useState<UnitWithDef>()
    const [checked, setChecked] = useState<number[]>([]);
    const [unitDialogOpen, setUnitDialogOpen] = useState(false)

    const handleToggle = (index: number) => {
        const currentIndex = checked.indexOf(index);
        const newChecked = [...checked];

        if (currentIndex === -1) {
            newChecked.push(index);
        } else {
            newChecked.splice(currentIndex, 1);
        }

        setChecked(newChecked);
    };

    console.log('checked', checked)

    useEffect(() => {
        if (!activeTransformer) return

        if (activeTransformer instanceof InsertArticulation && activeTransformer.options.units) {
            setUnits(
                activeTransformer.options.units.map(u => {
                    return {
                        notes: u.noteIDs
                            .map(id => msm.getByID(id))
                            .filter(n => n !== null),
                        aspects: new Set(u.aspects),
                        name: u.name,
                        def: mpm.getDefinition('articulationDef', u.name) as ArticulationDef || undefined
                    }
                })
            )
        }
    }, [activeTransformer, mpm, msm])

    const insert = () => {
        addTransformer(activeTransformer || new InsertArticulation(), {
            scope: part,
            units: units.map(u => {
                return {
                    noteIDs: u.notes.map(n => n["xml:id"]),
                    aspects: u.aspects,
                    name: u.name
                }
            })
        })
    }

    const makeDefault = () => {
        addTransformer(activeTransformer || new MakeDefaultArticulation(), {
            scope: part
        })
    }

    const merge = () => {
        addTransformer(activeTransformer || new MergeArticulations(), {
            scope: part
        })
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
                    selected={currentUnit?.notes.includes(note) || false}
                    onClick={(e) => {
                        if ((e.metaKey || e.shiftKey) && currentUnit !== undefined) {
                            if (currentUnit.notes.includes(note)) {
                                const shrunk = {
                                    ...currentUnit,
                                    notes: currentUnit.notes.filter(n => n !== note)
                                }

                                setCurrentUnit(shrunk)
                                setUnits(units.map(u => u === currentUnit ? shrunk : u))
                            }
                            else {
                                const expanded = {
                                    ...currentUnit,
                                    notes: [...currentUnit.notes, note]
                                }

                                setCurrentUnit(expanded)
                                setUnits(units.map(u => u === currentUnit ? expanded : u))
                            }
                        }
                        else {
                            const newUnit: UnitWithDef = {
                                notes: [note],
                                aspects: new Set(),
                                name: v4()
                            }
                            setCurrentUnit(newUnit)
                            setUnits([...units, newUnit])
                        }
                    }}
                />
            ))
        }
    }

    return (
        <div style={{ width: '80vw', overflow: 'scroll', position: 'relative' }}>
            <Box sx={{ position: 'absolute', zIndex: 1000, backgroundColor: 'white', padding: 2, top: '5rem' }}>
                {checked.length > 0 && (
                    <Button
                        variant='contained'
                        onClick={() => {
                            setUnits(units.filter((_, index) => !checked.includes(index)))
                            setChecked([])
                        }}
                    >
                        Delete
                    </Button>
                )}
                <List>
                    {units.map((u, index) => (
                        <ListItem
                            key={u.name}
                            onClick={() => setCurrentUnit(u)}
                            secondaryAction={
                                <IconButton edge="end" aria-label="edit" onClick={() => setUnitDialogOpen(true)}>
                                    <Edit />
                                </IconButton>
                            }
                        >
                            <ListItemButton
                                selected={currentUnit === u}
                                onClick={() => setCurrentUnit(u)}
                            >
                                <ListItemIcon>
                                    <Checkbox
                                        edge="start"
                                        checked={checked.includes(index)}
                                        tabIndex={-1}
                                        disableRipple
                                        onClick={() => handleToggle(index)}
                                    />
                                </ListItemIcon>
                                <ListItemText>
                                    {u.name}
                                </ListItemText>
                            </ListItemButton>
                        </ListItem>
                    ))}
                </List>
            </Box>

            <Stack spacing={1} direction='row'>
                <Button
                    variant='contained'
                    onClick={insert}
                >
                    {activeTransformer ? 'Update' : 'Insert'} Articulations
                </Button>
                <Button
                    variant='outlined'
                    disabled={units.length === 0}
                    onClick={() => {
                        setCurrentUnit(undefined)
                        setUnits([])
                    }}
                >
                    Clear Units
                </Button>
                <Button
                    variant='contained'
                    onClick={makeDefault}
                >
                    Insert Default Articulation
                </Button>
                <Button
                    variant='contained'
                    onClick={merge}
                >
                    Merge
                </Button>
            </Stack>

            <svg width={10000} height={900}>
                {articulatedNotes}
            </svg>

            {(unitDialogOpen && currentUnit) && (
                <UnitDialog
                    open={unitDialogOpen}
                    onClose={() => setUnitDialogOpen(false)}
                    unit={currentUnit}
                    onDone={(unit) => {
                        setCurrentUnit(unit)
                        setUnits(units.map(u => u === currentUnit ? unit : u))
                        setUnitDialogOpen(false)
                    }}
                />
            )}
        </div>
    )
}
