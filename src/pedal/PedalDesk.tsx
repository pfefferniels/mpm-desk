import { InsertPedal, InsertPedalOptions } from "mpmify/lib/transformers"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { Movement } from "../../../mpm-ts/lib"
import { MovementSegment } from "./MovementSegment"
import { useState, useCallback } from "react"
import { useSymbolicZoom } from "../hooks/ZoomProvider"
import { useSelection } from "../hooks/SelectionProvider"
import { PedalDialog } from "./PedalDialog"
import { usePiano } from "react-pianosound"
import { asMIDI } from "../utils/utils"
import { MsmPedal } from "mpmify/lib/msm"
import { useScrollSync } from "../hooks/ScrollSyncProvider"

export const PedalDesk = ({ msm, mpm, addTransformer }: ScopedTransformerViewProps<InsertPedal>) => {
    const { activeElements, setActiveElement } = useSelection();
    const [currentPedal, setCurrentPedal] = useState<MsmPedal>()

    const stretchX = useSymbolicZoom()
    const { play, stop } = usePiano()

    const { register, unregister } = useScrollSync();
    const scrollContainerRef = useCallback((element: HTMLDivElement | null) => {
        if (element) {
            register('pedal-desk', element, 'symbolic');
        } else {
            unregister('pedal-desk');
        }
    }, [register, unregister]);

    const transform = (options: InsertPedalOptions) => {
        if (!options) return

        addTransformer(new InsertPedal(options))
    }

    const stretchY = 30

    const movementsByController = Object
        .groupBy(mpm.getInstructions<Movement>('movement'), m => m.controller)

    return (
        <div>
            {currentPedal && (
                <PedalDialog
                    open={currentPedal !== undefined}
                    pedal={currentPedal}
                    onClose={() => setCurrentPedal(undefined)}
                    onDone={(options) => {
                        transform(options)
                        setCurrentPedal(undefined)
                    }}
                />
            )}
            <div ref={scrollContainerRef} style={{ width: '100vw', overflow: 'scroll' }}>
                <svg width={10000} height={400}>
                    {msm.pedals.map(p => {
                        
                        console.log(p)
                        if (p.tickDate === undefined || !p.tickDuration) return null

                        return (
                            <g key={`pedal_${p["xml:id"]}`}>
                                <rect
                                    x={p.tickDate * stretchX}
                                    y={p.type === 'soft' ? 20 : 0}
                                    width={p.tickDuration * stretchX}
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
                                                        key={`movement_${movement["xml:id"]}`}
                                                        stretchX={stretchX}
                                                        stretchY={stretchY}
                                                        onClick={() => setActiveElement(movement["xml:id"])}
                                                        fill={activeElements.includes(movement["xml:id"]) ? 'orange' : 'lightblue'}
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
