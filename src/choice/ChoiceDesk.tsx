import { Button, FormControl, MenuItem, Select, Stack } from "@mui/material"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { MsmNote } from "mpmify/lib/msm"
import { MouseEvent, useState } from "react"
import { MakeChoice, RangeChoice } from "mpmify"
import { createPortal } from "react-dom"
import { Ribbon } from "../Ribbon"

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

export const ChoiceDesk = ({ msm, part, addTransformer, appBarRef }: ScopedTransformerViewProps<MakeChoice>) => {
    const [currentChoice, setCurrentChoice] = useState<RangeChoice>()
    const [defaultChoice, setDefaultChoice] = useState<string>()

    const insert = () => {
        if (currentChoice) {
            addTransformer(new MakeChoice({
                scope: part,
                ...currentChoice
            }))
        }
        else if (defaultChoice) {
            addTransformer(new MakeChoice({
                scope: part,
                prefer: defaultChoice
            }))
        }
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

                    if (!currentChoice || !e.shiftKey) {
                        const newChoice: RangeChoice = {
                            from: note.date,
                            to: note.date,
                            prefer: note.source
                        }
                        setCurrentChoice(newChoice)
                        return
                    }

                    if (!('from' in currentChoice && 'to' in currentChoice && 'prefer' in currentChoice)) {
                        return
                    }

                    if (e.shiftKey) {
                        if (!currentChoice) return
                        if (currentChoice.prefer === note.source) {
                            if (note.date < (currentChoice as RangeChoice).from) {
                                currentChoice.from = note.date
                            }
                            else if (note.date > (currentChoice as RangeChoice).to) {
                                currentChoice.to = note.date
                            }
                        }
                        const updated = { ...currentChoice }
                        setCurrentChoice(updated)
                    }
                }}
            />
        ))
    }

    const sources = new Set(msm.allNotes.map(note => note.source || 'unknown'))


    return (
        <>
            {currentChoice && (
                <>
                    {createPortal((
                        <Button
                            size='small'
                            variant='outlined'
                            onClick={insert}
                        >
                            Choose {currentChoice.prefer.slice(0, 8)} from {(currentChoice as RangeChoice).from} to {(currentChoice as RangeChoice).to}
                        </Button>
                    ), appBarRef.current || document.body)}
                </>
            )}

            {!currentChoice && (
                <>
                    {createPortal((
                        <Ribbon title="Default Choice">
                            <Stack direction='row' spacing={1} alignItems='center'>
                                <FormControl size='small'>
                                    <Select
                                        value={defaultChoice || ''}
                                        onChange={(e) => {
                                            setDefaultChoice(e.target.value)
                                        }}
                                    >
                                        {Array.from(sources).map((source, index) => (
                                            <MenuItem key={`source_${index}`} value={source}>
                                                {source.slice(0, 8)}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>

                                <Button variant='contained' size='small' onClick={insert}>
                                    Insert
                                </Button>
                            </Stack>
                        </Ribbon>
                    ), appBarRef.current || document.body)}
                </>
            )
            }


            <div style={{ width: '80vw', overflow: 'scroll', position: 'relative' }}>
                <svg width={10000} height={900}>
                    {articulatedNotes}
                </svg>
            </div>
        </>
    )
}
