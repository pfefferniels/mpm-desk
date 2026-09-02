import { InsertPedal, type InsertPedalOptions } from "../../fitting/transformers/pedal/InsertPedalInstructions"
import { rowId, type AlignedPedal } from "../../fitting/alignment"
import { getInstructions } from "../../fitting/instructions/index"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { MovementSegment } from "./MovementSegment"
import { useState } from "react"
import { useSymbolicZoom } from "../../hooks/ZoomProvider"
import { useCallSelection } from "../../hooks/CallSelection"
import { PedalDialog } from "./PedalDialog"
import { usePiano } from "../../performance/piano"
import { asMIDI } from "../../utils/utils"
import { useScrollRegistration } from "../../hooks/useScrollRegistration"
import { filterMap } from "espressivo"
import { PedalGutter, TickScale } from "./PedalAxes"
import { GUTTER_WIDTH, LANE_HEIGHT, MOVEMENT_TOP, ROW_HEIGHT, pedalPlot, rowY } from "./layout"

export const PedalDesk = ({ msm, mpm, residual, addTransformer }: ScopedTransformerViewProps<InsertPedal>) => {
    const { activeElements, setActiveElement } = useCallSelection();
    const [currentPedal, setCurrentPedal] = useState<AlignedPedal>()

    const stretchX = useSymbolicZoom()
    const { play, stop } = usePiano()

    const scrollContainerRef = useScrollRegistration('pedal-desk', 'symbolic')

    // `needsChoice` holds this desk shut until a base text has been chosen, and choosing one is
    // what leaves a residual to place the pedals by: the type system catching up with that, not a
    // case being handled. Below the hooks, so the desk keeps calling the same ones either way.
    if (!residual) return null

    const transform = (options: InsertPedalOptions) => {
        if (!options) return

        addTransformer(new InsertPedal(options))
    }

    // `@controller` is optional on a `<movement>`. Every one this desk draws was written by
    // `InsertPedal`, which always states it, so the fallback lane exists only so that a
    // movement from somewhere else is still drawn rather than dropped.
    const movementsByController = Object
        .groupBy(getInstructions(mpm, 'movement'), m => m.controller ?? 'unknown')

    // A recorded pedal carries no symbolic date of its own, so where it falls on the tick grid
    // is the residual's answer and nothing else's. An undefined `tickDate` means the MPM cannot
    // place it yet — no `<tempo>` covers it — and an unplaceable pedal is neither drawn nor named.
    const presses = filterMap(msm.pedals, pedal => {
        const placed = residual.ofPedal(pedal)
        if (placed?.tickDate === undefined || !placed.tickDuration) return null

        return { pedal, date: placed.tickDate, duration: placed.tickDuration }
    })

    const plot = pedalPlot(
        presses.map(press => press.pedal.type),
        Object.keys(movementsByController),
    )
    const width = msm.end * stretchX

    return (
        <div>
            {currentPedal && (
                <PedalDialog
                    open={currentPedal !== undefined}
                    pedal={currentPedal}
                    residual={residual}
                    onClose={() => setCurrentPedal(undefined)}
                    onDone={(options) => {
                        transform(options)
                        setCurrentPedal(undefined)
                    }}
                />
            )}
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
                    <svg width={width} height={plot.height}>
                        {presses.map(({ pedal, date, duration }) => (
                            <rect
                                key={`pedal_${rowId(pedal)}`}
                                x={date * stretchX}
                                y={rowY(pedal.type)}
                                width={duration * stretchX}
                                height={ROW_HEIGHT}
                                fill='lightblue'
                                onClick={() => {
                                    setCurrentPedal(pedal)
                                }}
                            />
                        ))}

                        {/*
                            `'global'` on purpose, unlike the arpeggiation desks: a pedal is a
                            property of the instrument, `InsertPedal` writes to `movement`/`global`
                            whatever the picker says, and these lines are the texture under a press.
                        */}
                        {Array.from(msm.in('global').chords().entries()).map(([date, chord]) => {
                            return (
                                <g key={`chord_${date}`}>
                                    <line
                                        x1={date * stretchX}
                                        y1={0}
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

                                    {movements.map((movement, i) => {
                                        if (i === movements.length - 1)
                                            return null

                                        const endDate = movements[i + 1].date

                                        return (
                                            <MovementSegment
                                                instruction={{ ...movement, endDate }}
                                                key={`movement_${movement.id}`}
                                                stretchX={stretchX}
                                                stretchY={LANE_HEIGHT}
                                                onClick={() => movement.id && setActiveElement(movement.id)}
                                                fill={movement.id && activeElements.includes(movement.id) ? 'orange' : 'lightblue'}
                                            />
                                        )
                                    })}
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
