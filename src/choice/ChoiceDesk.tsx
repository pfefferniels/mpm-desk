import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, MenuItem, Select, SelectChangeEvent, Stack } from "@mui/material"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { MsmNote } from "mpmify/lib/msm"
import { MouseEvent, useState } from "react"
import { MakeChoice, NoteChoice, Preference, RangeChoice } from "mpmify"
import { createPortal } from "react-dom"
import { Ribbon } from "../Ribbon"
import { usePhysicalZoom } from "../hooks/ZoomProvider"

const colors = [
    "#e6194B",
    "#3cb44b",
    "#ffe119",
    "#4363d8",
    "#f58231",
    "#911eb4"
]

interface SelectSourceProps {
    sources: Set<string>
    value: string
    onChange: (event: SelectChangeEvent<string>) => void
}

const SelectSource = ({ sources, value, onChange }: SelectSourceProps) => {
    return (
        <FormControl fullWidth>
            <Select
                value={value}
                onChange={onChange}
            >
                {Array.from(sources).map(source => (
                    <MenuItem key={`select_${source}`} value={source}>
                        {source}
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    )
}

interface ArticulatedNoteProps {
    notes: MsmNote[]
    stretchX: number
    stretchY: number
    onClick: (e: MouseEvent<Element>, note: MsmNote) => void
}

const ChoiceGroup = ({ notes, stretchX, stretchY, onClick }: ArticulatedNoteProps) => {
    const [hovered, setHovered] = useState(false)

    if (!notes.length) return null

    const refOnset = notes[0]["midi.onset"]
    const refVel = notes[0]["midi.velocity"]
    const refPitch = notes[0]["midi.pitch"]

    const variationScore = notes.reduce((acc, note) => {
        const velDiff = Math.abs(note["midi.velocity"] - refVel)
        const onsetDiff = Math.abs(note["midi.onset"] - refOnset)
        return acc + (velDiff + onsetDiff * 1000)
    }, 0)

    return (
        <g
            opacity={hovered ? 1 : (variationScore / (notes.length * 2) || 0.2)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <line
                x1={refOnset * stretchX}
                x2={refOnset * stretchX}
                y1={(100 - refPitch - 2) * stretchY}
                y2={(100 - refPitch + 2) * stretchY}
                stroke={'black'}
                strokeWidth={2}
                strokeOpacity={1}
            />

            {notes.map((note, i) => {
                const velocity = note["midi.velocity"]
                const duration = note["midi.duration"]
                const onset = note["midi.onset"]
                const yOffset = i - (notes.length / 2) + 0.5
                const source = note.source || 'unknown'
                const velDiff = Math.abs(velocity - refVel)
                const onsetDiff = Math.abs(onset - refOnset)
                if (i > 0 && ((velDiff <= 0 && onsetDiff <= 0.02))) return null

                const y = (100 - note["midi.pitch"] + yOffset) * stretchY

                return (
                    <>
                        <line
                            data-source={source}
                            strokeWidth={stretchY - 0.4}
                            strokeOpacity={(velocity + 40) / 127}
                            stroke={colors[i % colors.length]}
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
                            fontSize={10}
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

export const ChoiceDesk = ({ msm, addTransformer, appBarRef }: ScopedTransformerViewProps<MakeChoice>) => {
    const [currentChoice, setCurrentChoice] = useState<RangeChoice | NoteChoice>()
    const [prefer, setPrefer] = useState<Preference>()
    const [insert, setInsert] = useState(false)

    const stretchX = usePhysicalZoom()
    const stretchY = 10

    const articulatedNotes = []
    // group notes with the same xml:id
    const grouped = Object.groupBy(msm.allNotes, note => note['xml:id'])
    for (const [xmlId, notes] of Object.entries(grouped)) {
        if (!notes || !notes.length) return

        articulatedNotes.push((
            <ChoiceGroup
                key={`group_${xmlId}`}
                notes={notes}
                stretchX={stretchX}
                stretchY={stretchY}
                onClick={(e) => {
                    if (!e.shiftKey && !e.metaKey) {
                        const newChoice: NoteChoice = {
                            noteids: [notes[0]['xml:id']],
                        }
                        setCurrentChoice(newChoice)
                    }
                    else if (currentChoice && e.metaKey && 'noteids' in currentChoice) {
                        const noteId = notes[0]['xml:id']
                        if (currentChoice.noteids.includes(noteId)) {
                            currentChoice.noteids = currentChoice.noteids.filter(id => id !== noteId)
                        }
                        else {
                            currentChoice.noteids.push(noteId)
                        }
                        setCurrentChoice({ ...currentChoice })
                    }
                    else if (currentChoice && e.shiftKey) {
                        if ('noteids' in currentChoice) {
                            const existingNotes = msm.allNotes.filter(note => currentChoice.noteids.includes(note['xml:id']))
                            const from = Math.min(...existingNotes.map(note => note.date))
                            const to = notes[0].date
                            setCurrentChoice({
                                from,
                                to
                            })
                        }
                        else {
                            currentChoice.to = notes[0].date
                            setCurrentChoice({ ...currentChoice })
                        }
                    }
                }}
            />
        ))
    }

    const sources = new Set(msm.allNotes.map(note => note.source || 'unknown'))

    return (
        <>
            {createPortal((
                <Ribbon title="Range Choice">
                    <Button
                        size='small'
                        variant='outlined'
                        onClick={() => setInsert(true)}
                    >
                        Make Choice ({
                            currentChoice
                                ? 'noteids' in currentChoice
                                    ? currentChoice.noteids.length
                                    : `${currentChoice.from}-${currentChoice.to}`
                                : 'Default'
                        })
                    </Button>
                    <Button
                        size='small'
                        variant='outlined'
                        onClick={() => {
                            setCurrentChoice(undefined)
                        }}
                        disabled={!currentChoice}
                    >
                        Clear Choice
                    </Button>
                </Ribbon>
            ), appBarRef.current || document.body)}

            <div style={{ width: '80vw', overflow: 'scroll', position: 'relative' }}>
                <svg width={10000} height={900}>
                    {articulatedNotes}
                </svg>
            </div>

            <Dialog
                open={insert}
                onClose={() => setInsert(false)}
            >
                <DialogTitle>Make Choice</DialogTitle>
                <DialogContent>
                    <Stack spacing={2}>
                        Select Preferred Source:
                        <SelectSource
                            sources={sources}
                            value={prefer
                                ? 'prefer' in prefer
                                    ? prefer.prefer
                                    : prefer.velocity
                                : 'unknown'
                            }
                            onChange={(e) => {
                                setPrefer({
                                    prefer: e.target.value
                                })
                            }}
                        />
                        <Divider>
                            Or
                        </Divider>

                        Preferred Source for Loudness (Velocity):
                        <SelectSource
                            sources={sources}
                            value={prefer
                                ? 'prefer' in prefer
                                    ? prefer.prefer
                                    : prefer.velocity
                                : 'unknown'
                            }
                            onChange={(e) => {
                                if (prefer && 'prefer' in prefer) {
                                    setPrefer({
                                        velocity: e.target.value,
                                        timing: prefer.prefer,
                                    })
                                }
                                else {
                                    setPrefer({
                                        velocity: e.target.value,
                                        timing: prefer?.timing || 'unknown',
                                    })
                                }
                            }}
                        />

                        Preferred Source for Timing:
                        <SelectSource
                            sources={sources}
                            value={prefer
                                ? 'prefer' in prefer
                                    ? prefer.prefer
                                    : prefer.timing
                                : 'unknown'
                            }
                            onChange={(e) => {
                                if (prefer && 'prefer' in prefer) {
                                    setPrefer({
                                        timing: e.target.value,
                                        velocity: prefer.prefer,
                                    })
                                }
                                else {
                                    setPrefer({
                                        timing: e.target.value,
                                        velocity: prefer?.velocity || 'unknown',
                                    })
                                }
                            }}
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => setInsert(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        color="primary"
                        onClick={() => {
                            if (currentChoice && prefer) {
                                addTransformer(new MakeChoice({
                                    ...currentChoice,
                                    ...prefer
                                }))
                            }
                            setInsert(false)
                            setCurrentChoice(undefined)
                            setPrefer(undefined)
                        }}
                    >
                        Make Choice
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    )
}
