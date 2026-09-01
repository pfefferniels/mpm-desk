import { type JSX, type MouseEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useScrollRegistration } from "../../hooks/useScrollRegistration";
import { usePiano } from "../../performance/piano";
import { useNotes } from "../../hooks/NotesProvider";
import { asMIDI } from "../../utils/utils";
import { Scope, ScopedTransformerViewProps } from "../TransformerViewProps";
import { InsertMetricalAccentuation } from "../../fitting/transformers/accentuation/InsertMetricalAccentuation";
import { MergeMetricalAccentuations } from "../../fitting/transformers/accentuation/MergeMetricalAccentuations";
import { getDefinition, getInstructions, Instruction } from "../../fitting/instructions/index";
import { Alignment, AlignedNote } from "../../fitting/alignment";
import { bars as barsOf } from "../../fitting/timeSignature";
import { PULSES_PER_WHOLE } from "../../fitting/ppq";
import { Residual } from "../../fitting/residual";
import { Box } from "@mui/material";
import { DynamicsCircle } from "../dynamics/DynamicsCircle";
import { DynamicsSegment } from "../dynamics/DynamicsDesk";
import { Pattern } from "./Pattern";
import { Add, Delete, Merge } from "@mui/icons-material";
import { AccentuationDialog } from "./AccentuationDialog";
import { NameDialog } from "./NameDialog";
import { Preview } from "./Preview";
import { useSymbolicZoom } from "../../hooks/ZoomProvider";
import { useCallSelection } from "../../hooks/CallSelection";
import { svgPoint } from "../../utils/svgPoint";
import { afterClick, fittable, isPending, type Candidate, type Cell } from "./candidate";
import { DeskToolbar } from "../../components/DeskToolbar";
import { ToolGroup } from "../../components/toolbar/ToolGroup";
import { ToolbarButton } from "../../components/toolbar/ToolbarButton";
import { ToolStatus } from "../../components/toolbar/ToolStatus";
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

