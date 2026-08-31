import { type JSX, useEffect, useMemo, useState } from "react";
import { useScrollRegistration } from "../../hooks/useScrollRegistration";
import { usePiano } from "../../performance/piano";
import { useNotes } from "../../hooks/NotesProvider";
import { asMIDI } from "../../utils/utils";
import { ScopedTransformerViewProps } from "../TransformerViewProps";
import { DynamicsWithEndDate, InsertDynamicsInstructions } from "../../fitting/transformers/dynamics/InsertDynamicsInstructions";
import { AlignedNote } from "../../fitting/alignment";
import { getInstructions } from "../../fitting/instructions/index";
import { Box, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { CurveSegment } from "./CurveSegment";
import { DynamicsCircle } from "./DynamicsCircle";
import { VerticalScale } from "./VerticalScale";
import { extractDynamicsSegments } from "./segments";
import { useSymbolicZoom } from "../../hooks/ZoomProvider";
import { useCallSelection } from "../../hooks/CallSelection";
import { DeskToolbar } from "../../components/DeskToolbar";
import { ToolGroup } from "../../components/toolbar/ToolGroup";
import { ToolbarButton } from "../../components/toolbar/ToolbarButton";
import { Clear } from "@mui/icons-material";
import { COMMITTED_GHOST, DeltaGhost } from "../corrections/DeltaGhost";
import { useModifyDeltas } from "../corrections/useModifyDeltas";
import { svgPoint, svgUnitsPerPixel } from "../../utils/svgPoint";
import { clamp } from "../../fitting/utils";
import { anchorsOf, nearestAnchor, type DynamicsAnchor } from "./anchors";
import {
    DEFAULT_PHANTOM_GRID,
    PHANTOM_GRIDS,
    gridDates,
    gridLabel,
    gridTicks,
    snapPhantom,
    type PhantomGrid,
} from "./phantomGrid";

export type { DynamicsSegment } from "./segments";

/** How far from an anchor, in screen pixels, a press still catches it. */
const SNAP_REACH = 20;

/** Below this, in screen pixels, the grid reads as a grey wash; snapping goes on regardless. */
const MIN_GRID_SPACING = 4;

/**
 * Where dynamics curves are drawn over what the recording played.
 *
 * The desk used to have a third mode, Modify, which dragged a recorded velocity to a new value.
 * That is a correction to the *recording*, made from the desk for writing instructions *about*
 * the recording — and it left the three other things `Modify` can correct with nowhere to be made
 * from at all, since none of them can be shown on a plot of velocity against date. They share a
 * desk of their own now, in `../corrections`.
 *
 * What stayed is the evidence rather than the editing: a velocity somebody corrected by hand is
 * still marked here, by a grey ghost at the value the roll scan read. Fitting a curve over a dot
 * means knowing whether the dot is what was recorded.
 *
 * A phantom velocity is a value the curve is to pass through at a date, whether or not the
 * recording sounds a note there — over a rest, or inside a held note. It is editorial, so it is
 * not free: it lands on a grid, quarter notes unless the toolbar says otherwise. A curve is fitted
 * between two anchors, and a phantom is one.
 */
export const DynamicsDesk = ({ part, msm, mpm, addTransformer }: ScopedTransformerViewProps<
    InsertDynamicsInstructions
>) => {
    const { activeElements, setActiveElement } = useCallSelection();
    const [datePlayed, setDatePlayed] = useState<number>()
    const [currentPhantomDate, setCurrentPhantomDate] = useState<number>()
    const [mode, setMode] = useState<'insert' | 'phantom'>('insert')
    const [grid, setGrid] = useState<PhantomGrid>(DEFAULT_PHANTOM_GRID)

    const [phantomVelocities, setPhantomVelocities] = useState<Map<number, number>>(new Map())
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
            // swallow an arrow it does not act on, and a phantom on the first grid line sits at
            // date 0.
            if (currentPhantomDate === undefined) return

            e.preventDefault()
            setPhantomVelocities(prev => {
                const entry = prev.get(currentPhantomDate)
                if (entry === undefined) return prev

                const next = new Map(prev)
                next.set(currentPhantomDate, clamp(entry + (e.key === 'ArrowUp' ? 1 : -1), 0, 127))
                return next
            })
        }

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [currentPhantomDate]);

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

    // The optimistic preview is answered by the next fit: the drawn curve is in `mpm` by then.
    // Clearing it is the one thing the effect that used to derive `instructions` did besides
    // deriving, and it is not derived state, so it stays. It runs during render — React's way of
    // adjusting state when a prop changes — and not in an effect, which would commit the stale
    // preview over the new fit for one frame.
    const [lastFit, setLastFit] = useState({ mpm, part })
    if (lastFit.mpm !== mpm || lastFit.part !== part) {
        setPendingInsert(undefined)
        setLastFit({ mpm, part })
    }

    const stretchY = 3
    const margin = 20
    const chartHeight = 300 + margin
    // Wide enough for the tick, its gap and a three-digit velocity at font size 8.
    const scaleWidth = 34
    // The axis line sits on x = 0 and is 1.5 wide, so the gutter's viewBox has to reach a hair
    // past it — an outermost <svg> clips to its viewport, and half the stroke would go missing.
    const axisBleed = 1

    /**
     * Which velocities were corrected by hand, and by how much.
     *
     * Read-only here: this desk emits no `Modify` of its own any more, so there is nothing
     * pending to hold out of the sum and the ghosts are a pure function of the chain and the
     * alignment. The corrections desk is where the dots themselves are moved.
     */
    const modifyDeltas = useModifyDeltas(msm, part, 'velocity')

    const screenY = (velocity: number) => (127 - velocity) * stretchY

    const anchors = useMemo(
        () => anchorsOf(segments, phantomVelocities),
        [segments, phantomVelocities]
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

    const pencilIn = (phantom: DynamicsAnchor) => {
        setPhantomVelocities(prev => new Map(prev).set(phantom.date, phantom.velocity))
        setCurrentPhantomDate(phantom.date)
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

    phantomVelocities.forEach((velocity, date) => {
        circles.push(
            <text
                key={`phantom_velocity_${date}`}
                x={date * stretchX}
                y={screenY(velocity)}
                fill='darkred'
                fontWeight={date === currentPhantomDate ? 'bold' : 'normal'}
                textAnchor='middle'
                dominantBaseline='middle'
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                    // The plot beneath places a phantom wherever it is clicked, so a click meant
                    // for one already there must not reach it.
                    e.stopPropagation()
                    if (e.altKey && e.shiftKey) {
                        setPhantomVelocities(prev => {
                            const next = new Map(prev)
                            next.delete(date)
                            return next
                        })
                        if (currentPhantomDate === date) setCurrentPhantomDate(undefined)
                        return
                    }
                    setCurrentPhantomDate(date)
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
                key={`velocity_segment_${segment.date}_${i}`}
                segment={segment}
                datePlayed={datePlayed}
                stretchX={stretchX}
                screenY={screenY}
                handlePlay={handlePlay}
                handleClick={(e) => {
                    if (mode !== 'phantom') return
                    e.stopPropagation()
                    pencilIn({ date: segment.date.start, velocity: segment.velocity })
                }}
                cursor={mode === 'insert' ? 'crosshair' : undefined}
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
                        // where it was, which is what a two-way switch should do.
                        onChange={(_, newMode) => {
                            if (newMode !== null) {
                                setMode(newMode)
                            }
                        }}
                        size='small'
                    >
                        <ToggleButton value='insert'>Insert</ToggleButton>
                        <ToggleButton value='phantom'>Phantom</ToggleButton>
                    </ToggleButtonGroup>
                </ToolGroup>

                <ToolGroup label='Grid'>
                    <ToggleButtonGroup
                        value={grid}
                        exclusive
                        disabled={mode !== 'phantom'}
                        onChange={(_, newGrid: PhantomGrid | null) => {
                            if (newGrid !== null) {
                                setGrid(newGrid)
                            }
                        }}
                        size='small'
                    >
                        {PHANTOM_GRIDS.map(candidate => (
                            <ToggleButton key={candidate} value={candidate}>
                                {gridLabel(candidate)}
                            </ToggleButton>
                        ))}
                    </ToggleButtonGroup>
                </ToolGroup>

                {/*
                    Shown in both modes, disabled in the one it cannot act in.

                    It was behind `mode === 'phantom' &&`, so switching mode mounted a whole
                    captioned group and shoved everything to its right — the largest reflow in the
                    bar. Disabled says the same thing without moving anything, and the tooltip
                    says which mode would make it live.

                    It also makes the modes self-documenting: Phantom's one action is legible from
                    Insert mode, so the user can see what a mode offers before entering it.

                    Still "Clear Phantoms" rather than "Clear" now that it is the group's only
                    button: what it discards is a set of pencilled-in velocities, not the curve
                    the desk is drawing, and the shorter label would read as the latter.
                */}
                <ToolGroup>
                    <ToolbarButton
                        icon={<Clear />}
                        label='Clear Phantoms'
                        tooltip={phantomVelocities.size === 0
                            ? 'No phantom velocities to clear'
                            : `Discard the ${phantomVelocities.size} phantom ${phantomVelocities.size === 1 ? 'velocity' : 'velocities'}`}
                        disabled={phantomVelocities.size === 0}
                        onClick={() => {
                            setPhantomVelocities(new Map())
                            setCurrentPhantomDate(undefined)
                        }}
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
                            setDragFrom(anchorNear(svg, pt.x))
                        } : undefined}
                        onMouseMove={mode === 'insert' ? (e) => {
                            if (!dragFrom) return
                            const svg = e.currentTarget
                            const pt = svgPoint(svg, e.clientX, e.clientY)
                            if (!pt) return
                            setDragMouse(pt)
                            const to = anchorNear(svg, pt.x)
                            setDragTo(to && to.date > dragFrom.date ? to : undefined)
                        } : undefined}
                        onMouseUp={mode === 'insert' ? () => {
                            if (dragFrom && dragTo) {
                                setPendingInsert({ from: dragFrom.date, to: dragTo.date })
                                addTransformer(new InsertDynamicsInstructions({
                                    from: dragFrom.date,
                                    to: dragTo.date,
                                    phantomVelocities,
                                    scope: part
                                }))
                            }
                            cancelDrag()
                        } : undefined}
                        onMouseLeave={mode === 'insert' ? () => cancelDrag() : undefined}
                        onClick={mode === 'phantom' ? (e) => {
                            const pt = svgPoint(e.currentTarget, e.clientX, e.clientY)
                            if (!pt) return
                            const phantom = snapPhantom(
                                { date: pt.x / stretchX, velocity: 127 - pt.y / stretchY },
                                grid,
                                msm.end
                            )
                            if (phantom) pencilIn(phantom)
                        } : undefined}
                    >
                        {mode === 'phantom' && gridLines}
                        {/*
                            A fitted curve is filled down to the baseline, so in Phantom mode it
                            covers most of the surface a phantom would be placed on. Selecting one
                            is an Insert-mode gesture.
                        */}
                        <g pointerEvents={mode === 'phantom' ? 'none' : undefined}>
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
                            const baselineY = screenY(0)
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
