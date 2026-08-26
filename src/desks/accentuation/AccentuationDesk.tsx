import { type JSX, useCallback, useEffect, useState } from "react";
import { useScrollSync } from "../../hooks/ScrollSyncProvider";
import { usePiano } from "react-pianosound";
import { useNotes } from "../../hooks/NotesProvider";
import { asMIDI } from "../../utils/utils";
import { Scope, ScopedTransformerViewProps } from "../TransformerViewProps";
import { InsertMetricalAccentuation, InsertMetricalAccentuationOptions } from "../../fitting/transformers/accentuation/InsertMetricalAccentuation";
import { MergeMetricalAccentuations } from "../../fitting/transformers/accentuation/MergeMetricalAccentuations";
import { getDefinition, getInstructions, Instruction } from "../../fitting/instructions/index";
import { Alignment, AlignedNote } from "../../fitting/alignment";
import { Residual } from "../../fitting/residual";
import { Box, Button, Stack } from "@mui/material";
import { DynamicsCircle } from "../dynamics/DynamicsCircle";
import { DynamicsSegment } from "../dynamics/DynamicsDesk";
import { Pattern } from "./Pattern";
import { Add, Delete } from "@mui/icons-material";
import { AccentuationDialog } from "./AccentuationDialog";
import { NameDialog } from "./NameDialog";
import { Preview } from "./Preview";
import { useSymbolicZoom } from "../../hooks/ZoomProvider";
import { useCallSelection } from "../../hooks/CallSelection";
import { createPortal } from "react-dom";
import { Ribbon } from "../../components/Ribbon";
import { v4 } from "uuid";

/**
 * One `<accentuation>` of a pattern, as the def states it.
 *
 * espressivo keeps the four numbers as a positional tuple (`AccentuationTuple`, in Java's order
 * `[beat, value, transition.from, transition.to]`); this is that tuple named, so the drawing
 * code can go on reading `value` and `transitionTo`. All four are always numbers:
 * `AccentuationPatternDef` fills a missing `@transition.from` from `@value` and a missing
 * `@transition.to` from `@transition.from` while it parses.
 */
export interface Accentuation {
    beat: number
    value: number
    transitionFrom: number
    transitionTo: number
}

type Pattern = (Instruction<'accentuationPattern'> & { length: number, children: Accentuation[] })

const extractDynamicsSegments = (msm: Alignment, part: Scope, residual: Residual) => {
    const segments: DynamicsSegment[] = []
    msm.asChords(part).forEach((notes, date) => {
        if (!notes.length) return

        for (const note of notes) {
            // What the MPM does not yet explain about this note's loudness: recorded velocity
            // minus rendered.
            //
            // `undefined` is not zero, and the two are drawn differently. It means the MPM
            // cannot render the note at all, so there is no measurement to plot; a zero means
            // the dynamics curve already explains the note perfectly, which is a real reading
            // and sits on the centre line. An unmeasurable note gets no dot — which is also what
            // `InsertMetricalAccentuation.extractVelocities` does with it, so the desk shows
            // precisely the notes the fit will run on.
            const velocity = residual.of(note)?.velocity
            if (velocity === undefined) continue

            if (segments.findIndex(s => s.date.start === date && s.velocity === velocity) !== -1) continue
            segments.push({
                date: {
                    start: date,
                    end: date
                },
                velocity,
                active: false
            })
        }
    })

    return segments
}

