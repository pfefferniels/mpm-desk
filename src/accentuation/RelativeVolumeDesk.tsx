import { useEffect, useState } from "react";
import { usePiano } from "react-pianosound";
import { useNotes } from "../hooks/NotesProvider";
import { asMIDI } from "../utils/utils";
import { Scope, ScopedTransformerViewProps } from "../DeskSwitch";
import { MSM, MsmNote } from "mpmify/lib/msm";
import { Box, Button, Stack } from "@mui/material";
import { DynamicsCircle } from "../dynamics/DynamicsCircle";
import { DynamicsSegment } from "../dynamics/DynamicsDesk";
import { AccentuationCell, InsertMetricalAccentuation, InsertRelativeVolume, MakeArticulationDefinition, MergeArticulations } from "mpmify";
import { Preview } from "./Preview";
import { Delete } from "@mui/icons-material";
import { ZoomControls } from "../ZoomControls";
import { CellDrawer } from "./CellDrawer";

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

export const RelativeVolumeDesk = ({ part, msm, addTransformer, activeTransformer }: ScopedTransformerViewProps<InsertRelativeVolume | MergeArticulations | MakeArticulationDefinition>) => {
    const { play, stop } = usePiano()
    const { slice } = useNotes()

    const [defName, setDefName] = useState<string>('unknown')

    const [datePlayed, setDatePlayed] = useState<number>()
    const [segments, setSegments] = useState<DynamicsSegment[]>([])

    const [cells, setCells] = useState<AccentuationCell[]>([])
    const [currentCell, setCurrentCell] = useState<AccentuationCell>()

    const [, setLowerLimit] = useState<number>()
    const [, setUpperLimit] = useState<number>()

    const [stretchX, setStretchX] = useState(0.03)

    const stretchY = 10
    const margin = 20

    const getScreenY = (velocity: number) => {
        return (1 - velocity) * stretchY + 100
    }

    const avgCellVelocity = (cells: AccentuationCell[]): number => {
        const avgs = cells.map(cell => {
            return segments
                .filter(s => s.date.start >= cell.start && s.date.start <= cell.end)
                .map(s => (s.velocity))
        }).flat()

        const sum = avgs.reduce((acc, vel) => acc + vel, 0)
        return sum / cells.length
    }

    useEffect(() => setSegments(extractDynamicsSegments(msm, part)), [msm, part])

    useEffect(() => {
        if (!activeTransformer) return

        if (activeTransformer instanceof InsertMetricalAccentuation) {
            setCells(activeTransformer.options.cells)
        }
    }, [activeTransformer])

    const handleRelativeVolume = () => {
        addTransformer(activeTransformer instanceof InsertRelativeVolume ? activeTransformer : new InsertRelativeVolume(), {
            scope: part,
            noteIDs: cells.map(c => {
                return msm
                    .notesInPart(part)
                    .filter(n => n.date >= c.start && n.date <= c.end)
                    .map(n => n["xml:id"])
            }).flat(),
            // lowerLimit,
            // upperLimit
        })
    }

    const handleInsertDef = () => {
        addTransformer(activeTransformer instanceof MakeArticulationDefinition ? activeTransformer : new MakeArticulationDefinition(), {
            name: defName
        })
    }

    const handleMerge = () => {
        addTransformer(activeTransformer instanceof MergeArticulations ? activeTransformer : new MergeArticulations(), {
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
        if (e.shiftKey && cells.length > 0) {
            cells[cells.length - 1].end = segment.date.start
            setCells([...cells])
        }
        else {
            setCells([...cells, {
                start: segment.date.start,
                end: segment.date.end,
                beatLength: 0.125
            }])
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

    return (
        <div style={{ height: '400' }}>
            <ZoomControls
                stretchX={stretchX}
                setStretchX={setStretchX}
                rangeX={[0.1, 1]}
            />

            <Box sx={{ m: 1 }}>
                {part !== 'global' && `Part ${part + 1}`}
            </Box>
            <Stack direction='column' spacing={1}>
                <Stack direction='row' spacing={1}>
                    <Button variant='contained' onClick={handleRelativeVolume}>
                        Insert Relative Volumes
                    </Button>
                    <Button variant='outlined' disabled={cells.length === 0} onClick={() => {
                        setLowerLimit(avgCellVelocity(cells))
                    }}
                    >
                        Insert Lower Limit
                    </Button>
                    <Button variant='outlined' disabled={cells.length === 0} onClick={() => {
                        setUpperLimit(avgCellVelocity(cells))
                    }}>
                        Insert Upper Limit
                    </Button>
                    <Button
                        variant='outlined'
                        disabled={cells.length === 0}
                        onClick={() => setCells([])}
                        startIcon={<Delete />}
                    >
                        Clear Frames ({cells.length})
                    </Button>
                </Stack>
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
                        <Preview
                            key={`cell_${cell.start}_${cell.end}_${i}`}
                            cell={cell}
                            i={i}
                            stretchX={stretchX}
                            stretchY={stretchY}
                            getScreenY={getScreenY}
                            denominator={4}
                            segments={segments}
                            onClick={(e) => {
                                if (e.altKey && e.shiftKey) {
                                    setCells(prevCells => prevCells.filter(c => c !== cell));
                                } else {
                                    setCurrentCell(cell);
                                }
                            }}
                        />
                    )
                })}

                {circles}
            </svg>

            {
                currentCell && (
                    <CellDrawer
                        cell={currentCell}
                        open={true}
                        onClose={() => setCurrentCell(undefined)}
                        onChange={(cell) => {
                            setCurrentCell(cell)
                            setCells(cells.map(c => c === currentCell ? cell : c))
                        }}
                    />
                )
            }

            {currentCell && currentCell.start}
        </div >
    )
}
