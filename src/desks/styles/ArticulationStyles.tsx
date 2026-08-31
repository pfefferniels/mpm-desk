import { Button, Slider, Stack, Typography } from "@mui/material";
import { StylizeArticulation } from "../../fitting/transformers/articulation/StylizeArticulation";
import { getInstructions } from "../../fitting/instructions/index";
import { useState } from "react";
import { ScopedTransformerViewProps } from "../TransformerViewProps";
import { Plot } from "./Plot";

export const ArticulationStyles = ({ mpm, addTransformer, part }: ScopedTransformerViewProps<StylizeArticulation>) => {
    const [volumeTolerance, setVolumeTolerance] = useState(0.05)
    const [relativeDurationTolerance, setRelativeDurationTolerance] = useState(0.15)

    const transformArticulations = () => {
        addTransformer(new StylizeArticulation({
            volumeTolerance,
            relativeDurationTolerance
        }))
    }

    const articulationPoints = new StylizeArticulation({
        relativeDurationTolerance,
        volumeTolerance
    }).clustersOf(getInstructions(mpm, 'articulation', part), mpm)

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

            {/* A fixed range, unlike the ornamentation plot's: both axes are ratios against the
                notated value, so 1 is a fixed and meaningful place on each. */}
            <Plot
                points={articulationPoints}
                x={{ label: 'Relative Duration', min: 0, max: 2.5 }}
                y={{ label: 'Relative Volume', min: 0.5, max: 1.5 }}
                width={600}
                height={400}
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
