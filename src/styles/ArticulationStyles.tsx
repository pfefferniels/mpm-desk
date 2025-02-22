import { Button, Slider, Stack, Typography } from "@mui/material";
import { StylizeArticulation } from "mpmify/lib/transformers";
import { useState } from "react";
import { ScopedTransformerViewProps } from "../DeskSwitch";
import { Plot } from "./Plot";

export const ArticulationStyles = ({ msm, setMSM, setMPM, mpm, addTransformer, part }: ScopedTransformerViewProps) => {
    const [volumeTolerance, setVolumeTolerance] = useState(0.05)
    const [relativeDurationTolerance, setRelativeDurationTolerance] = useState(0.15)

    const transformArticulations = () => {
        const stylizeArticulation = new StylizeArticulation({
            volumeTolerance,
            relativeDurationTolerance
        })

        // const compressArticulation = new CompressArticulation()

        stylizeArticulation.run(msm, mpm)
        // compressArticulation.run(msm, mpm)

        setMSM(msm.clone())
        setMPM(mpm.clone())

        addTransformer(stylizeArticulation)
    }


    const articulationPoints = new StylizeArticulation({
        relativeDurationTolerance,
        volumeTolerance
    }).generateClusters(mpm.getInstructions('articulation', part))

    //const ornamentDefPoints = mpm
    //    .getDefinitions<OrnamentDef>('ornamentDef', part)

    return (
        <div>
            <Stack direction='row' spacing={1}>
                <Typography gutterBottom>
                    Volume Tolerance
                </Typography>
                <Slider
                    value={volumeTolerance}
                    onChange={(_, newValue) => setVolumeTolerance(newValue as number)}
                    step={0.01}
                    min={0}
                    max={1}
                    valueLabelDisplay="auto"
                />

                <Typography gutterBottom>
                    Duration Tolerance
                </Typography>
                <Slider
                    value={relativeDurationTolerance}
                    onChange={(_, newValue) => setRelativeDurationTolerance(newValue as number)}
                    step={0.01}
                    min={0}
                    max={1}
                    valueLabelDisplay="auto"
                />
            </Stack>

            <Plot
                points={articulationPoints}
                xLabel="Relative Duration"
                yLabel="Relative Volume"
                xMin={0}
                xMax={2.5}
                yMin={0.5}
                yMax={1.5}
                xStep={0.25}
                yStep={0.25}
                xStretch={500}
                yStretch={400}
            />

            <br />

            <Button
                variant='contained'
                onClick={transformArticulations}
            >
                Stylize Articulations
            </Button>
        </div>
    )
}
