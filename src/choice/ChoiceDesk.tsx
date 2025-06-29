
import { Box, Button, FormControl, FormLabel, IconButton, List, ListItem, ListItemButton, ListItemText, MenuItem, Select, Stack } from "@mui/material"
import { ScopedTransformerViewProps } from "../DeskSwitch"
import { MsmNote } from "mpmify/lib/msm"
import { MouseEvent, useEffect, useState } from "react"
import { MakeChoice, RangeChoice } from "mpmify"
import { Edit } from "@mui/icons-material"

interface ArticulatedNoteProps {
    notes: MsmNote[]
    stretchX: number
    stretchY: number
    onClick: (e: MouseEvent<Element>, note: MsmNote) => void
}

const NoteChoice = ({ notes, stretchX, stretchY, onClick }: ArticulatedNoteProps) => {
    if (!notes.length) return null

    const refOnset = notes[0]["midi.onset"]
    const refVel = notes[0]["midi.velocity"]
    const refPitch = notes[0]["midi.pitch"]

    return (
        <g>
            <line
                x1={refOnset * stretchX}
                x2={refOnset * stretchX}
                y1={(127 - refPitch - 1) * stretchY}
                y2={(127 - refPitch + 1) * stretchY}
                stroke="black"
                strokeWidth={1}
            />

            {notes.map((note, i) => {
                const velocity = note["midi.velocity"]
                const duration = note["midi.duration"]
                const onset = note["midi.onset"]
                const yOffset = (1 / notes.length) * i
                const source = note.source || 'unknown'
                const velDiff = Math.abs(velocity - refVel)
                const onsetDiff = Math.abs(onset - refOnset)
                if (i > 0 && ((velDiff <= 0 && onsetDiff <= 0.02))) return null

                const y = (127 - note["midi.pitch"] + yOffset) * stretchY

                return (
                    <>
                        <line
                            data-source={source}
                            strokeWidth={(1 / notes.length) * stretchY - 0.2}
                            strokeOpacity={(velocity + 40) / 127}
                            stroke={i > 0 ? 'red' : 'black'}
                            x1={onset * stretchX}
                            x2={(onset + duration) * stretchX}
                            y1={y}
                            y2={y}
                            key={`noteLine_${note["xml:id"]}`}
                            onClick={(e) => onClick(e, note)}
                        />

                        <text
                            x={onset * stretchX}
                            y={y}
                            fontSize={5}
                            fill="white"
                            dominantBaseline="middle"
                        >
                            {(velocity - refVel) !== 0 && `${(velocity - refVel).toFixed(0)}`}
                        </text>
                    </>
                )
            })}
        </g>
    )
}

export const ChoiceDesk = ({ msm, mpm, part, activeTransformer, addTransformer }: ScopedTransformerViewProps<MakeChoice>) => {
    const [choices, setChoices] = useState<RangeChoice[]>([])
    const [currentChoice, setCurrentChoice] = useState<RangeChoice>()
    const [defaultChoice, setDefaultChoice] = useState<string>()
    const [editDialog, setEditDialog] = useState(false)

    useEffect(() => {
        if (!activeTransformer) return

        if (activeTransformer instanceof MakeChoice && activeTransformer.options.choices) {
            setChoices(activeTransformer.options.choices as RangeChoice[])
            setDefaultChoice(activeTransformer.options.defaultChoice || '')
        }
    }, [activeTransformer, mpm, msm])

    const insert = () => {
        addTransformer(activeTransformer || new MakeChoice(), {
            scope: part,
            choices,
            defaultChoice
        })
    }

    const stretchX = 30
    const stretchY = 10

    const articulatedNotes = []
    // group notes with the same xml:id
    const grouped = Object.groupBy(msm.allNotes, note => note['xml:id'])
    for (const [xmlId, notes] of Object.entries(grouped)) {
        if (!notes) return

        articulatedNotes.push((
            <NoteChoice
                key={`group_${xmlId}`}
                notes={notes}
                stretchX={stretchX}
                stretchY={stretchY}
                onClick={(e, note) => {
                    if (!note.source) return

                    if (e.shiftKey) {
                        if (!currentChoice) return
                        if (currentChoice.prefer === note.source) {
                            if (note.date < currentChoice.from) {
                                currentChoice.from = note.date
                            }
                            else if (note.date > currentChoice.to) {
                                currentChoice.to = note.date
                            }
                        }
                        const updated = { ...currentChoice }
                        setCurrentChoice(updated)
                        setChoices(prev => prev.map(choice => {
                            if (choice === currentChoice) {
                                return { ...updated }
                            }
                            return choice
                        }))
                    }
                    else {
                        const newChoice: RangeChoice = {
                            from: note.date,
                            to: note.date,
                            prefer: note.source
                        }
                        setCurrentChoice(newChoice)
                        setChoices(prev => [...prev, newChoice])
                    }
                }}
            />
        ))
    }

    const sources = new Set(msm.allNotes.map(note => note.source || 'unknown'))

    return (
        <>
            <Box sx={{ position: 'absolute', zIndex: 1000, backgroundColor: 'white', padding: 2, top: '5rem' }}>
                <List>
                    {choices.map((choice, index) => (
                        <ListItem
                            key={`choice_${index}`}
                            onClick={() => setCurrentChoice(choice)}
                            secondaryAction={
                                <IconButton edge="end" aria-label="edit" onClick={() => setEditDialog(true)}>
                                    <Edit />
                                </IconButton>
                            }
                        >
                            <ListItemButton
                                selected={currentChoice === choice}
                                onClick={() => setCurrentChoice(choice)}
                            >
                                <ListItemText>
                                    {choice.prefer.slice(0, 8)} from {choice.from} to {choice.to}
                                </ListItemText>
                            </ListItemButton>
                        </ListItem>
                    ))}
                </List>

                <FormControl>
                    <FormLabel>Default Source</FormLabel>
                    <Select
                        value={defaultChoice || ''}
                        onChange={(e) => {
                            setDefaultChoice(e.target.value)
                        }}
                    >
                        {Array.from(sources).map((source, index) => (
                            <MenuItem key={`source_${index}`} value={source}>
                                {source}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>

                {editDialog && <span>Editing ...</span>}
                <Stack spacing={1} direction='row'>
                    <Button
                        variant='contained'
                        onClick={insert}
                    >
                        {activeTransformer ? 'Update' : 'Insert'} Articulations
                    </Button>
                </Stack>
            </Box>

            <div style={{ width: '80vw', overflow: 'scroll', position: 'relative' }}>
                <svg width={10000} height={900}>
                    {articulatedNotes}
                </svg>
            </div>
        </>
    )
}
