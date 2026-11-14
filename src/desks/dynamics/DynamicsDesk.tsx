import { type JSX, useEffect, useMemo, useState } from "react";
import { useScrollRegistration } from "../../hooks/useScrollRegistration";
import { usePiano } from "../../performance/piano";
import { useNotes } from "../../hooks/NotesProvider";
import { asMIDI } from "../../utils/utils";
import { ScopedTransformerViewProps } from "../TransformerViewProps";
import { DynamicsWithEndDate, InsertDynamics } from "../../fitting/transformers/dynamics/InsertDynamics";
import { AlignedNote } from "../../fitting/alignment";
import { getInstructions } from "../../fitting/instructions/index";
import { Box, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { CurveSegment } from "./CurveSegment";
import { DynamicsCircle } from "./DynamicsCircle";
import { VerticalScale } from "./VerticalScale";
import { evidenceDates, extractDynamicsSegments } from "./segments";
import { useSymbolicZoom } from "../../hooks/ZoomProvider";
import { useCallSelection } from "../../hooks/CallSelection";
import { useEditable } from "../../hooks/Editing";
import { DeskToolbar } from "../../components/DeskToolbar";
import { ToolGroup } from "../../components/toolbar/ToolGroup";
import { ToolbarButton } from "../../components/toolbar/ToolbarButton";
import { Clear } from "@mui/icons-material";
import { COMMITTED_GHOST, DeltaGhost } from "../corrections/DeltaGhost";
import { useCorrectionDeltas } from "../corrections/useCorrectionDeltas";
import { svgPoint, svgUnitsPerPixel } from "../../utils/svgPoint";
import { velocityAxis } from "../velocityAxis";
import { clamp } from "../../fitting/utils";
import { anchorsOf, nearestAnchor, type DynamicsAnchor } from "./anchors";
import {
    DEFAULT_GUIDE_GRID,
    GUIDE_GRIDS,
    gridDates,
    gridLabel,
    gridTicks,
    snapGuide,
    type GuideGrid,
} from "./guideGrid";

export type { DynamicsSegment } from "./segments";

/** How far from an anchor, in screen pixels, a press still catches it. */
const SNAP_REACH = 20;

/** Below this, in screen pixels, the grid reads as a grey wash; snapping goes on regardless. */
const MIN_GRID_SPACING = 4;

/**
 * Where dynamics curves are drawn over what the recording played.
 *
 * Corrections to the recording itself are `../corrections`, not here: three of the four things
 * `Modify` can correct cannot be shown on a plot of velocity against date.
 *
 * What is here is the evidence rather than the editing. A velocity somebody corrected by hand is
 * marked by a grey ghost at the value the roll scan read, because fitting a curve over a dot
 * means knowing whether the dot is what was recorded.
 *
 * A guide is a value the curve is to pass through at a date, whether or not the
 * recording sounds a note there — over a rest, or inside a held note. It is editorial, so it is
 * not free: it lands on a grid, quarter notes unless the toolbar says otherwise. A curve is fitted
 * between two anchors, and a guide is one.
 *
 * Selecting a curve marks the dots it was fitted over in the evidence colour (`../evidence.ts`):
 * the chords of its scope from the anchor it starts on to the one it ends on.
 *
 * In the viewer the desk only reads. No toolbar, since both modes, the grid and the guides exist
 * to write a curve; no drag across the plot; no guide. A dot still sounds on hover and plays on
 * click, and a curve still selects the call that wrote it.
 */
export const DynamicsDesk = ({ part, msm, mpm, addTransformer }: ScopedTransformerViewProps<
    InsertDynamics
>) => {
    const { activeElements, activeEvidence, setActiveElement } = useCallSelection();
    const editable = useEditable()
    const [datePlayed, setDatePlayed] = useState<number>()
    const [currentGuideDate, setCurrentGuideDate] = useState<number>()
    const [mode, setMode] = useState<'insert' | 'guide'>('insert')
    const [grid, setGrid] = useState<GuideGrid>(DEFAULT_GUIDE_GRID)

    const [guides, setGuides] = useState<Map<number, number>>(new Map())
    const [dragFrom, setDragFrom] = useState<DynamicsAnchor>()
    const [dragTo, setDragTo] = useState<DynamicsAnchor>()
    const [dragMouse, setDragMouse] = useState<{ x: number, y: number }>()
    const [pendingInsert, setPendingInsert] = useState<{ from: number, to: number }>()

    const { play, stop } = usePiano()
    const { slice } = useNotes()
    const stretchX = useSymbolicZoom()

    const scrollContainerRef = useScrollRegistration('dynamics-desk', 'symbolic');

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
            // Before `preventDefault`, and `=== undefined` rather than falsy: the desk must not
            // swallow an arrow it does not act on, and a guide on the first grid line sits at
            // date 0.
            if (currentGuideDate === undefined) return

            e.preventDefault()
            setGuides(prev => {
                const entry = prev.get(currentGuideDate)
                if (entry === undefined) return prev

                const next = new Map(prev)
                next.set(currentGuideDate, clamp(entry + (e.key === 'ArrowUp' ? 1 : -1), 0, 127))
                return next
            })
        }

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [currentGuideDate]);

    const instructions = useMemo(() => {
        const dynamics = getInstructions(mpm, 'dynamics', part)
        const withEndDate: DynamicsWithEndDate[] = []
        for (let i = 0; i < dynamics.length; i++) {
            // Where the curve stops is the next `<dynamics>`, and nothing else. There is no
            // `@endDate` attribute in MPM to prefer instead: `InsertDynamics` takes
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
    const marked = evidenceDates(msm.in(part).notes(), activeEvidence)

    // What a press on the plot does. In the viewer, neither: drawing a curve and pencilling in a
    // guide are the two ways this desk writes.
    const inserting = editable && mode === 'insert'
    const pencilling = editable && mode === 'guide'

    // The optimistic preview is answered by the next fit, the drawn curve being in `mpm` by
    // then. Cleared during render, React's way of adjusting state when a prop changes, rather
    // than from an effect, which would commit the stale preview over the new fit for one frame.
    const [lastFit, setLastFit] = useState({ mpm, part })
    if (lastFit.mpm !== mpm || lastFit.part !== part) {
        setPendingInsert(undefined)
        setLastFit({ mpm, part })
    }

    const margin = 20
    const chartHeight = 300 + margin
    // Wide enough for the tick, its gap and a three-digit velocity at font size 8.
    const scaleWidth = 34
    // The axis line sits on x = 0 and is 1.5 wide, so the gutter's viewBox has to reach a hair
    // past it — an outermost <svg> clips to its viewport, and half the stroke would go missing.
    const axisBleed = 1

    /**
     * Which velocities were corrected, by hand or by an expansion, and by how much.
     *
     * Read-only here: this desk emits no correction of its own any more, so there is nothing
     * pending to hold out of the sum and the ghosts are a pure function of the chain and the
     * alignment. The corrections desk is where the dots themselves are moved.
     */
    const modifyDeltas = useCorrectionDeltas(msm, part, 'velocity')

    /**
     * The velocities the plot shows, read off everything it draws: the dots, the ghosts at the
     * value the roll scan had before a correction, the guides and both ends of every curve —
     * a curve runs monotonically between the two, so they bound it. The velocity plot on the
     * corrections desk reads its range off the same dots and ghosts, and so draws them at the
     * same heights.
     *
     * A guide nudged past either end, or pencilled in near one, takes the range with it.
     */
    const axis = useMemo(() => velocityAxis([
        ...segments.flatMap(segment => {
            const delta = segment.noteID ? modifyDeltas.get(segment.noteID) : undefined
            return delta ? [segment.velocity, segment.velocity - delta] : [segment.velocity]
        }),
        ...guides.values(),
        ...instructions.flatMap(i => [+i.volume, +(i.transitionTo ?? i.volume)]),
    ], chartHeight), [segments, modifyDeltas, guides, instructions, chartHeight])

    const screenY = axis.y

    const anchors = useMemo(
        () => anchorsOf(segments, guides),
        [segments, guides]
    )

    const gridLines = useMemo(() => {
        if (gridTicks(grid) * stretchX < MIN_GRID_SPACING) return null
        return (
            <g stroke='#e5e7eb' strokeWidth={0.5} pointerEvents='none'>
                {gridDates(grid, msm.end).map(date => (
                    <line
                        key={`grid_${date}`}
                        x1={date * stretchX}
                        x2={date * stretchX}
                        y1={0}
                        y2={chartHeight}
                    />
                ))}
            </g>
        )
    }, [grid, stretchX, msm.end, chartHeight])

    /** The anchor a press at `svgX` catches, in the SVG's own units. */
    const anchorNear = (svg: SVGSVGElement, svgX: number) =>
        nearestAnchor(anchors, svgX / stretchX, (SNAP_REACH * svgUnitsPerPixel(svg)) / stretchX)

    const pencilIn = (guide: DynamicsAnchor) => {
        setGuides(prev => new Map(prev).set(guide.date, guide.velocity))
        setCurrentGuideDate(guide.date)
    }

    const cancelDrag = () => {
        setDragFrom(undefined)
        setDragMouse(undefined)
        setDragTo(undefined)
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

    const circles: JSX.Element[] = []

    guides.forEach((velocity, date) => {
        circles.push(
            <text
                key={`guide_${date}`}
                x={date * stretchX}
                y={screenY(velocity)}
                fill='darkred'
                fontWeight={date === currentGuideDate ? 'bold' : 'normal'}
                textAnchor='middle'
                dominantBaseline='middle'
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                    // The plot beneath places a guide wherever it is clicked, so a click meant
                    // for one already there must not reach it.
                    e.stopPropagation()
                    if (e.altKey && e.shiftKey) {
                        setGuides(prev => {
                            const next = new Map(prev)
                            next.delete(date)
                            return next
                        })
                        if (currentGuideDate === date) setCurrentGuideDate(undefined)
                        return
                    }
                    setCurrentGuideDate(date)
                }}
            >
                x
            </text>
        )
    })

    segments.forEach((segment, i) => {
        const committedDelta = segment.noteID ? modifyDeltas.get(segment.noteID) : undefined
        if (committedDelta) {
            const x = segment.date.start * stretchX
            circles.push(
                <DeltaGhost
                    key={`ghost_${segment.date.start}_${i}`}
                    x1={x}
                    y1={screenY(segment.velocity - committedDelta)}
                    x2={x}
                    y2={screenY(segment.velocity)}
                    color={COMMITTED_GHOST}
                />
            )
        }

        circles.push(
            <DynamicsCircle
                key={`velocity_segment_${segment.date.start}_${i}`}
                segment={segment}
                datePlayed={datePlayed}
                stretchX={stretchX}
                screenY={screenY}
                handlePlay={handlePlay}
                handleClick={(e) => {
                    if (!pencilling) return
                    e.stopPropagation()
                    pencilIn({ date: segment.date.start, velocity: segment.velocity })
                }}
                cursor={inserting ? 'crosshair' : undefined}
                evidence={marked.has(segment.date.start)}
            />
        )
    })

    // `@xml:id` is optional on an espressivo instruction, so the round trip between a drawn
    // curve and the call that wrote it is guarded. Every `<dynamics>` the chain writes carries
    // one — `auditInstructions` reports an unnamed instruction as a bug — but a document from
    // elsewhere need not, and such a curve simply cannot be selected.
    // Keyed by date where there is no id to key by: no two `<dynamics>` of one map share a date.
    const curves = instructions.map(i => {
        return (
            <CurveSegment
                key={i.id ?? `dynamics_${i.date}`}
                active={i.id !== undefined && activeElements.includes(i.id)}
                instruction={i}
                stretchX={stretchX}
                axis={axis}
                onClick={() => {
                    if (i.id !== undefined) setActiveElement(i.id)
                }}
            />
        )
    })

    return (
        <div>
            <Box sx={{ m: 1 }}>{part !== 'global' && `Part ${part + 1}`}</Box>
            {editable && <DeskToolbar>
                <ToolGroup label='Mode'>
                    <ToggleButtonGroup
                        value={mode}
                        exclusive
                        // An exclusive group answers a click on the pressed button with `null`,
                        // and this desk has no "no mode" — dropping that click leaves the mode
                        // where it was, which is what a two-way switch should do.
                        onChange={(_, newMode) => {
                            if (newMode !== null) {
                                setMode(newMode)
                            }
                        }}
                        size='small'
                    >
                        <ToggleButton value='insert'>Insert</ToggleButton>
                        <ToggleButton value='guide'>Guide</ToggleButton>
                    </ToggleButtonGroup>
                </ToolGroup>

                <ToolGroup label='Grid'>
                    <ToggleButtonGroup
                        value={grid}
                        exclusive
                        disabled={mode !== 'guide'}
                        onChange={(_, newGrid: GuideGrid | null) => {
                            if (newGrid !== null) {
                                setGrid(newGrid)
                            }
                        }}
                        size='small'
                    >
                        {GUIDE_GRIDS.map(candidate => (
                            <ToggleButton key={candidate} value={candidate}>
                                {gridLabel(candidate)}
                            </ToggleButton>
                        ))}
                    </ToggleButtonGroup>
                </ToolGroup>

                {/*
                    Shown in both modes, disabled in the one it cannot act in.

                    It was behind `mode === 'guide' &&`, so switching mode mounted a whole
                    captioned group and shoved everything to its right — the largest reflow in the
                    bar. Disabled says the same thing without moving anything, and the tooltip
                    says which mode would make it live.

                    It also makes the modes self-documenting: Guide's one action is legible from
                    Insert mode, so the user can see what a mode offers before entering it.

                    Still "Clear Guides" rather than "Clear" now that it is the group's only
                    button: what it discards is a set of pencilled-in velocities, not the curve
                    the desk is drawing, and the shorter label would read as the latter.
                */}
                <ToolGroup>
                    <ToolbarButton
                        icon={<Clear />}
                        label='Clear Guides'
                        tooltip={guides.size === 0
                            ? 'No guides to clear'
                            : `Discard the ${guides.size} ${guides.size === 1 ? 'guide' : 'guides'}`}
                        disabled={guides.size === 0}
                        onClick={() => {
                            setGuides(new Map())
                            setCurrentGuideDate(undefined)
                        }}
                    >
                        Clear Guides
                    </ToolbarButton>
                </ToolGroup>
            </DeskToolbar>}

            {/*
                The scale has a column of its own, laid out beside the scroller, so the chart
                starts where the scale ends and nothing can be drawn behind it. As an absolutely
                positioned overlay the plot would begin underneath it: the axis 12px to the right
                of velocity at date 0, the labels on top of the first notes, and every note
                scrolling *under* the axis rather than past it.

                Both are `chartHeight` tall with a viewBox of the same extent, so one pixel is one
                unit in both and a tick meets the velocity it names.
            */}
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <svg
                    style={{ flex: '0 0 auto' }}
                    width={scaleWidth}
                    height={chartHeight}
                    viewBox={`${-scaleWidth + axisBleed} 0 ${scaleWidth} ${chartHeight}`}
                >
                    <VerticalScale axis={axis} />
                </svg>

                <div
                    ref={scrollContainerRef}
                    style={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden' }}
                >
                    <svg
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
                        onMouseDown={inserting ? (e) => {
                            const svg = e.currentTarget
                            const pt = svgPoint(svg, e.clientX, e.clientY)
                            if (!pt) return
                            setDragFrom(anchorNear(svg, pt.x))
                        } : undefined}
                        onMouseMove={inserting ? (e) => {
                            if (!dragFrom) return
                            const svg = e.currentTarget
                            const pt = svgPoint(svg, e.clientX, e.clientY)
                            if (!pt) return
                            setDragMouse(pt)
                            const to = anchorNear(svg, pt.x)
                            setDragTo(to && to.date > dragFrom.date ? to : undefined)
                        } : undefined}
                        onMouseUp={inserting ? () => {
                            if (dragFrom && dragTo) {
                                setPendingInsert({ from: dragFrom.date, to: dragTo.date })
                                addTransformer(new InsertDynamics({
                                    from: dragFrom.date,
                                    to: dragTo.date,
                                    guides,
                                    scope: part
                                }))
                            }
                            cancelDrag()
                        } : undefined}
                        onMouseLeave={inserting ? () => cancelDrag() : undefined}
                        onClick={pencilling ? (e) => {
                            const pt = svgPoint(e.currentTarget, e.clientX, e.clientY)
                            if (!pt) return
                            const guide = snapGuide(
                                { date: pt.x / stretchX, velocity: axis.velocityAt(pt.y) },
                                grid,
                                msm.end
                            )
                            if (guide) pencilIn(guide)
                        } : undefined}
                    >
                        {pencilling && gridLines}
                        {/*
                            A fitted curve is filled down to the baseline, so in Guide mode it
                            covers most of the surface a guide would be placed on. Selecting one
                            is an Insert-mode gesture.
                        */}
                        <g pointerEvents={pencilling ? 'none' : undefined}>
                            {curves}
                        </g>
                        {circles}

                        {/* Drag preview line, between the two anchors the fit will run between */}
                        {dragFrom && dragMouse && (
                            <line
                                x1={dragFrom.date * stretchX}
                                y1={screenY(dragFrom.velocity)}
                                x2={dragTo ? dragTo.date * stretchX : dragMouse.x}
                                y2={dragTo ? screenY(dragTo.velocity) : dragMouse.y}
                                stroke="gold"
                                strokeWidth={2}
                                strokeDasharray="6 4"
                                pointerEvents="none"
                            />
                        )}

                        {/* Snap indicator circles */}
                        {dragFrom && (
                            <circle
                                cx={dragFrom.date * stretchX} cy={screenY(dragFrom.velocity)} r={4}
                                fill="gold" stroke="gold" strokeWidth={1}
                                pointerEvents="none"
                            />
                        )}
                        {dragTo && (
                            <circle
                                cx={dragTo.date * stretchX} cy={screenY(dragTo.velocity)} r={4}
                                fill="gold" stroke="gold" strokeWidth={1}
                                pointerEvents="none"
                            />
                        )}

                        {/* Optimistic preview while transformer processes */}
                        {pendingInsert && (() => {
                            const pts = anchors
                                .filter(a => a.date >= pendingInsert.from && a.date <= pendingInsert.to)
                            if (pts.length === 0) return null
                            const baselineY = screenY(axis.min)
                            let path = `M ${pts[0].date * stretchX} ${baselineY} `
                            for (const p of pts) {
                                path += `L ${p.date * stretchX} ${screenY(p.velocity)} `
                            }
                            path += `L ${pts[pts.length - 1].date * stretchX} ${baselineY} Z`
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
                    </svg>
                </div>
            </div>

        </div>
    )
}
