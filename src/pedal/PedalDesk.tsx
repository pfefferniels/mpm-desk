import { InsertPedal } from "mpmify/lib/transformers"
import { ScopedTransformerViewProps } from "../DeskSwitch"
import { Button } from "@mui/material"
import { Movement } from "../../../mpm-ts/lib"
import { MovementSegment } from "./MovementSegment"
import { useState } from "react"
import { ZoomControls } from "../ZoomControls"


export const PedalDesk = ({ msm, mpm, setMSM, setMPM, addTransformer }: ScopedTransformerViewProps) => {
    const [stretchX, setStretchX] = useState(0.1)

    const transform = () => {
        const insertPedals = new InsertPedal({
            changeDuration: 200
        })

        insertPedals.transform(msm, mpm)
        insertPedals.insertMetadata(mpm)

        setMSM(msm.clone())
        setMPM(mpm.clone())

        addTransformer(insertPedals)
    }

    const stretchY = 30

    const movements = mpm.getInstructions<Movement>('movement')

    return (
        <div>
            <div style={{ width: '80vw', overflow: 'scroll' }}>
                <ZoomControls
                    setStretchX={setStretchX}
                    stretchX={stretchX}
                    rangeX={[0.01, 0.5]}
                />

                <svg width={10000}>
                    {msm.pedals.map(p => {
                        console.log(p)
                        if (!p.tickDate || !p.tickDuration) return null

                        return (
                            <g key={`pedal${p["xml:id"]}`}>
                                <rect
                                    x={p.tickDate * stretchX}
                                    y={50}
                                    width={p.tickDuration * stretchX}
                                    height={50}
                                    fill='lightblue'
                                />
                            </g>
                        )
                    })}

                    {movements.sort((a, b) => a.date - b.date).map((movement, i) => {
                        if (i === movements.length - 1)
                            return null

                        const endDate = movements[i + 1].date

                        return (
                            <MovementSegment
                                instruction={{ ...movement, endDate }}
                                key={`movement_${movement["xml:id"]}`}
                                stretchX={stretchX}
                                stretchY={stretchY}
                            />
                        )
                    })}
                </svg>
            </div>

            <Button onClick={transform}>Insert Pedals</Button>
        </div>
    )
}
