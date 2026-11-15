import { useState, type MouseEvent } from "react"
import { ToggleButton, ToggleButtonGroup } from "@mui/material"
import { Check, Clear } from "@mui/icons-material"
import type { Normalized } from "espressivo"
import { InsertPedal, type InsertPedalOptions } from "../../fitting/transformers/pedal/InsertPedal"
import { guidedMovements } from "../../fitting/transformers/pedal/approximateMovement"
import { rowId, type AlignedPedal } from "../../fitting/alignment"
import { getInstructions } from "../../fitting/instructions/index"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { MovementSegment } from "./MovementSegment"
import { useSymbolicZoom } from "../../hooks/ZoomProvider"
import { useCallSelection } from "../../hooks/CallSelection"
import { useEditable } from "../../hooks/Editing"
import { PressBox } from "./PressBox"
import { usePiano } from "../../performance/piano"
import { asMIDI } from "../../utils/utils"
import { useScrollRegistration } from "../../hooks/useScrollRegistration"
import { filterMap } from "espressivo"
import { PedalGutter, TickScale } from "./PedalAxes"
import { GUTTER_WIDTH, LANE_HEIGHT, MOVEMENT_TOP, PLOT_TOP, pedalPlot, rowY } from "./layout"
import { DeskToolbar } from "../../components/DeskToolbar"
import { ToolGroup } from "../../components/toolbar/ToolGroup"
import { ToolbarButton } from "../../components/toolbar/ToolbarButton"
import { svgPoint } from "../../utils/svgPoint"
import {
    guideAt,
    guidesOfCall,
    guidesOfMovements,
    pressOfCall,
    withGuideMoved,
    type PedalGuides,
} from "./guides"

/** The guides' colour, as the dynamics desk draws its own. */
const GUIDE = 'darkred'

/** A press being guided, and the guides drawn for it so far. */
interface Draft {
    pedal: AlignedPedal
    guides: PedalGuides
}

/**
 * The pedal desk: each recorded press as the line it drew, on the tick grid, with the movements
 * the document holds below, one lane per controller.
 *
 * Two ways to write a press, as the dynamics desk has two to write a curve. In Trace mode a click
 * on a press writes its recorded line as movements. In Guide mode a click picks the press, and a
 * click in its lane pencils in a guide, a point its curve is to pass through: a press with a ramp
 * each way is four of them. A guide drags where it is to go, and Alt+Shift+click takes it away.
 * The press starts from the guides its call has, or else from where its movements turn, so a curve
 * already drawn is a draft to work on. Apply writes the curve through the guides.
 *
 * A press has one call: writing it again replaces the one it had, whose movements would otherwise
 * stand beside the new ones under the same ids.
 *
 * The guides a call states stay drawn on its lane, a cross at each, so a reader sees what a
 * curve was drawn through; those of a selected call are drawn in its colour.
 *
 * In the viewer a press is not a target, so it neither lights on hover nor answers a click, and
 * there is no toolbar. Hovering a chord line still sounds the chord, and clicking a movement still
 * selects the call that wrote it. With a call selected, in either mode, the press it was fitted to
 * is marked in the evidence colour (`../evidence.ts`).
 */
