import { useEffect, useState } from "react";
import { usePiano } from "react-pianosound";
import { useNotes } from "../hooks/NotesProvider";
import { asMIDI } from "../utils";
import { Scope, ScopedTransformerViewProps } from "../DeskSwitch";
import { MSM, MsmNote } from "mpmify/lib/msm";
import { Box, Button, Stack } from "@mui/material";
import { DynamicsCircle } from "../dynamics/DynamicsCircle";
import { DynamicsSegment } from "../dynamics/DynamicsDesk";
import { AccentuationCell, InsertMetricalAccentuation, InsertRelativeVolume } from "mpmify";
import { AccentuationPattern, AccentuationPatternDef } from "../../../mpm-ts/lib";
import { Pattern } from "./Pattern";
import { Cell } from "./Cell";

const extractDynamicsSegments = (msm: MSM, part: Scope) => {
    const segments: DynamicsSegment[] = []
    msm.asChords(part).forEach((notes, date) => {
        if (!notes.length) return

        for (const note of notes) {
            if (segments.findIndex(s => s.date.start === date && s.velocity === note.absoluteVelocityChange) !== -1) continue
            segments.push({
                date: {
                    start: date,
                    end: date
                },
                velocity: note.absoluteVelocityChange || 0,
                active: false
            })
        }
    })

    return segments
}

export const AccentuationDesk = ({ part, msm, mpm, addTransformer, activeTransformer }: ScopedTransformerViewProps<InsertMetricalAccentuation | InsertRelativeVolume>) => {
    const { play, stop } = usePiano()
    const { slice } = useNotes()

    const [datePlayed, setDatePlayed] = useState<number>()
    const [segments, setSegments] = useState<DynamicsSegment[]>([])
    const [activeSegment, setActiveSegment] = useState<DynamicsSegment>()

    const [cells, setCells] = useState<AccentuationCell[]>([])
    const [currentCell, setCurrentCell] = useState<AccentuationCell>()

    const stretchY = 10
    const stretchX = 0.03
    const margin = 20

    const getScreenY = (velocity: number) => {
        return (1 - velocity) * stretchY + 100
    }

    useEffect(() => setSegments(extractDynamicsSegments(msm, part)), [msm, part])

    useEffect(() => {
        if (!activeTransformer) return

        if (activeTransformer instanceof InsertMetricalAccentuation) {
            setCells(activeTransformer.options.cells)
        }
    }, [activeTransformer])

    const handleMetricalAccentuation = () => {
        addTransformer(activeTransformer || new InsertMetricalAccentuation(), {
            cells,
            loopTolerance: 10,
            scope: part
        })
    }

    const handleRelativeVolume = () => {
        addTransformer(activeTransformer || new InsertRelativeVolume(), {
            scope: part
        })
    }

    const handlePlay = (from: number, to?: number) => {
        let notes =
            slice(from, to).map(n => {
                const partial: Partial<MsmNote> = { ...n }
                delete partial['midi.onset']
                delete partial['midi.duration']
                if (partial['midi.velocity']) {
                    partial['midi.velocity'] -= n.absoluteVelocityChange || 0
                }
                return partial as Omit<MsmNote, 'midi.onset' | 'midi.duration'>
            })

        if (typeof part === 'number') notes = notes.filter(n => n.part - 1 === part)
        const midi = asMIDI(notes)

        if (midi) {
            stop()
            play(midi, (e) => {
                if (e.type === 'meta' && e.subtype === 'text') {
                    setDatePlayed(+e.text)
                }
            })
        }
    }

    const handleClick = (e: MouseEvent, segment: DynamicsSegment) => {
        if (e.shiftKey && activeSegment) {
            const cell: AccentuationCell = {
                start: activeSegment.date.start,
                end: segment.date.start,
                beatLength: 0.125
            }
            setCells([...cells, cell])
        }
        else {
            setActiveSegment(segment)
        }
    }

    const circles: JSX.Element[] = segments.map((segment, i) => {
        return (
            <DynamicsCircle
                key={`velocity_segment_${segment.date}_${i}`}
                segment={segment}
                datePlayed={datePlayed}
                stretchX={stretchX}
                screenY={getScreenY}
                handlePlay={handlePlay}
                handleClick={handleClick}
            />
        )
    })

    const width = 8000
    const height = 300

    const patterns = mpm
        .getInstructions<AccentuationPattern>('accentuationPattern', part)
        .map(i => {
            const def = mpm.getDefinition('accentuationPatternDef', i["name.ref"]) as AccentuationPatternDef | null
            if (!def) return null

            return {
                length: def.length,
                children: def.children,
                ...i
            }
        })
        .filter(i => i !== null)

    return (
        <div style={{ height: '400' }}>
            <Box sx={{ m: 1 }}>
                {part !== 'global' && `Part ${part + 1}`}
            </Box>
            <Stack direction='row' spacing={1}>
                <Button variant='contained' onClick={handleMetricalAccentuation}>
                    {activeTransformer ? 'Update' : 'Insert'} Metrical Accentuations
                </Button>
                <Button variant='outlined' disabled={cells.length === 0} onClick={() => setCells([])}>
                    Remove Frames ({cells.length})
                </Button>
                <Button variant='contained' onClick={handleRelativeVolume}>
                    Insert Relative Volumes
                </Button>
            </Stack>

            <svg
                width={width + margin}
                height={height + margin}
                viewBox={
                    [
                        -margin,
                        -margin,
                        width + margin,
                        height + margin
                    ].join(' ')
                }
            >
                <line
                    x1={0}
                    x2={width}
                    y1={getScreenY(0)}
                    y2={getScreenY(0)}
                    stroke='black'
                    strokeWidth={1}
                />

                {cells.map((cell, i) => {
                    return (
                        <Cell
                            key={`cell_${cell.start}_${cell.end}_${i}`}
                            cell={cell}
                            i={i}
                            stretchX={stretchX}
                            getScreenY={getScreenY}
                            segments={segments}
                            setCells={setCells}
                            setCurrentCell={setCurrentCell}
                        />
                    )
                })}

                {patterns.map(pattern => {
                    return (
                        <Pattern
                            key={`pattern_${pattern.date}`}
                            pattern={pattern}
                            stretchX={stretchX}
                            stretchY={stretchY}
                            getScreenY={getScreenY}
                            denominator={4}
                        />
                    )
                })}

                {circles}
            </svg>

            <Box sx={{ m: 1 }}>
                {currentCell && `Current cell: ${currentCell.start} - ${currentCell.end}`}
                {activeSegment && `Active segment: ${activeSegment.date.start}`}
            </Box>
        </div>
    )
}
