import { InsertPedal, type InsertPedalOptions } from "../../fitting/transformers/pedal/InsertPedalInstructions"
import type { AlignedPedal } from "../../fitting/alignment"
import { getInstructions } from "../../fitting/instructions/index"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { MovementSegment } from "./MovementSegment"
import { useState } from "react"
import { useSymbolicZoom } from "../../hooks/ZoomProvider"
import { useCallSelection } from "../../hooks/CallSelection"
import { PedalDialog } from "./PedalDialog"
import { usePiano } from "react-pianosound"
import { asMIDI } from "../../utils/utils"
import { useScrollRegistration } from "../../hooks/useScrollRegistration"

export const PedalDesk = ({ msm, mpm, residual, addTransformer }: ScopedTransformerViewProps<InsertPedal>) => {
    const { activeElements, setActiveElement } = useCallSelection();
    const [currentPedal, setCurrentPedal] = useState<AlignedPedal>()

    const stretchX = useSymbolicZoom()
    const { play, stop } = usePiano()

    const scrollContainerRef = useScrollRegistration('pedal-desk', 'symbolic')

    const transform = (options: InsertPedalOptions) => {
        if (!options) return

        addTransformer(new InsertPedal(options))
    }

    const stretchY = 30

    // `@controller` is optional on a `<movement>`. Every one this desk draws was written by
    // `InsertPedal`, which always states it, so the fallback lane exists only so that a
    // movement from somewhere else is still drawn rather than dropped.
    const movementsByController = Object
        .groupBy(getInstructions(mpm, 'movement'), m => m.controller ?? 'unknown')

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
            <div ref={scrollContainerRef} style={{ width: '100vw', overflow: 'scroll' }}>
                <svg width={msm.end * stretchX} height={400}>
                    {msm.pedals.map(p => {
                        // A recorded pedal carries no symbolic date of its own, so where it falls
                        // on the tick grid is the residual's answer and nothing else's. An
                        // undefined `tickDate` means the MPM cannot place it yet — no `<tempo>`
                        // covers it — and an unplaceable pedal is not drawn.
                        const placed = residual.ofPedal(p)
                        if (placed?.tickDate === undefined || !placed.tickDuration) return null

                        return (
                            <g key={`pedal_${p["xml:id"]}`}>
                                <rect
                                    x={placed.tickDate * stretchX}
                                    y={p.type === 'soft' ? 20 : 0}
                                    width={placed.tickDuration * stretchX}
                                    height={20}
                                    fill='lightblue'
                                    onClick={() => {
                                        setCurrentPedal(p)
                                    }}
                                />
                            </g>
                        )
                    })}

                    {Array.from(msm.asChords().entries()).map(([date, chord]) => {
                        return (
                            <g key={`chord_${date}`}>
                                <line
                                    x1={date * stretchX}
                                    y1={0}
                                    x2={date * stretchX}
                                    y2={100}
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

                    <g transform='translate(0, 100)'>
                        {Object
                            .entries(movementsByController)
                            .map(([controller, movements], i) => {
                                if (!movements) return null

                                return (
                                    <g
                                        key={controller}
                                        className={`controller_${controller}`}
                                        transform={`translate(0, ${i * stretchY})`}
                                    >
                                        {movements
                                            .sort((a, b) => a.date - b.date)
                                            .map((movement, i) => {
                                                if (i === movements.length - 1)
                                                    return null

                                                const endDate = movements[i + 1].date

                                                return (
                                                    <MovementSegment
                                                        instruction={{ ...movement, endDate }}
                                                        key={`movement_${movement.id}`}
                                                        stretchX={stretchX}
                                                        stretchY={stretchY}
                                                        onClick={() => movement.id && setActiveElement(movement.id)}
                                                        fill={movement.id && activeElements.includes(movement.id) ? 'orange' : 'lightblue'}
                                                    />
                                                )
                                            })}
                                    </g>
                                )
                            })
                        }
                    </g>
                </svg>
            </div>
        </div>
    )
}
