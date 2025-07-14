import { useState } from "react";
import { ScopedTransformerViewProps } from "../TransformerViewProps";
import { StylizeOrnamentation } from "mpmify";
import { Stack, Box, Typography, Slider, Button } from "@mui/material";
import { Plot } from "./Plot";
import { createPortal } from "react-dom";

export const OrnamentationStyles = ({ mpm, addTransformer, part, appBarRef }: ScopedTransformerViewProps<StylizeOrnamentation>) => {
    const [tickTolerance, setTickTolerance] = useState(10)
    const [intensityTolerance, setIntensityTolerance] = useState(0.2)
    const [gradientTolerance, setGradientTolerance] = useState(0.2)

    const transformOrnaments = () => {
        addTransformer(new StylizeOrnamentation({
            tickTolerance,
            intensityTolerance,
            gradientTolerance
        }))
    }

    const ornamentPoints = new StylizeOrnamentation({
        tickTolerance,
        intensityTolerance,
        gradientTolerance: 0.2
    }).generateClusters(mpm.getInstructions('ornament', part))

    return (
        <div>
            <Stack direction='row' spacing={1} sx={{ maxWidth: '80%' }}>
                <Box>
                    <Typography gutterBottom>
                        Tick Tolerance
                    </Typography>
                    <Slider
                        value={tickTolerance}
                        onChange={(_, newValue) => setTickTolerance(newValue as number)}
                        step={1}
                        min={1}
                        max={20}
                        valueLabelDisplay="auto"
                    />
                </Box>
                <Box>
                    <Typography gutterBottom>
                        Intensity Tolerance
                    </Typography>
                    <Slider
                        value={intensityTolerance}
                        onChange={(_, newValue) => setIntensityTolerance(newValue as number)}
                        step={0.05}
                        min={0.00}
                        max={2}
                        valueLabelDisplay="auto"
                    />
                </Box>
                <Box>
                    <Typography gutterBottom>
                        Gradient Tolerance
                    </Typography>
                    <Slider
                        value={gradientTolerance}
                        onChange={(_, newValue) => setGradientTolerance(newValue as number)}
                        step={0.05}
                        min={0.00}
                        max={2}
                        valueLabelDisplay="auto"
                    />
                </Box>
            </Stack>

            <Plot
                points={ornamentPoints}
                xLabel="Frame start"
                yLabel="Frame length"
                xMin={-200}
                xMax={50}
                yMin={0}
                yMax={250}
                xStep={25}
                yStep={25}
                xStretch={5}
                yStretch={1.5}
                rStretch={2}
            />

            {createPortal((
                <Button
                    variant='contained'
                    onClick={transformOrnaments}
                >
                    Stylize Ornaments
                </Button>
            ), appBarRef.current || document.body)}
        </div>
    )
}