export const AccentuationDesk = ({ part, msm, mpm, residual, addTransformer, appBarRef }: ScopedTransformerViewProps<InsertMetricalAccentuation | MergeMetricalAccentuations>) => {
    const { activeElements, setActiveElement } = useCallSelection();
    const { play, stop } = usePiano()
    const { slice } = useNotes()

    // Scroll sync - use callback ref to register when element mounts
    const { register, unregister } = useScrollSync();
    const scrollContainerRef = useCallback((element: HTMLDivElement | null) => {
        if (element) {
            register('accentuation-desk', element, 'symbolic');
        } else {
            unregister('accentuation-desk');
        }
    }, [register, unregister]);

    const [datePlayed, setDatePlayed] = useState<number>()
    const [segments, setSegments] = useState<DynamicsSegment[]>([])

    const [patterns, setPatterns] = useState<Pattern[]>([])
    const [selectedPatterns, setSelectedPatterns] = useState<Pattern[]>([])

    // creating a new metrical accentuation
    const [candidate, setCandidate] = useState<Omit<InsertMetricalAccentuationOptions, 'scope'>>()

    const [scaleTolerance, setScaleTolerance] = useState(0)
    const stretchX = useSymbolicZoom()

    const [nameDialogOpen, setNameDialogOpen] = useState(false)
    const [insertDialogOpen, setInsertDialogOpen] = useState(false)

    const stretchY = 10
    const margin = 20

    const getScreenY = (velocity: number) => {
        return (1 - velocity) * stretchY + 100
    }

    useEffect(() => setSegments(extractDynamicsSegments(msm, part, residual)), [msm, part, residual])

    useEffect(() => {
        const patterns = getInstructions(mpm, 'accentuationPattern', part)
            .map(i => {
                const def = getDefinition(mpm, 'accentuationPatternDef', i.accentuationPatternDefName)
                if (!def) return null

                // The def's own accessors, rather than fields on a record: an
                // `AccentuationPatternDef` is one of espressivo's live objects, and its
                // accentuations come out as `[beat, value, transition.from, transition.to]`
                // tuples paired with the elements they were read from.
                return {
                    length: def.getLength(),
                    children: def.getAllAccentuations().map(({ key: [beat, value, transitionFrom, transitionTo] }) => ({
                        beat, value, transitionFrom, transitionTo
                    })),
                    ...i
                }
            })
            .filter((i): i is Pattern => i !== null)

        setPatterns(patterns)
    }, [mpm, part])

    const handleInsert = (candidate: Omit<InsertMetricalAccentuationOptions, 'scope'>, newScaleTolerance: number) => {
        if (!candidate) return
        addTransformer(new InsertMetricalAccentuation({
            ...candidate,
            scaleTolerance: newScaleTolerance,
            scope: part,
        }))
        setScaleTolerance(newScaleTolerance)
        setCandidate(undefined)
        setInsertDialogOpen(false)
    }

    const handleMerge = (name: string) => {
        addTransformer(new MergeMetricalAccentuations({
            // No filter for a missing name: `@name.ref` is required on an
            // `<accentuationPattern>` — espressivo rejects one that lacks it while reading —
            // so every selected pattern names a def.
            names: selectedPatterns.map(c => c.accentuationPatternDefName),
            into: name,
            scope: part
        }))
        setSelectedPatterns([])
    }

    const handlePlay = (from: number, to?: number) => {
        let notes =
            slice(from, to).map(n => {
                // Play off the score grid, not off the recording: the recording states itself
                // in `milliseconds.date` / `milliseconds.date.end`, so dropping those two
                // leaves `asMIDI` to fall back to the symbolic date.
                const partial: Partial<AlignedNote> = { ...n }
                delete partial['milliseconds.date']
                delete partial['milliseconds.date.end']
                // The one place an unmeasurable residual folds back to zero, and it has to: a
                // note that is going to sound needs some velocity, and 40 is the baseline the
                // accentuation is auditioned against. Silence would be a louder claim than the
                // desk can make. The drawing does not do this — see `extractDynamicsSegments`.
                partial.velocity = 40 + (residual.of(n)?.velocity ?? 0)
                return partial as Omit<AlignedNote, 'milliseconds.date' | 'milliseconds.date.end'>
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
                name: `pattern-${v4().slice(0, 8)}`,
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

    const width = msm.end * stretchX
    const height = 300

    return (
        <div ref={scrollContainerRef} style={{ height: '400', overflow: 'scroll' }}>
            <Stack spacing={1} direction='column' sx={{ position: 'sticky', left: 0 }}>
                <Box sx={{ m: 1 }}>
                    {part !== 'global' && `Part ${part + 1}`}
                </Box>
                {appBarRef && createPortal((
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
                                <>
                                    <Button
                                        size='small'
                                        variant='outlined'
                                        onClick={() => setInsertDialogOpen(true)}
                                        startIcon={<Add />}
                                    >
                                        Insert
                                    </Button>
                                    <Button
                                        size='small'
                                        variant='outlined'
                                        onClick={() => setCandidate(undefined)}
                                        startIcon={<Delete />}
                                    >
                                        Clear Candidate
                                    </Button>
                                </>
                            )}
                        </Ribbon>
                    </>
                ), appBarRef?.current ?? document.body)}
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
                            key={`cell_${pattern.id}`}
                            pattern={pattern}
                            stretchX={stretchX}
                            stretchY={stretchY}
                            getScreenY={getScreenY}
                            denominator={msm.timeSignature?.denominator || 4}
                            onClick={(e) => {
                                if (e.shiftKey) {
                                    if (selectedPatterns.includes(pattern)) {
                                        setSelectedPatterns(selectedPatterns.filter(p => p !== pattern))
                                    }
                                    else {
                                        setSelectedPatterns([...selectedPatterns, pattern])
                                    }
                                }
                                else if (pattern.id !== undefined) {
                                    // `@xml:id` is optional on an espressivo instruction, so
                                    // the round trip between a drawn pattern and the call that
                                    // wrote it is guarded. Every one the chain writes has one.
                                    setActiveElement(pattern.id)
                                }
                            }}
                            selected={selectedPatterns.includes(pattern) || (pattern.id !== undefined && activeElements.includes(pattern.id))}
                        />
                    )
                })}

                {circles}

                {candidate && (
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
                )}
            </svg>

            {candidate && (
                <AccentuationDialog
                    open={insertDialogOpen}
                    onClose={() => setInsertDialogOpen(false)}
                    cell={candidate}
                    scaleTolerance={scaleTolerance}
                    onDone={handleInsert}
                />
            )}

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