export const PedalDesk = ({ msm, mpm, residual, addTransformer }: ScopedTransformerViewProps<InsertPedal>) => {
    const { activeElements, setActiveElement, activeEvidence, activeCallIds, calls, removeCall } = useCallSelection();
    const editable = useEditable()

    const stretchX = useSymbolicZoom()
    const { play, stop } = usePiano()

    const scrollContainerRef = useScrollRegistration('pedal-desk', 'symbolic')

    const [mode, setMode] = useState<'trace' | 'guide'>('trace')
    const [draft, setDraft] = useState<Draft>()
    /** The date of the guide being dragged. */
    const [dragging, setDragging] = useState<number>()

    // `needsChoice` holds this desk shut until a base text has been chosen, and choosing one is
    // what leaves a residual to place the pedals by: the type system catching up with that, not a
    // case being handled. Below the hooks, so the desk keeps calling the same ones either way.
    if (!residual) return null

    // `@controller` is optional on a `<movement>`. Every one this desk draws was written by
    // `InsertPedal`, which always states it, so the fallback lane exists only so that a
    // movement from somewhere else is still drawn rather than dropped.
    const allMovements = getInstructions(mpm, 'movement')
    const movementsByController = Object.groupBy(allMovements, m => m.controller ?? 'unknown')

    // A recorded pedal carries no symbolic date of its own, so where it falls on the tick grid
    // is the residual's answer and nothing else's. A press with no line placed means the MPM
    // cannot place it yet — no `<tempo>` covers it — and an unplaceable pedal is neither drawn
    // nor named.
    const presses = filterMap(msm.pedals, pedal => {
        const line = residual.ofPedal(pedal)?.tickTravel
        if (!line || line.length < 2) return null

        return { pedal, line }
    })

    // A lane for the press being guided, though nothing has moved its pedal yet.
    const plot = pedalPlot(
        presses.map(press => press.pedal.type),
        [...new Set([...Object.keys(movementsByController), ...(draft ? [draft.pedal.type] : [])])],
    )
    const width = msm.end * stretchX

    const typeOf = new Map(msm.pedals.map(pedal => [pedal['xml:id'], pedal.type]))
    // Every call's guides, on the lane of the press it names; the press being guided shows its draft.
    const stated = calls.flatMap(call => {
        const pedal = pressOfCall(call)
        const guides = guidesOfCall(call)
        const type = pedal === undefined ? undefined : typeOf.get(pedal)
        if (!guides || type === undefined || pedal === draft?.pedal['xml:id']) return []
        return [{ call: call.id, type, guides }]
    })

    /** Write a press's call, in place of the one it had. */
    const write = (options: InsertPedalOptions & { pedal: string }) => {
        for (const call of calls) if (pressOfCall(call) === options.pedal) removeCall(call.id)
        addTransformer(new InsertPedal(options))
    }

    /** Guide a press, from the guides it has or the movements it was given. */
    const guide = (pedal: AlignedPedal) => {
        const id = pedal['xml:id']
        const call = calls.find(candidate => pressOfCall(candidate) === id && guidesOfCall(candidate))
        const guides = (call && guidesOfCall(call))
            ?? guidesOfMovements(allMovements.filter(movement => movement.id?.startsWith(`${id}_`)))
        setDraft({ pedal, guides: new Map(guides) })
    }

    const apply = () => {
        if (!draft) return
        const guides = new Map([...draft.guides].sort(([a], [b]) => a - b))
        write({ pedal: draft.pedal['xml:id'], guides })
        setDraft(undefined)
    }

    /** Where the pointer is in a lane hanging at `laneY`, as a guide. */
    const pointer = (e: MouseEvent<SVGElement>, laneY: number) => {
        const svg = e.currentTarget.ownerSVGElement ?? (e.currentTarget as SVGSVGElement)
        const pt = svgPoint(svg, e.clientX, e.clientY)
        return pt && guideAt(pt.x, pt.y - laneY, stretchX)
    }

    const draftLane = draft && plot.lanes.find(lane => lane.controller === draft.pedal.type)

    return (
        <div>
            {editable && <DeskToolbar>
                <ToolGroup label='Mode'>
                    <ToggleButtonGroup
                        value={mode}
                        exclusive
                        // An exclusive group answers a click on the pressed button with `null`;
                        // this desk has no "no mode", so that click leaves the mode where it was.
                        onChange={(_, next: 'trace' | 'guide' | null) => {
                            if (next === null) return
                            setMode(next)
                            setDraft(undefined)
                        }}
                        size='small'
                    >
                        <ToggleButton value='trace'>Trace</ToggleButton>
                        <ToggleButton value='guide'>Guide</ToggleButton>
                    </ToggleButtonGroup>
                </ToolGroup>

                <ToolGroup>
                    <ToolbarButton
                        icon={<Check />}
                        label='Apply'
                        tooltip={!draft
                            ? 'Pick a press in Guide mode to guide it'
                            : draft.guides.size < 2
                              ? 'A curve needs two guides at least'
                              : `Write the ${draft.pedal.type} press through its ${String(draft.guides.size)} guides`}
                        disabled={!draft || draft.guides.size < 2}
                        onClick={apply}
                    >
                        Apply
                    </ToolbarButton>
                    <ToolbarButton
                        icon={<Clear />}
                        label='Clear Guides'
                        tooltip={!draft || draft.guides.size === 0
                            ? 'No guides to clear'
                            : `Discard the ${String(draft.guides.size)} guides of the ${draft.pedal.type} press`}
                        disabled={!draft || draft.guides.size === 0}
                        onClick={() => setDraft(draft && { ...draft, guides: new Map() })}
                    >
                        Clear Guides
                    </ToolbarButton>
                </ToolGroup>
            </DeskToolbar>}

            {/*
                The names have a column of their own beside the scroller, as on the choice and
                corrections desks, so `sustain` still says which row it belongs to once the plot
                has been scrolled on. Both halves are `plot.height` tall over the same viewBox
                extent, so a name meets its own row.
            */}
            <div style={{ display: 'flex', alignItems: 'flex-start', width: '100vw' }}>
                <svg
                    style={{ flex: '0 0 auto' }}
                    width={GUTTER_WIDTH}
                    height={plot.height}
                    viewBox={[-GUTTER_WIDTH, 0, GUTTER_WIDTH, plot.height].join(' ')}
                >
                    <PedalGutter plot={plot} />
                </svg>

                <div
                    ref={scrollContainerRef}
                    style={{ flex: 1, minWidth: 0, overflowX: 'scroll', overflowY: 'hidden' }}
                >
                    <svg
                        width={width}
                        height={plot.height}
                        onMouseMove={dragging === undefined || !draft || !draftLane ? undefined : (e) => {
                            const to = pointer(e, draftLane.y)
                            if (!to) return
                            setDraft({ ...draft, guides: withGuideMoved(draft.guides, dragging, to) })
                            if (!draft.guides.has(to.date) || to.date === dragging) setDragging(to.date)
                        }}
                        onMouseUp={dragging === undefined ? undefined : () => setDragging(undefined)}
                        onMouseLeave={dragging === undefined ? undefined : () => setDragging(undefined)}
                    >
                        {/*
                            `'global'` on purpose, unlike the arpeggiation desks: a pedal is a
                            property of the instrument, `InsertPedal` writes to `movement`/`global`
                            whatever the picker says, and these lines are the texture under a press.

                            Under the presses, so that a press is one solid target. Over them, a
                            line crossing one is three pixels that sound a chord where a click is
                            asking for the pedal.
                        */}
                        {Array.from(msm.in('global').chords().entries()).map(([date, chord]) => {
                            return (
                                <g key={`chord_${date}`}>
                                    <line
                                        x1={date * stretchX}
                                        y1={PLOT_TOP}
                                        x2={date * stretchX}
                                        y2={MOVEMENT_TOP}
                                        stroke='black'
                                        strokeOpacity={0.2}
                                        strokeWidth={3}
                                        onMouseOver={() => {
                                            const midi = asMIDI(chord)
                                            if (!midi) return

                                            stop()
                                            play(midi)
                                        }}
                                    />
                                </g>
                            )
                        })}

                        {presses.map(({ pedal, line }) => (
                            <PressBox
                                key={`pedal_${rowId(pedal)}`}
                                pedal={pedal}
                                line={line}
                                y={rowY(pedal.type)}
                                stretchX={stretchX}
                                evidence={activeEvidence.has(pedal['xml:id'])}
                                onPick={!editable
                                    ? undefined
                                    : mode === 'trace'
                                      ? picked => write({ pedal: picked['xml:id'] })
                                      : guide}
                                picked={draft?.pedal['xml:id'] === pedal['xml:id']}
                            />
                        ))}

                        {plot.lanes.map(lane => {
                            const movements = [...(movementsByController[lane.controller] ?? [])]
                                .sort((a, b) => a.date - b.date)

                            return (
                                <g
                                    key={lane.controller}
                                    className={`controller_${lane.controller}`}
                                    transform={`translate(0, ${lane.y})`}
                                >
                                    {/* The rail the lane hangs from, so the depth of a movement has
                                        something to be read against where none is written. */}
                                    <line x1={0} y1={0} x2={width} y2={0} stroke='#e5e7eb' />

                                    {/* A movement lasts until the next; the last one holds to the
                                        end of the piece (issue #33). */}
                                    {movements.map((movement, i) => (
                                        <MovementSegment
                                            instruction={{ ...movement, endDate: movements[i + 1]?.date ?? msm.end }}
                                            key={`movement_${movement.id}`}
                                            stretchX={stretchX}
                                            stretchY={LANE_HEIGHT}
                                            onClick={() => movement.id && setActiveElement(movement.id)}
                                            fill={movement.id && activeElements.includes(movement.id) ? 'orange' : 'lightblue'}
                                        />
                                    ))}

                                    {stated.filter(({ type }) => type === lane.controller).map(({ call, guides }) =>
                                        [...guides].map(([date, position]) => (
                                            <text
                                                key={`guide_${call}_${String(date)}`}
                                                data-guide={`${call}@${String(date)}`}
                                                x={date * stretchX}
                                                y={position * LANE_HEIGHT}
                                                fill={activeCallIds.has(call) ? 'orange' : GUIDE}
                                                fontSize={10}
                                                fontWeight={activeCallIds.has(call) ? 'bold' : 'normal'}
                                                textAnchor='middle'
                                                dominantBaseline='middle'
                                                pointerEvents='none'
                                            >
                                                x
                                            </text>
                                        )))}

                                    {draft && lane === draftLane && (
                                        <DraftGuides
                                            draft={draft}
                                            width={width}
                                            stretchX={stretchX}
                                            onPencil={(e) => {
                                                const at = pointer(e, lane.y)
                                                if (!at || draft.guides.has(at.date)) return
                                                setDraft({ ...draft, guides: new Map(draft.guides).set(at.date, at.position) })
                                            }}
                                            onGrab={setDragging}
                                            onRemove={(date) => {
                                                const guides = new Map(draft.guides)
                                                guides.delete(date)
                                                setDraft({ ...draft, guides })
                                            }}
                                        />
                                    )}
                                </g>
                            )
                        })}

                        <TickScale end={msm.end} stretchX={stretchX} y={plot.axisY} />
                    </svg>
                </div>
            </div>
        </div>
    )
}

