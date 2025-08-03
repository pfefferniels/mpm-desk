import { useEffect, useState } from "react";
import { usePiano } from "react-pianosound";
import { useNotes } from "../hooks/NotesProvider";
import { asMIDI } from "../utils/utils";
import { Scope, ScopedTransformerViewProps } from "../TransformerViewProps";
import { MSM, MsmNote } from "mpmify/lib/msm";
import { Box, Button, Slider, Stack, Typography } from "@mui/material";
import { DynamicsCircle } from "../dynamics/DynamicsCircle";
import { DynamicsSegment } from "../dynamics/DynamicsDesk";
import { InsertMetricalAccentuation, InsertMetricalAccentuationOptions, MergeMetricalAccentuations } from "mpmify";
import { Accentuation, AccentuationPattern, AccentuationPatternDef } from "../../../mpm-ts/lib";
import { Pattern } from "./Pattern";
import { Delete } from "@mui/icons-material";
import { CellDrawer } from "./CellDrawer";
import { NameDialog } from "./NameDialog";
import { Preview } from "./Preview";
import { useSymbolicZoom } from "../hooks/ZoomProvider";
import { createPortal } from "react-dom";
import { Ribbon } from "../Ribbon";

type Pattern = (AccentuationPattern & { scale: number, length: number, children: Accentuation[] })

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

export const AccentuationDesk = ({ part, msm, mpm, addTransformer, appBarRef }: ScopedTransformerViewProps<InsertMetricalAccentuation | MergeMetricalAccentuations>) => {
    const { play, stop } = usePiano()
    const { slice } = useNotes()

    const [datePlayed, setDatePlayed] = useState<number>()
    const [segments, setSegments] = useState<DynamicsSegment[]>([])

    const [patterns, setPatterns] = useState<Pattern[]>([])
    const [selectedPatterns, setSelectedPatterns] = useState<Pattern[]>([])

    // creating a new metrical accentuation
    const [candidate, setCandidate] = useState<Omit<InsertMetricalAccentuationOptions, 'scope'>>()

    const [scaleTolerance, setScaleTolerance] = useState(1.5)
    const stretchX = useSymbolicZoom()

    const [nameDialogOpen, setNameDialogOpen] = useState(false)

    const stretchY = 10
    const margin = 20

    const getScreenY = (velocity: number) => {
        return (1 - velocity) * stretchY + 100
    }

    useEffect(() => setSegments(extractDynamicsSegments(msm, part)), [msm, part])

    useEffect(() => {
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
            .filter((i): i is Pattern => i !== null)

        setPatterns(patterns)
    }, [mpm, part])

    const handleInsert = (candidate: Omit<InsertMetricalAccentuationOptions, 'scope'>) => {
        if (!candidate) return
        addTransformer(new InsertMetricalAccentuation({
            ...candidate,
            scope: part,
        }))
        setCandidate(undefined)
    }

    const handleMerge = (name: string) => {
        addTransformer(new MergeMetricalAccentuations({
            names: selectedPatterns
                .map(c => c["name.ref"])
                .filter(n => n !== undefined) as string[],
            into: name,
            scope: part
        }))
        setSelectedPatterns([])
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
        if (!candidate) {
            setCandidate({
                from: segment.date.start,
                to: segment.date.end,
                beatLength: 0.125,
                name: 'new-pattern',
                scaleTolerance: 0,
                neutralEnd: true
            })
        }

        if (candidate && e.shiftKey) {
            candidate.to = segment.date.start
            setCandidate({ ...candidate })
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
                {createPortal((
                    <>
                        <Ribbon title='Metrical Accentuation'>
                            {selectedPatterns && (
                                <Button

                                    variant='contained'
                                    onClick={() => setNameDialogOpen(true)}
                                >
                                    Merge ({selectedPatterns.length})
                                </Button>
                            )}
                            {candidate && (
                                <Button
                                    variant='outlined'
                                    onClick={() => setCandidate(undefined)}
                                    startIcon={<Delete />}
                                >
                                    Clear Candidate
                                </Button>
                            )}
                        </Ribbon>
                    </>
                ), appBarRef.current || document.body)}
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

                {patterns.map((pattern) => {
                    return (
                        <Pattern
                            key={`cell_${pattern["xml:id"]}`}
                            pattern={pattern}
                            stretchX={stretchX}
                            stretchY={stretchY}
                            getScreenY={getScreenY}
                            denominator={msm.timeSignature?.denominator || 4}
                            onClick={() => {
                                if (selectedPatterns.includes(pattern)) {
                                    setSelectedPatterns(selectedPatterns.filter(p => p !== pattern))
                                }
                                else {
                                    setSelectedPatterns([...selectedPatterns, pattern])
                                }
                            }}
                            selected={selectedPatterns.includes(pattern)}
                        />
                    )
                })}

                {circles}
            </svg>

            {
                candidate && (
                    <>
                        <CellDrawer
                            cell={candidate}
                            open={true}
                            onClose={() => setCandidate(undefined)}
                            onDone={(candidate) => {
                                handleInsert(candidate)
                            }}
                        />
                        <Preview
                            cell={candidate}
                            segments={segments}
                            stretchX={stretchX}
                            getScreenY={getScreenY}
                            onClick={(e) => {
                                if (e.shiftKey && e.altKey) {
                                    setCandidate(undefined)
                                }
                            }}
                        />
                    </>
                )
            }

            {
                nameDialogOpen && (
                    <NameDialog
                        open={nameDialogOpen}
                        onClose={() => setNameDialogOpen(false)}
                        onDone={handleMerge}
                    />
                )
            }
        </div >
    )
}