export const AccentuationDesk = ({ part, msm, mpm, residual, addTransformer }: ScopedTransformerViewProps<InsertMetricalAccentuation | MergeMetricalAccentuations>) => {
    const { activeElements, setActiveElement } = useCallSelection();
    const { play, stop } = usePiano()
    const { slice } = useNotes()

    const scrollContainerRef = useScrollRegistration('accentuation-desk', 'symbolic');

    const [datePlayed, setDatePlayed] = useState<number>()
    const [selectedPatterns, setSelectedPatterns] = useState<Pattern[]>([])

    // creating a new metrical accentuation
    const [candidate, setCandidate] = useState<Candidate>()
    /** The date under the pointer, tracked only while a candidate is waiting for its second click. */
    const [cursor, setCursor] = useState<number>()

    const [scaleTolerance, setScaleTolerance] = useState(0)
    const stretchX = useSymbolicZoom()

    const [nameDialogOpen, setNameDialogOpen] = useState(false)
    const [insertDialogOpen, setInsertDialogOpen] = useState(false)

    const stretchY = 10
    const margin = 20

    const getScreenY = (velocity: number) => {
        return (1 - velocity) * stretchY + 100
    }

    const segments = useMemo(
        () => extractDynamicsSegments(msm, part, residual),
        [msm, part, residual],
    )

    /**
     * The bars the score is written in, as the metre states them.
     *
     * A cell fitted here is meant to be one bar — espressivo numbers a pattern's beats from the
     * bar line it falls in, whatever the instruction's own date — and until these were drawn the
     * two dots that bound a cell had to be picked by eye.
     */
    const bars = useMemo(
        () => barsOf(msm.timeSignatures, msm.end, PULSES_PER_WHOLE).map(bar => bar.date),
        [msm],
    )

    const pending = isPending(candidate)
    const cell = candidate !== undefined && fittable(candidate) ? candidate : undefined

    const clearCandidate = useCallback(() => {
        setCandidate(undefined)
        setCursor(undefined)
    }, [])

    // Escape drops the candidate wherever the focus is, as it does on the desks that draw. Not
    // while a dialog stands, where Escape is the dialog's own way out.
    const dialogOpen = insertDialogOpen || nameDialogOpen
    useEffect(() => {
        if (!candidate || dialogOpen) return

        const cancelOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') clearCandidate()
        }
        document.addEventListener('keydown', cancelOnEscape)
        return () => document.removeEventListener('keydown', cancelOnEscape)
    }, [candidate, dialogOpen, clearCandidate])

    const patterns = useMemo(() => getInstructions(mpm, 'accentuationPattern', part)
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
        .filter((i): i is Pattern => i !== null),
        [mpm, part])

    const handleInsert = (cell: Cell, newScaleTolerance: number) => {
        addTransformer(new InsertMetricalAccentuation({
            ...cell,
            scaleTolerance: newScaleTolerance,
            scope: part,
        }))
        setScaleTolerance(newScaleTolerance)
        clearCandidate()
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

    /**
     * The date a gesture at `svgX` means: the nearest date the plot draws a dot on.
     *
     * A dot is three pixels wide and the plot is dense, so asking a click to hit one was the
     * fiddly half of marking a range. Nearest-date means a click anywhere in a dot's column
     * lands on it — and on the very date the pending preview has already snapped to.
     */
    const nearestDate = (svgX: number) => {
        if (!segments.length) return undefined
        const target = svgX / stretchX
        return segments.reduce(
            (best, s) => Math.abs(s.date.start - target) < Math.abs(best - target) ? s.date.start : best,
            segments[0].date.start,
        )
    }

    const dateUnder = (event: MouseEvent<SVGSVGElement>) => {
        const point = svgPoint(event.currentTarget, event.clientX, event.clientY)
        return point === null ? undefined : nearestDate(point.x)
    }

    const handleMouseMove = (event: MouseEvent<SVGSVGElement>) => {
        if (!pending) return
        const date = dateUnder(event)
        if (date === undefined || date === cursor) return
        setCursor(date)
    }

    const handleClick = (event: MouseEvent<SVGSVGElement>) => {
        const date = dateUnder(event)
        if (date === undefined) return

        const { shiftKey } = event
        setCursor(date)
        setCandidate(prev => afterClick(prev, date, shiftKey, () => `pattern-${v4().slice(0, 8)}`))
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
            />
        )
    })

    const width = msm.end * stretchX
    const height = 300

    return (
        <div ref={scrollContainerRef} style={{ height: '400', overflow: 'scroll' }}>
            {/*
                The `Stack` that used to be here wrapped this `Box` and the `DeskToolbar`, and the
                toolbar portals into the app bar — so the stack was laying out one child and a hole.
                What it was really doing was holding the caption still while the plot scrolls
                sideways under it, which is a property of the caption; the sticky positioning moves
                onto the caption and the stack goes.
            */}
            <Box sx={{ m: 1, position: 'sticky', left: 0 }}>
                {part !== 'global' && `Part ${part + 1}`}
            </Box>
            <DeskToolbar>
                {/*
                    Unlabelled, because a group caption is never the desk's own name and `Metrical
                    Accentuation` was exactly that.

                    Every control in this bar used to be conditional, which made this the desk that
                    proved the rule: with no candidate and nothing selected the group collapsed to
                    an empty labelled box and a dangling rule, and that was the state it sat in most
                    of the time. All four are mounted now and say why they cannot be used.

                    Merge was `contained` and is not the primary. It tidies patterns the desk has
                    already written; `Insert` is the one that writes one, so `Insert` is what this
                    desk is for.

                    The bug the `disabled` fixes: Merge was guarded by `{selectedPatterns && …}`
                    over a `useState<Pattern[]>([])`, and an empty array is truthy — so `Merge (0)`
                    rendered always, and clicking it opened the name dialog and committed a
                    `MergeMetricalAccentuations` with `names: []`. A merge of one was reachable the
                    same way. Two is the smallest number of patterns a merge means anything for.
                */}
                <ToolGroup>
                    <ToolbarButton
                        primary
                        icon={<Add fontSize='small' />}
                        label='Insert'
                        tooltip={!candidate
                            ? 'Click the plot to start a candidate range'
                            : pending
                                ? 'Click again to close the range where the preview ends'
                                : cell
                                    ? 'Fit a metrical accentuation pattern to the candidate range'
                                    : 'Shift-click elsewhere to give the candidate a length'}
                        disabled={!cell}
                        onClick={() => setInsertDialogOpen(true)}
                    >
                        Insert
                    </ToolbarButton>
                    {/* No readout for the candidate: `Preview` draws it on the plot, where it is
                        far more legible than a range of ticks would be here. */}
                    <ToolbarButton
                        icon={<Delete fontSize='small' />}
                        label='Clear Candidate'
                        tooltip={candidate
                            ? 'Drop the candidate range and start marking again (Esc)'
                            : 'No candidate to clear'}
                        disabled={!candidate}
                        onClick={clearCandidate}
                    >
                        Clear Candidate
                    </ToolbarButton>
                    <ToolbarButton
                        icon={<Merge fontSize='small' />}
                        label='Merge'
                        tooltip={selectedPatterns.length < 2
                            ? 'Shift-click two or more patterns on the plot to merge them'
                            : `Merge the ${selectedPatterns.length} selected patterns into one`}
                        disabled={selectedPatterns.length < 2}
                        onClick={() => setNameDialogOpen(true)}
                    >
                        Merge
                    </ToolbarButton>
                    <ToolStatus width={88}>{`${selectedPatterns.length} selected`}</ToolStatus>
                </ToolGroup>
            </DeskToolbar>

            {/*
                The gesture lives on the surface rather than on the dots. A click is answered by
                the nearest date, so it need not land on a dot at all, and the pointer keeps
                reporting while it crosses one — which a preview that follows the cursor depends
                on, since the dots are exactly what it is drawn between.
            */}
            <svg
                className='accentuationPlot'
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
                style={{ cursor: pending ? 'crosshair' : undefined }}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setCursor(undefined)}
                onClick={handleClick}
            >
                {/*
                    The surface a gesture in the gaps lands on. `nearestDate` answers where a
                    click means, so the dots need no hit geometry of their own — but the space
                    between them has to be hit for that to be true, and the root `<svg>`'s own
                    background is not something to rely on for it.
                */}
                <rect
                    className='pickSurface'
                    x={-margin}
                    y={-margin}
                    width={width + margin}
                    height={height + margin}
                    fill='transparent'
                />

                <g className='barLines' pointerEvents='none'>
                    {bars.map(tick => (
                        <line
                            key={`bar_${tick}`}
                            x1={tick * stretchX}
                            x2={tick * stretchX}
                            y1={-margin}
                            y2={height}
                            stroke='#e5e7eb'
                            strokeWidth={1}
                        />
                    ))}
                </g>

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
                            signature={msm.timeSignatureAt(pattern.date)}
                            onClick={(e) => {
                                // The plot underneath turns a click into a candidate. This one
                                // is spoken for.
                                e.stopPropagation()
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
                        candidate={candidate}
                        cursor={cursor}
                        height={height}
                        segments={segments}
                        stretchX={stretchX}
                        getScreenY={getScreenY}
                        onClick={(e) => {
                            if (e.shiftKey && e.altKey) {
                                e.stopPropagation()
                                clearCandidate()
                            }
                        }}
                    />
                )}
            </svg>

            {cell && (
                <AccentuationDialog
                    open={insertDialogOpen}
                    onClose={() => setInsertDialogOpen(false)}
                    cell={cell}
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
