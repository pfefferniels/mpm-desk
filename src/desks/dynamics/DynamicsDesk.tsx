import { type JSX, useEffect, useMemo, useRef, useState } from "react";
import { useScrollRegistration } from "../../hooks/useScrollRegistration";
import { usePiano } from "react-pianosound";
import { useNotes } from "../../hooks/NotesProvider";
import { asMIDI } from "../../utils/utils";
import { Scope, ScopedTransformerViewProps } from "../TransformerViewProps";
import { DynamicsWithEndDate, InsertDynamicsInstructions } from "../../fitting/transformers/dynamics/InsertDynamicsInstructions";
import { Modify, ModifyOptions } from "../../fitting/transformers/modification/Modify";
import { Alignment, AlignedNote } from "../../fitting/alignment";
import { getInstructions } from "../../fitting/instructions/index";
import { Range } from "../tempo/Tempo";
import { Box, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { CurveSegment } from "./CurveSegment";
import { DynamicsCircle } from "./DynamicsCircle";
import { VerticalScale } from "./VerticalScale";
import { useSymbolicZoom } from "../../hooks/ZoomProvider";
import { useCallSelection } from "../../hooks/CallSelection";
import { DeskToolbar } from "../../components/DeskToolbar";
import { ToolGroup } from "../../components/toolbar/ToolGroup";
import { ToolbarButton } from "../../components/toolbar/ToolbarButton";
import { ToolStatus } from "../../components/toolbar/ToolStatus";
import { Add, Clear } from "@mui/icons-material";
import { MarkedRegion } from "./MarkedRegion";
import { svgPoint, svgUnitsPerPixel } from "../../utils/svgPoint";

export interface DynamicsSegment {
    date: Range
    velocity: number
    active: boolean
    noteID?: string
}

const extractDynamicsSegments = (msm: Alignment, part: Scope) => {
    const segments: DynamicsSegment[] = []
    msm.asChords(part).forEach((notes, date) => {
        if (!notes.length) return

        for (const note of notes) {
            if (segments.findIndex(s => s.date.start === date && s.velocity === note.velocity) !== -1) continue
            segments.push({
                date: {
                    start: date,
                    end: date
                },
                velocity: note.velocity,
                active: false,
                noteID: note['xml:id']
            })
        }
    })

    return segments
}

export const DynamicsDesk = ({ part, msm, mpm, addTransformer }: ScopedTransformerViewProps<
    InsertDynamicsInstructions | Modify
>) => {
    const { activeElements, setActiveElement, calls } = useCallSelection();
    const [datePlayed, setDatePlayed] = useState<number>()
    const [currentPhantomDate, setCurrentPhantomDate] = useState<number>()
    const [mode, setMode] = useState<'insert' | 'modify' | 'phantom'>('insert')

    const [phantomVelocities, setPhantomVelocities] = useState<Map<number, number>>(new Map())
    const [dragFrom, setDragFrom] = useState<{ date: number, x: number, y: number }>()
    const [dragMouse, setDragMouse] = useState<{ x: number, y: number }>()
    const [dragSnapDate, setDragSnapDate] = useState<number>()
    const [pendingInsert, setPendingInsert] = useState<{ from: number, to: number }>()
    const [modifyOptions, setModifyOptions] = useState<ModifyOptions>()
    const [pendingCommitOptions, setPendingCommitOptions] = useState<ModifyOptions>()
    const [modifyDrag, setModifyDrag] = useState<{ startSvgY: number }>()
    const [modifyDragDelta, setModifyDragDelta] = useState(0)

    const { play, stop } = usePiano()
    const { slice } = useNotes()
    const stretchX = useSymbolicZoom()
    const svgRef = useRef<SVGSVGElement>(null);

    const scrollContainerRef = useScrollRegistration('dynamics-desk', 'symbolic');

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return

            e.preventDefault()
            if (!currentPhantomDate || !mode) return

            setPhantomVelocities(prev => {
                const entry = prev.get(currentPhantomDate)
                if (entry === undefined) return prev

                const next = new Map(prev)
                next.set(currentPhantomDate, entry + (e.key === 'ArrowUp' ? 1 : -1))
                return next
            })
        }

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [currentPhantomDate, mode]);

    const instructions = useMemo(() => {
        const dynamics = getInstructions(mpm, 'dynamics', part)
        const withEndDate: DynamicsWithEndDate[] = []
        for (let i = 0; i < dynamics.length; i++) {
            // Where the curve stops is the next `<dynamics>`, and nothing else. There is no
            // `@endDate` attribute in MPM to prefer instead: `InsertDynamicsInstructions` takes
            // the fitted end back off before writing, so nothing carries one into the document.
            // A curve nothing follows has no span to draw, and is skipped.
            const endDate = dynamics[i + 1]?.date
            if (endDate === undefined) continue

            withEndDate.push({
                ...dynamics[i],
                endDate
            })
        }
        return withEndDate
    }, [mpm, part])

    const segments = useMemo(() => extractDynamicsSegments(msm, part), [msm, part])

    // Both optimistic previews are answered by the next fit: the drawn curve is in `mpm` by then,
    // the dragged velocities are in `msm`. Clearing them is the one thing the effects that used to
    // derive `instructions` and `segments` did besides deriving, and it is not derived state, so
    // it stays. It runs during render — React's way of adjusting state when a prop changes — and
    // not in an effect, which would commit the stale preview over the new fit for one frame.
    const [lastFit, setLastFit] = useState({ mpm, msm, part })
    if (lastFit.mpm !== mpm || lastFit.msm !== msm || lastFit.part !== part) {
        if (lastFit.mpm !== mpm || lastFit.part !== part) setPendingInsert(undefined)
        if (lastFit.msm !== msm || lastFit.part !== part) setPendingCommitOptions(undefined)
        setLastFit({ mpm, msm, part })
    }

    const stretchY = 3
    const margin = 20
    const chartHeight = 300 + margin
    // Wide enough for the tick, its gap and a three-digit velocity at font size 8.
    const scaleWidth = 34
    // The axis line sits on x = 0 and is 1.5 wide, so the gutter's viewBox has to reach a hair
    // past it — an outermost <svg> clips to its viewport, and half the stroke would go missing.
    const axisBleed = 1

    const modifyDeltas = useMemo(() => {
        const deltas = new Map<string, number>()
        // The chain as the work file records it: a call is a name and the options it ran with.
        // The options of a `Modify` are plain JSON, so they can be read straight off the call.
        for (const t of calls) {
            if (t.name !== 'Modify') continue
            const opts = t.options as unknown as ModifyOptions
            if (opts.aspect !== 'velocity') continue
            if (opts.scope !== undefined && opts.scope !== 'global' && opts.scope !== part) continue
            if ('noteIDs' in opts) {
                for (const nid of opts.noteIDs) {
                    deltas.set(nid, (deltas.get(nid) ?? 0) + opts.change)
                }
            } else if ('from' in opts && 'to' in opts) {
                for (const note of msm.notesInRange(opts.from, opts.to, part)) {
                    const nid = note['xml:id']
                    deltas.set(nid, (deltas.get(nid) ?? 0) + opts.change)
                }
            }
        }

        // Subtract pending commit delta — it's in the transformer list but not yet
        // reflected in the MSM, so including it would flip the committed ghost direction
        if (pendingCommitOptions && pendingCommitOptions.aspect === 'velocity') {
            const applyDelta = (nid: string) => {
                const cur = deltas.get(nid) ?? 0
                const adjusted = cur - pendingCommitOptions.change
                if (adjusted === 0) deltas.delete(nid)
                else deltas.set(nid, adjusted)
            }
            if ('noteIDs' in pendingCommitOptions) {
                for (const nid of pendingCommitOptions.noteIDs) applyDelta(nid)
            } else if ('from' in pendingCommitOptions && 'to' in pendingCommitOptions) {
                for (const note of msm.notesInRange(pendingCommitOptions.from, pendingCommitOptions.to, part)) {
                    applyDelta(note['xml:id'])
                }
            }
        }

        return deltas
    }, [calls, msm, part, pendingCommitOptions])

    const findNearestDate = (svgX: number, snapThreshold: number) => {
        let bestDate: number | undefined
        let bestDist = Infinity
        for (const seg of segments) {
            const edgeX = seg.date.start * stretchX
            const dist = Math.abs(svgX - edgeX)
            if (dist < bestDist) {
                bestDist = dist
                bestDate = seg.date.start
            }
        }
        return bestDist <= snapThreshold ? bestDate : undefined
    }

    const cancelDrag = () => {
        setDragFrom(undefined)
        setDragMouse(undefined)
        setDragSnapDate(undefined)
    }

    const isNoteAffectedBy = (noteID: string | undefined, options: ModifyOptions | undefined) => {
        if (!noteID || !options) return false
        if ('noteIDs' in options) return options.noteIDs.includes(noteID)
        if ('from' in options && 'to' in options) {
            return msm.notesInRange(options.from, options.to, part)
                .some(n => n['xml:id'] === noteID)
        }
        return false
    }

    const isNoteAffected = (noteID: string | undefined) => isNoteAffectedBy(noteID, modifyOptions)

    const handleModifyDragStart = (segment: DynamicsSegment, clientY: number) => {
        if (mode !== 'modify') return
        const svg = svgRef.current
        if (!svg) return

        const noteid = msm.allNotes.find(n => n.velocity === segment.velocity && n.date === segment.date.start)?.["xml:id"]
        if (!noteid) return

        // Where the drag starts is what every later delta is measured against, so without it
        // there is no drag to begin — and no selection to change either.
        const pt = svgPoint(svg, 0, clientY)
        if (!pt) return

        // If dragged circle is not in current selection, replace selection with just this note
        if (!modifyOptions || !isNoteAffected(noteid)) {
            setModifyOptions({
                scope: part,
                aspect: 'velocity',
                change: 0,
                noteIDs: [noteid]
            })
        }

        setModifyDrag({ startSvgY: pt.y })
        setModifyDragDelta(0)
    }

    const handleModifyMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        if (!modifyDrag) return
        const pt = svgPoint(e.currentTarget, e.clientX, e.clientY)
        if (!pt) return
        let delta = Math.round((modifyDrag.startSvgY - pt.y) / stretchY)

        // Clamp: ensure no selected note goes below 0 or above 127
        const affectedSegments = segments.filter(s => isNoteAffected(s.noteID))
        for (const seg of affectedSegments) {
            const newVel = seg.velocity + delta
            if (newVel > 127) delta = 127 - seg.velocity
            if (newVel < 0) delta = -seg.velocity
        }

        setModifyDragDelta(delta)
    }

    const handleModifyMouseUp = () => {
        if (!modifyDrag) return
        if (modifyOptions) {
            setModifyOptions({ ...modifyOptions, change: modifyDragDelta })
        }
        setModifyDrag(undefined)
    }

    const handleModifyMouseLeave = () => {
        if (modifyDrag) {
            setModifyDrag(undefined)
            setModifyDragDelta(0)
        }
    }

    /**
     * The dragged change becomes a `Modify` call.
     *
     * `pendingCommitOptions` holds what was just sent until the fit comes back with it: the note
     * is drawn at its new velocity straight away, and the ghost that marks the committed delta
     * subtracts this until the MSM agrees — see `modifyDeltas`.
     */
    const commitModify = () => {
        if (!modifyOptions) return

        addTransformer(new Modify(modifyOptions))
        setPendingCommitOptions(modifyOptions)
        setModifyOptions(undefined)
        setModifyDragDelta(0)
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
        if (mode === 'phantom') {
            setPhantomVelocities(prev => {
                const next = new Map(prev)
                next.set(segment.date.start, segment.velocity)
                return next
            })
            setCurrentPhantomDate(segment.date.start)
            return
        }
        else if (mode === 'modify') {
            const noteid = msm.allNotes.find(n => n.velocity === segment.velocity && n.date === segment.date.start)?.["xml:id"]
            if (!noteid) {
                return
            }

            if (!modifyOptions) {
                // Create a noteid choice if none exists.
                setModifyOptions({
                    scope: part,
                    aspect: 'velocity',
                    change: 0,
                    noteIDs: [noteid]
                })
            }
            else if ('noteIDs' in modifyOptions && e.metaKey) {
                // Cmd/Ctrl key adds a noteid to the existing choice. A new array, because the
                // spread below is shallow: pushing into the old one would carry the same array
                // into the "new" options, and a consumer comparing references sees no change.
                setModifyOptions({ ...modifyOptions, noteIDs: [...modifyOptions.noteIDs, noteid] })
            }
            else if (e.shiftKey) {
                // Shift key always refers to a range choice. 
                // If the existing choice is a pure noteid choice,
                // we convert it to a range choice.
                if ('noteIDs' in modifyOptions) {
                    const existingNotes = msm.allNotes.filter(n => modifyOptions.noteIDs.includes(n["xml:id"]))
                    const fromDate = Math.min(...existingNotes.map(n => n.date))
                    setModifyOptions({
                        from: fromDate,
                        to: segment.date.start,
                        scope: part,
                        aspect: 'velocity',
                        change: 0
                    })
                }
                else {
                    setModifyOptions({ ...modifyOptions, to: segment.date.start })
                }
            }
        }
    }

    const circles: JSX.Element[] = []

    phantomVelocities.forEach((velocity, date) => {
        circles.push(
            <text
                key={`phantom_velocity_${date}`}
                x={date * stretchX}
                y={(127 - velocity) * stretchY}
                fill='darkred'
                textAnchor='middle'
                dominantBaseline='middle'
                onClick={(e) => {
                    if (e.altKey && e.shiftKey) {
                        setPhantomVelocities(prev => {
                            const next = new Map(prev)
                            next.delete(date)
                            return next
                        })
                    }
                }}
            >
                x
            </text>
        )
    })

    segments.forEach((segment, i) => {
        const committedDelta = segment.noteID ? modifyDeltas.get(segment.noteID) : undefined
        if (committedDelta && committedDelta !== 0) {
            const originalVelocity = segment.velocity - committedDelta
            const curX = segment.date.start * stretchX
            const curY = (127 - segment.velocity) * stretchY
            const origY = (127 - originalVelocity) * stretchY
            circles.push(
                <line
                    key={`ghost_line_${segment.date}_${i}`}
                    x1={curX}
                    y1={origY}
                    x2={curX}
                    y2={curY}
                    stroke="#999"
                    strokeWidth={1}
                    strokeDasharray="3 2"
                    strokeOpacity={0.5}
                />
            )
            circles.push(
                <circle
                    key={`ghost_dot_${segment.date}_${i}`}
                    cx={curX}
                    cy={origY}
                    r={3}
                    fill="none"
                    stroke="#999"
                    strokeWidth={1.5}
                    strokeOpacity={0.6}
                />
            )
        }

        // Compute yOffset for pending modification preview
        const affected = isNoteAffected(segment.noteID)
        const affectedByPendingCommit = isNoteAffectedBy(segment.noteID, pendingCommitOptions)
        let yOffset = 0
        if (affected) {
            if (modifyDrag) {
                // During active drag
                yOffset = -modifyDragDelta * stretchY
            } else if (modifyOptions && modifyOptions.change !== 0) {
                // After drag release, pending commit
                yOffset = -modifyOptions.change * stretchY
            }
        }
        if (affectedByPendingCommit && pendingCommitOptions) {
            // Waiting for pipeline to process committed transformer
            yOffset = -pendingCommitOptions.change * stretchY
        }

        // Pending modification ghost indicators (distinct from committed ghosts)
        if ((affected || affectedByPendingCommit) && yOffset !== 0) {
            const curX = segment.date.start * stretchX
            const origY = (127 - segment.velocity) * stretchY
            circles.push(
                <line
                    key={`pending_ghost_line_${segment.date}_${i}`}
                    x1={curX}
                    y1={origY}
                    x2={curX}
                    y2={origY + yOffset}
                    stroke="hsl(220, 60%, 50%)"
                    strokeWidth={1}
                    strokeDasharray="3 2"
                    strokeOpacity={0.6}
                />
            )
            circles.push(
                <circle
                    key={`pending_ghost_dot_${segment.date}_${i}`}
                    cx={curX}
                    cy={origY}
                    r={3}
                    fill="none"
                    stroke="hsl(220, 60%, 50%)"
                    strokeWidth={1.5}
                    strokeOpacity={0.7}
                />
            )
        }

        circles.push(
            <DynamicsCircle
                key={`velocity_segment_${segment.date}_${i}`}
                segment={segment}
                datePlayed={datePlayed}
                stretchX={stretchX}
                screenY={(velocity: number) => (127 - velocity) * stretchY}
                handlePlay={handlePlay}
                handleClick={handleClick}
                cursor={mode === 'insert' ? 'crosshair' : mode === 'modify' ? 'ns-resize' : undefined}
                onDragStart={mode === 'modify' ? handleModifyDragStart : undefined}
                yOffset={yOffset}
            />
        )
    })

    // `@xml:id` is optional on an espressivo instruction, so the round trip between a drawn
    // curve and the call that wrote it is guarded. Every `<dynamics>` the chain writes carries
    // one — `auditInstructions` reports an unnamed instruction as a bug — but a document from
    // elsewhere need not, and such a curve simply cannot be selected.
    const curves = instructions.map(i => {
        return (
            <CurveSegment
                active={i.id !== undefined && activeElements.includes(i.id)}
                instruction={i}
                stretchX={stretchX}
                stretchY={stretchY}
                onClick={() => {
                    if (i.id !== undefined) setActiveElement(i.id)
                }}
            />
        )
    })

    return (
        <div>
            <Box sx={{ m: 1 }}>{part !== 'global' && `Part ${part + 1}`}</Box>
            <DeskToolbar>
                <ToolGroup label='Mode'>
                    <ToggleButtonGroup
                        value={mode}
                        exclusive
                        // An exclusive group answers a click on the pressed button with `null`,
                        // and this desk has no "no mode" — dropping that click leaves the mode
                        // where it was, which is what a three-way switch should do.
                        onChange={(_, newMode) => {
                            if (newMode !== null) {
                                setMode(newMode)
                            }
                        }}
                        size='small'
                    >
                        <ToggleButton value='insert'>Insert</ToggleButton>
                        <ToggleButton value='modify'>Modify</ToggleButton>
                        <ToggleButton value='phantom'>Phantom</ToggleButton>
                    </ToggleButtonGroup>
                </ToolGroup>

                {/*
                    Both buttons, in every mode.

                    These were two groups behind `mode === 'modify' &&` and `mode === 'phantom'
                    &&`, so switching mode mounted a whole captioned group and shoved everything
                    to its right — the largest reflow in the bar, on the control the user reaches
                    for most. Disabled says the same thing without moving anything, and the
                    tooltip says which mode would make it live.

                    It also makes the modes self-documenting: Phantom's one action is legible from
                    Insert mode, so the user can see what a mode offers before entering it.
                */}
                <ToolGroup>
                    <ToolbarButton
                        primary
                        icon={<Add />}
                        label='Modify'
                        tooltip={mode !== 'modify'
                            ? 'Switch to Modify mode to change velocities'
                            : !modifyOptions || modifyOptions.change === 0
                                ? 'Drag a note up or down first — there is no change to apply'
                                : `Apply ${modifyOptions.change > 0 ? '+' : ''}${modifyOptions.change} to the selected notes`}
                        disabled={mode !== 'modify' || !modifyOptions || modifyOptions.change === 0}
                        onClick={commitModify}
                    >
                        Modify
                    </ToolbarButton>
                    {/* The change was in the button's label, so committing `+9` and then `+10`
                        resized the button between two clicks at the same place. */}
                    <ToolStatus width={40}>
                        {modifyOptions && modifyOptions.change !== 0
                            ? `${modifyOptions.change > 0 ? '+' : ''}${modifyOptions.change}`
                            : '—'}
                    </ToolStatus>
                    {/* "Clear", with the "Phantoms" caption gone and the button never leaving the
                        bar, would read as clearing the modification beside it. */}
                    <ToolbarButton
                        icon={<Clear />}
                        label='Clear Phantoms'
                        tooltip={phantomVelocities.size === 0
                            ? 'No phantom velocities to clear'
                            : `Discard the ${phantomVelocities.size} phantom ${phantomVelocities.size === 1 ? 'velocity' : 'velocities'}`}
                        disabled={phantomVelocities.size === 0}
                        onClick={() => setPhantomVelocities(new Map())}
                    >
                        Clear Phantoms
                    </ToolbarButton>
                </ToolGroup>
            </DeskToolbar>

            {/*
                The scale used to float over the chart in an absolutely positioned overlay, so
                the plot began underneath it: the axis landed 12px to the right of velocity at
                date 0, the labels sat on top of the first notes, and every note scrolled *under*
                the axis rather than past it.

                It has a column of its own now. The gutter is laid out beside the scroller, so
                the chart simply starts where the scale ends and nothing can be drawn behind it.
                Both are `chartHeight` tall with a viewBox of the same extent, so one pixel is one
                unit in both and a tick still meets the velocity it names.
            */}
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <svg
                    style={{ flex: '0 0 auto' }}
                    width={scaleWidth}
                    height={chartHeight}
                    viewBox={`${-scaleWidth + axisBleed} 0 ${scaleWidth} ${chartHeight}`}
                >
                    <VerticalScale
                        min={10}
                        max={80}
                        step={5}
                        height={chartHeight}
                        stretchY={stretchY}
                    />
                </svg>

                <div
                    ref={scrollContainerRef}
                    style={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden' }}
                >
                    <svg
                        ref={svgRef}
                        width={msm.end * stretchX + margin}
                        height={chartHeight}
                        viewBox={
                            [
                                -margin,
                                0,
                                msm.end * stretchX + margin,
                                chartHeight
                            ].join(' ')
                        }
                        onMouseDown={mode === 'insert' ? (e) => {
                            const svg = e.currentTarget
                            const pt = svgPoint(svg, e.clientX, e.clientY)
                            if (!pt) return
                            const snapDate = findNearestDate(pt.x, 20 * svgUnitsPerPixel(svg))
                            if (snapDate !== undefined) {
                                setDragFrom({ date: snapDate, x: snapDate * stretchX, y: pt.y })
                            }
                        } : undefined}
                        onMouseMove={mode === 'insert' ? (e) => {
                            if (!dragFrom) return
                            const svg = e.currentTarget
                            const pt = svgPoint(svg, e.clientX, e.clientY)
                            if (!pt) return
                            setDragMouse(pt)
                            const snap = findNearestDate(pt.x, 20 * svgUnitsPerPixel(svg))
                            setDragSnapDate(snap !== undefined && snap > dragFrom.date ? snap : undefined)
                        } : mode === 'modify' ? handleModifyMouseMove : undefined}
                        onMouseUp={mode === 'insert' ? () => {
                            if (dragFrom && dragSnapDate) {
                                setPendingInsert({ from: dragFrom.date, to: dragSnapDate })
                                addTransformer(new InsertDynamicsInstructions({
                                    from: dragFrom.date,
                                    to: dragSnapDate,
                                    phantomVelocities,
                                    scope: part
                                }))
                            }
                            cancelDrag()
                        } : mode === 'modify' ? handleModifyMouseUp : undefined}
                        onMouseLeave={mode === 'insert' ? () => cancelDrag() : mode === 'modify' ? handleModifyMouseLeave : undefined}
                    >
                        {curves}
                        {circles}

                        {/* Drag preview line */}
                        {dragFrom && dragMouse && (
                            <line
                                x1={dragFrom.x}
                                y1={dragFrom.y}
                                x2={dragSnapDate !== undefined ? dragSnapDate * stretchX : dragMouse.x}
                                y2={dragMouse.y}
                                stroke="gold"
                                strokeWidth={2}
                                strokeDasharray="6 4"
                                pointerEvents="none"
                            />
                        )}

                        {/* Snap indicator circles */}
                        {dragFrom && (
                            <circle
                                cx={dragFrom.x} cy={dragFrom.y} r={4}
                                fill="gold" stroke="gold" strokeWidth={1}
                                pointerEvents="none"
                            />
                        )}
                        {dragFrom && dragSnapDate !== undefined && dragMouse && (
                            <circle
                                cx={dragSnapDate * stretchX} cy={dragMouse.y} r={4}
                                fill="gold" stroke="gold" strokeWidth={1}
                                pointerEvents="none"
                            />
                        )}

                        {/* Optimistic preview while transformer processes */}
                        {pendingInsert && (() => {
                            const pts = segments
                                .filter(s => s.date.start >= pendingInsert.from && s.date.start <= pendingInsert.to)
                                .sort((a, b) => a.date.start - b.date.start)
                            if (pts.length === 0) return null
                            const baselineY = 127 * stretchY
                            let path = `M ${pts[0].date.start * stretchX} ${baselineY} `
                            for (const p of pts) {
                                path += `L ${p.date.start * stretchX} ${(127 - p.velocity) * stretchY} `
                            }
                            path += `L ${pts[pts.length - 1].date.start * stretchX} ${baselineY} Z`
                            return (
                                <path
                                    d={path}
                                    fill="gray"
                                    fillOpacity={0.2}
                                    stroke="gray"
                                    strokeWidth={1}
                                    pointerEvents="none"
                                >
                                    <animate attributeName="fill-opacity" values="0.2;0.08;0.2" dur="1s" repeatCount="indefinite" />
                                </path>
                            )
                        })()}

                        <MarkedRegion
                            from={(modifyOptions && ('from' in modifyOptions)) ? modifyOptions.from : undefined}
                            to={(modifyOptions && ('to' in modifyOptions)) ? modifyOptions.to : undefined}
                            svgRef={svgRef}
                        />
                    </svg>
                </div>
            </div>

        </div>
    )
}