interface DraftGuidesProps {
    draft: Draft
    width: number
    stretchX: number
    /** A click in the lane, between the guides. */
    onPencil: (e: MouseEvent<SVGRectElement>) => void
    onGrab: (date: number) => void
    onRemove: (date: number) => void
}

/**
 * The press being guided, in its lane: a surface to pencil guides in, the curve they would write,
 * dashed, and the guides themselves, each a handle.
 */
const DraftGuides = ({ draft, width, stretchX, onPencil, onGrab, onRemove }: DraftGuidesProps) => {
    const id = draft.pedal['xml:id']
    const movements = guidedMovements([...draft.guides].map(([date, position]) => ({ date, position })))

    return (
        <g className='draftGuides' data-press={`guiding_${id}`}>
            {/* Over the movements, which in Guide mode are the surface and not a target. */}
            <rect
                x={0}
                y={0}
                width={width}
                height={LANE_HEIGHT}
                fill='transparent'
                style={{ cursor: 'crosshair' }}
                onClick={onPencil}
            />
            {movements.map((movement, i) => (
                <MovementSegment
                    key={`draft_${String(movement.date)}`}
                    instruction={{
                        id: `${id}_draft_${String(i)}`,
                        date: movement.date,
                        endDate: movements[i + 1]?.date ?? movement.date,
                        position: movement.position as Normalized,
                        ...(movement.transitionTo !== undefined && { transitionTo: movement.transitionTo as Normalized }),
                        ...(movement.curvature !== undefined && { curvature: movement.curvature }),
                        ...(movement.protraction !== undefined && { protraction: movement.protraction }),
                    }}
                    stretchX={stretchX}
                    stretchY={LANE_HEIGHT}
                    fill='none'
                    stroke={GUIDE}
                    strokeDasharray='4 3'
                    pointerEvents='none'
                />
            ))}
            {[...draft.guides].map(([date, position]) => (
                <circle
                    key={`draft_guide_${String(date)}`}
                    data-draft-guide={String(date)}
                    cx={date * stretchX}
                    cy={position * LANE_HEIGHT}
                    r={4}
                    fill={GUIDE}
                    style={{ cursor: 'move' }}
                    onMouseDown={(e) => {
                        e.stopPropagation()
                        onGrab(date)
                    }}
                    onClick={(e) => {
                        e.stopPropagation()
                        if (e.altKey && e.shiftKey) onRemove(date)
                    }}
                >
                    <title>{`${String(date)}: ${String(position)}`}</title>
                </circle>
            ))}
        </g>
    )
}
