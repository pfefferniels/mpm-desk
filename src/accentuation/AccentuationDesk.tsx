import { useEffect, useState } from "react";
import { usePiano } from "react-pianosound";
import { useNotes } from "../hooks/NotesProvider";
import { asMIDI } from "../utils/utils";
import { Scope, ScopedTransformerViewProps } from "../DeskSwitch";
import { MSM, MsmNote } from "mpmify/lib/msm";
import { Box, Button, Slider, Stack, Typography } from "@mui/material";
import { DynamicsCircle } from "../dynamics/DynamicsCircle";
import { DynamicsSegment } from "../dynamics/DynamicsDesk";
import { AccentuationCell, InsertMetricalAccentuation, MergeMetricalAccentuations } from "mpmify";
import { Accentuation, AccentuationPattern, AccentuationPatternDef } from "../../../mpm-ts/lib";
import { Pattern } from "./Pattern";
import { Cell } from "./Cell";
import { Delete, SelectAll } from "@mui/icons-material";
import { ZoomControls } from "../ZoomControls";
import { CellDrawer } from "./CellDrawer";
import { NameDialog } from "./NameDialog";

type Pattern = (AccentuationPattern & { scale: number, length: number, children: Accentuation[] })
export type CellWithPattern = AccentuationCell & { pattern?: Pattern }

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

export const AccentuationDesk = ({ part, msm, mpm, addTransformer, activeTransformer }: ScopedTransformerViewProps<InsertMetricalAccentuation | MergeMetricalAccentuations>) => {
    const { play, stop } = usePiano()
    const { slice } = useNotes()

    const [datePlayed, setDatePlayed] = useState<number>()
    const [segments, setSegments] = useState<DynamicsSegment[]>([])

    const [cells, setCells] = useState<CellWithPattern[]>([])
    const [currentCells, setCurrentCells] = useState<CellWithPattern[]>([])

    const [scaleTolerance, setScaleTolerance] = useState(1.5)
    const [stretchX, setStretchX] = useState(0.03)

    const [nameDialogOpen, setNameDialogOpen] = useState(false)

    const stretchY = 10
    const margin = 20

    const getScreenY = (velocity: number) => {
        return (1 - velocity) * stretchY + 100
    }

    useEffect(() => setSegments(extractDynamicsSegments(msm, part)), [msm, part])

    useEffect(() => {
        if (!activeTransformer) return

        if (activeTransformer instanceof InsertMetricalAccentuation) {
            const prev = activeTransformer.options.cells as CellWithPattern[]
            const instructions = mpm
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
                .filter((i): i is Pattern => i !== null)

            prev.forEach(cell => {
                cell.pattern = instructions.find(i => i.date === cell.start)
            })

            setCells(prev)
        }
    }, [activeTransformer, mpm, part])

    const handleMetricalAccentuation = () => {
        addTransformer(activeTransformer instanceof InsertMetricalAccentuation ? activeTransformer : new InsertMetricalAccentuation(), {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            cells: cells.map(({ pattern, ...rest }) => rest),
            scaleTolerance,
            scope: part
        })
    }

    const handleMerge = (name: string) => {
        addTransformer(activeTransformer instanceof MergeMetricalAccentuations ? activeTransformer : new MergeMetricalAccentuations(), {
            names: currentCells
                .map(c => c.pattern?.["name.ref"])
                .filter(n => n !== undefined) as string[],
            into: name,
            scope: part
        })
    }

    const handlePlay = (from: number, to?: number) => {
        let notes =
            slice(from, to).map(n => {
                const partial: Partial<MsmNote> = { ...n }
                delete partial['midi.onset']
                delete partial['midi.duration']
                partial['midi.velocity'] = 40 + (n.absoluteVelocityChange || 0)
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
                beatLength: 0.125,
                neutralEnd: false
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
        <div style={{ height: '400', overflow: 'scroll' }}>
            <ZoomControls
                stretchX={stretchX}
                setStretchX={setStretchX}
                rangeX={[0.005, 0.25]}
            />

            <Stack spacing={1} direction='column' sx={{ position: 'sticky', left: 0 }}>
                <Box sx={{ m: 1 }}>
                    {part !== 'global' && `Part ${part + 1}`}
                </Box>
                <Box sx={{ maxWidth: '50%' }}>
                    <Typography gutterBottom>
                        Loop Tolerance
                    </Typography>
                    <Slider
                        value={scaleTolerance}
                        onChange={(_, newValue) => setScaleTolerance(newValue as number)}
                        step={0.25}
                        min={0}
                        max={5}
                        valueLabelDisplay="auto"
                    />
                </Box>
                <Stack direction='row' spacing={1}>
                    <Button variant='contained' onClick={handleMetricalAccentuation}>
                        {activeTransformer ? 'Update' : 'Insert'} Metrical Accentuations
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
                <Stack direction='row' spacing={1}>
                    <Button

                        variant='contained'
                        onClick={() => setNameDialogOpen(true)}
                    >
                        Merge ({currentCells.length})
                    </Button>
                    <Button
                        variant='outlined'
                        startIcon={<SelectAll />}
                        onClick={() => {
                            setCurrentCells(cells)
                        }}
                    >
                        Select All
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
                        <Cell
                            key={`cell_${cell.start}_${cell.end}_${i}`}
                            cell={cell}
                            i={i}
                            stretchX={stretchX}
                            stretchY={stretchY}
                            getScreenY={getScreenY}
                            segments={segments}
                            denominator={msm.timeSignature?.denominator || 4}
                            onClick={(e) => {
                                if (e.altKey && e.shiftKey) {
                                    setCells(prevCells => prevCells.filter(c => c !== cell));
                                }
                                else if (e.metaKey) {
                                    setCurrentCells(prevCells => prevCells.concat([cell]))
                                }
                                else {
                                    setCurrentCells([cell]);
                                }
                            }}
                            selected={currentCells.includes(cell)}
                        />
                    )
                })}

                {circles}
            </svg>

            {currentCells.length === 1 && (
                <CellDrawer
                    cell={currentCells[0]}
                    open={true}
                    onClose={() => setCurrentCells([])}
                    onChange={(cell) => {
                        setCurrentCells([cell])
                        setCells(cells.map(c => c === currentCells[0] ? cell : c))
                    }}
                />
            )}

            {nameDialogOpen && (
                <NameDialog
                    open={nameDialogOpen}
                    onClose={() => setNameDialogOpen(false)}
                    onDone={handleMerge}
                />
            )}
        </div>
    )
}
