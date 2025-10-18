import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, MenuItem, Select, SelectChangeEvent, Stack } from "@mui/material"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { MsmNote } from "mpmify/lib/msm"
import { MouseEvent, useState } from "react"
import { MakeChoice, NoteChoice, Preference, RangeChoice } from "mpmify"
import { createPortal } from "react-dom"
import { Ribbon } from "../Ribbon"
import { usePhysicalZoom } from "../hooks/ZoomProvider"

// Cf. https://gist.github.com/alexhornbake/6005176
// returns <path> attribute @d.
// a curly brace between x1,y1 and x2,y2, w pixels wide 
// and q factor, .5 is normal, higher q = more expressive bracket 
const makeCurlyBrace = (x1: number, y1: number, x2: number, y2: number, w: number, q: number = 0.5) => {
    //Calculate unit vector
    let dx = x1 - x2;
    let dy = y1 - y2;
    const len = Math.sqrt(dx * dx + dy * dy);
    dx = dx / len;
    dy = dy / len;

    //Calculate Control Points of path,
    const qx1 = x1 + q * w * dy;
    const qy1 = y1 - q * w * dx;
    const qx2 = (x1 - .25 * len * dx) + (1 - q) * w * dy;
    const qy2 = (y1 - .25 * len * dy) - (1 - q) * w * dx;
    const tx1 = (x1 - .5 * len * dx) + w * dy;
    const ty1 = (y1 - .5 * len * dy) - w * dx;
    const qx3 = x2 + q * w * dy;
    const qy3 = y2 - q * w * dx;
    const qx4 = (x1 - .75 * len * dx) + (1 - q) * w * dy;
    const qy4 = (y1 - .75 * len * dy) - (1 - q) * w * dx;

    return ("M " + x1 + " " + y1 +
        " Q " + qx1 + " " + qy1 + " " + qx2 + " " + qy2 +
        " T " + tx1 + " " + ty1 +
        " M " + x2 + " " + y2 +
        " Q " + qx3 + " " + qy3 + " " + qx4 + " " + qy4 +
        " T " + tx1 + " " + ty1);
}

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
    colorFor: (source: string) => string
}

const ChoiceGroup = ({ notes, stretchX, stretchY, onClick, colorFor }: ArticulatedNoteProps) => {
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
            opacity={hovered ? 1 : (variationScore / (notes.length * 4) || 1)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
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

                const color = colorFor(source)

                return (
                    <>
                        <rect
                            data-source={source}
                            data-id={note['xml:id']}
                            x={onset * stretchX}
                            y={y - (stretchY - 0.4) / 2}
                            width={duration * stretchX}
                            height={stretchY * 0.5}
                            fill={color}
                            fillOpacity={(velocity + 40) / 127}
                            stroke='black'
                            strokeWidth={0.8}
                            strokeDasharray={hovered ? 'none' : '1 1'}
                            onClick={(e) => onClick(e, note)}
                            key={`noteRect_${note["xml:id"]}`}
                        />

                        <text
                            x={onset * stretchX + 3}
                            y={y - (stretchY - 0.4) / 2 + stretchY * 0.5 / 2}
                            fontSize={10}
                            fill="black"
                            dominantBaseline="middle"
                        >
                            {(velocity - refVel) !== 0 && `${(velocity - refVel).toFixed(0)}`}
                        </text>
                    </>
                )
            })}

            <path
                d={
                    makeCurlyBrace(
                        refOnset * stretchX,
                        (100 - refPitch - 1.5) * stretchY,
                        refOnset * stretchX,
                        (100 - refPitch + 1.5) * stretchY,
                        5,
                        0.55
                    )}
                stroke={'black'}
                strokeWidth={hovered ? 2 : 1.2}
                fill='none'
            />
        </g>
    )
}

export const ChoiceDesk = ({ msm, addTransformer, appBarRef }: ScopedTransformerViewProps<MakeChoice>) => {
    const [currentChoice, setCurrentChoice] = useState<RangeChoice | NoteChoice>()
    const [prefer, setPrefer] = useState<Preference>()
    const [insert, setInsert] = useState(false)

    const stretchX = usePhysicalZoom()
    const stretchY = 10

    const sourceIDs = Array.from(new Set(msm.allNotes.map(note => note.source || 'unknown')))
    const colorFor = (source: string) => {
        const index = sourceIDs.indexOf(source)
        return colors[index % colors.length]
    }

    const groups = []

    // group notes with the same xml:id
    const grouped = Object.groupBy(msm.allNotes, note => note['xml:id'])
    for (const [xmlId, notes] of Object.entries(grouped)) {
        if (!notes || !notes.length) return

        groups.push((
            <ChoiceGroup
                key={`group_${xmlId}`}
                notes={notes}
                stretchX={stretchX}
                stretchY={stretchY}
                colorFor={colorFor}
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

    // display pedals
    const groupedPedals = Object.groupBy(msm.pedals, pedal => pedal.type)
    const yStart = 70 * stretchY
    Object.entries(groupedPedals).forEach(([, pedals], typeIndex) => {
        const bySource = Object
            .entries(Object.groupBy(pedals, pedal => pedal.source || 'unknown'))
            .filter(([, pedals]) => pedals && pedals.length)

        const typeHeight = 20
        const sourceHeight = typeHeight / bySource.length
        bySource.forEach(([, pedals], sourceIndex) => {
            if (!pedals || !pedals.length) return

            for (const pedal of pedals) {
                const onset = pedal["midi.onset"]
                const duration = pedal["midi.duration"]
                const xmlId = pedal['xml:id']
                const color = colorFor(pedal.source || 'unknown')
                console.log('pedal source=', pedal.source, color)

                groups.push((
                    <rect
                        key={`pedal_${xmlId}`}
                        data-id={xmlId}
                        data-onset={onset}
                        data-duration={duration}
                        x={onset * stretchX}
                        y={yStart + typeIndex * typeHeight + sourceIndex * sourceHeight}
                        width={duration * stretchX}
                        height={sourceHeight}
                        fill={color}
                        fillOpacity={0.5}
                        stroke='black'
                        strokeWidth={0.8}
                    />
                ))
            }
        })
    })

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
                    {groups}
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
                            if (prefer) {
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
