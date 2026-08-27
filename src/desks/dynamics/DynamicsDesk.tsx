import { type JSX, useEffect, useMemo, useState } from "react";
import { useScrollRegistration } from "../../hooks/useScrollRegistration";
import { usePiano } from "react-pianosound";
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

export type { DynamicsSegment } from "./segments";

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
 */
export const DynamicsDesk = ({ part, msm, mpm, addTransformer }: ScopedTransformerViewProps<
    InsertDynamicsInstructions
>) => {
    const { activeElements, setActiveElement } = useCallSelection();
    const [datePlayed, setDatePlayed] = useState<number>()
    const [currentPhantomDate, setCurrentPhantomDate] = useState<number>()
    const [mode, setMode] = useState<'insert' | 'phantom'>('insert')

    const [phantomVelocities, setPhantomVelocities] = useState<Map<number, number>>(new Map())
    const [dragFrom, setDragFrom] = useState<{ date: number, x: number, y: number }>()
    const [dragMouse, setDragMouse] = useState<{ x: number, y: number }>()
    const [dragSnapDate, setDragSnapDate] = useState<number>()
    const [pendingInsert, setPendingInsert] = useState<{ from: number, to: number }>()

    const { play, stop } = usePiano()
    const { slice } = useNotes()
    const stretchX = useSymbolicZoom()

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
        if (committedDelta) {
            const x = segment.date.start * stretchX
            circles.push(
                <DeltaGhost
                    key={`ghost_${segment.date.start}_${i}`}
                    x1={x}
                    y1={(127 - (segment.velocity - committedDelta)) * stretchY}
                    x2={x}
                    y2={(127 - segment.velocity) * stretchY}
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
                screenY={(velocity: number) => (127 - velocity) * stretchY}
                handlePlay={handlePlay}
                handleClick={() => {
                    if (mode !== 'phantom') return
                    setPhantomVelocities(prev => {
                        const next = new Map(prev)
                        next.set(segment.date.start, segment.velocity)
                        return next
                    })
                    setCurrentPhantomDate(segment.date.start)
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
                        } : undefined}
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
                        } : undefined}
                        onMouseLeave={mode === 'insert' ? () => cancelDrag() : undefined}
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
                    </svg>
                </div>
            </div>

        </div>
    )
}
