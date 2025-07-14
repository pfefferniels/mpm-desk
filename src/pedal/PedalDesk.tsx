import { InsertPedal } from "mpmify/lib/transformers"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { Box, Button, Slider, Stack, Typography } from "@mui/material"
import { Movement } from "../../../mpm-ts/lib"
import { MovementSegment } from "./MovementSegment"
import { useState } from "react"
import { createPortal } from "react-dom"
import { Ribbon } from "../Ribbon"
import { useSymbolicZoom } from "../hooks/ZoomProvider"


export const PedalDesk = ({ msm, mpm, addTransformer, appBarRef }: ScopedTransformerViewProps<InsertPedal>) => {
    const [changeDuration, setChangeDuration] = useState(0)

    const stretchX = useSymbolicZoom()

    const transform = () => {
        addTransformer(new InsertPedal({
            changeDuration
        }))
    }

    const stretchY = 30

    const movementsByController = Object
        .groupBy(mpm.getInstructions<Movement>('movement'), m => m.controller)

    return (
        <div>
            <div style={{ width: '80vw', overflow: 'scroll' }}>
                {createPortal((
                    <Ribbon title='Pedal'>
                        <Button
                            onClick={transform}
                            variant="outlined"
                            size='small'
                        >
                            Insert
                        </Button>
                    </Ribbon>
                ), appBarRef.current || document.body)}
                <Stack direction='column' sx={{ maxWidth: '300px' }} spacing={1} p={1}>
                    <Box>
                        <Typography id="change-duration-slider" gutterBottom>
                            Default Change Duration: {changeDuration}
                        </Typography>
                        <Slider
                            value={changeDuration}
                            onChange={(_, value) => setChangeDuration(value as number)}
                            aria-labelledby="change-duration-slider"
                            step={1}
                            marks={[{ value: 0, label: '0' }, { value: 100, label: '100' }, { value: 200, label: '200' }]}
                            min={0}
                            max={200}
                        />
                    </Box>
                </Stack>

                <svg width={10000}>
                    {msm.pedals.map(p => {
                        console.log(p)
                        if (!p.tickDate || !p.tickDuration) return null

                        return (
                            <g key={`pedal${p["xml:id"]}`}>
                                <rect
                                    x={p.tickDate * stretchX}
                                    y={80}
                                    width={p.tickDuration * stretchX}
                                    height={20}
                                    fill='lightblue'
                                />
                            </g>
                        )
                    })}

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
                                                />
                                            )
                                        })}
                                </g>
                            )
                        })
                    }
                </svg>
            </div>
        </div>
    )
}
