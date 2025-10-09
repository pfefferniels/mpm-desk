import { InsertPedal, InsertPedalOptions } from "mpmify/lib/transformers"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { Movement } from "../../../mpm-ts/lib"
import { MovementSegment } from "./MovementSegment"
import { useState } from "react"
import { useSymbolicZoom } from "../hooks/ZoomProvider"
import { PedalDialog } from "./PedalDialog"
import { usePiano } from "react-pianosound"
import { useNotes } from "../hooks/NotesProvider"
import { MsmPedal } from "mpmify/lib/msm"
import { asMIDI } from "../utils/utils"

export const PedalDesk = ({ msm, mpm, addTransformer, setActiveElement }: ScopedTransformerViewProps<InsertPedal>) => {
    const [currentPedal, setCurrentPedal] = useState<string>()

    const stretchX = useSymbolicZoom()
    const { notes } = useNotes()
    const { play, stop } = usePiano()

    const transform = (options: InsertPedalOptions) => {
        if (!options) return

        addTransformer(new InsertPedal(options))
    }

    const handlePlay = (p: MsmPedal) => {
        if (!p.tickDate || !p.tickDuration) return

        const filtered = notes.filter(n => {
            if (p.tickDate === undefined || p.tickDuration === undefined) return false
            const on = n.tickDate || n.date
            const off = (n.tickDate || n.date) + (n.tickDuration || n.duration)
            return on >= p.tickDate && on < (p.tickDate + p.tickDuration) ||
                off > p.tickDate && off <= (p.tickDate + p.tickDuration)
        })

        console.log('filtered', filtered)

        const midi = asMIDI(filtered)
        if (!midi) return 

        stop()
        play(midi)
    }

    const stretchY = 30

    const movementsByController = Object
        .groupBy(mpm.getInstructions<Movement>('movement'), m => m.controller)

    return (
        <div>
            {currentPedal && (
                <PedalDialog
                    open={currentPedal !== undefined}
                    pedalId={currentPedal}
                    onClose={() => setCurrentPedal(undefined)}
                    onDone={(options) => {
                        transform(options)
                        setCurrentPedal(undefined)
                    }}
                />
            )}
            <div style={{ width: '80vw', overflow: 'scroll' }}>
                <svg width={10000}>
                    {msm.pedals.map(p => {
                        
                        console.log(p)
                        if (!p.tickDate || !p.tickDuration) return null

                        return (
                            <g key={`pedal_${p["xml:id"]}`}>
                                <rect
                                    x={p.tickDate * stretchX}
                                    y={p.type === 'soft' ? 20 : 0}
                                    width={p.tickDuration * stretchX}
                                    height={20}
                                    fill='lightblue'
                                    onClick={() => {
                                        setCurrentPedal(p["xml:id"])
                                    }}
                                    onMouseOver={() => handlePlay(p)}
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
