import { useState } from "react";
import { ScopedTransformerViewProps } from "../TransformerViewProps";
import { StylizeOrnamentation } from "../../fitting/transformers/ornamentation/StylizeOrnamentation";
import { Stack, Box, Typography, Slider } from "@mui/material";
import { Plot } from "./Plot";
import { DeskToolbar } from "../../components/DeskToolbar";
import { ToolGroup } from "../../components/toolbar/ToolGroup";
import { ToolbarButton } from "../../components/toolbar/ToolbarButton";
import { DeleteOutline } from "@mui/icons-material";
import { useCallSelection } from "../../hooks/CallSelection";

export const OrnamentationStyles = ({ mpm, addTransformer, part }: ScopedTransformerViewProps<StylizeOrnamentation>) => {
    const { calls, removeCall } = useCallSelection()

    // By name alone, and unlike the two arpeggiation desks that is correct here.
    // `StylizeOrnamentationOptions` carries no `scope` — `transform` loops over `scopesOf(mpm)`
    // and defines the whole document's ornaments in one pass — so there is exactly one such call
    // to find. `part` narrows what the plot below shows, not what the call covers; adding
    // `t.options.scope === part` would compare against an attribute that is never written and
    // leave `Stylize Ornaments` live forever.
    const existingTransformer = calls.find(t => t.name === 'StylizeOrnamentation')
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
    }).clustersOf(mpm, part)

    return (
        <div>
            {/*
                First in the tree, where every other desk puts it. It portals into the app bar
                either way, so the position here changes nothing on screen — but a reader looking
                for this desk's controls had to scroll past three sliders and a plot to find them.

                One button became two; see the note in `TemporalSpreadDesk` for the four reasons.
                The tolerance sliders stay in the page: a continuous input needs travel, and 200px
                of slider in a 44px row is not a control.
            */}
            <DeskToolbar>
                <ToolGroup>
                    <ToolbarButton
                        primary
                        label='Stylize Ornaments'
                        tooltip={existingTransformer
                            ? 'The ornaments are already stylized'
                            : 'Cluster the fitted ornaments and define one style per cluster'}
                        disabled={existingTransformer !== undefined}
                        onClick={transformOrnaments}
                    >
                        Stylize Ornaments
                    </ToolbarButton>
                    <ToolbarButton
                        icon={<DeleteOutline />}
                        label='Remove Style'
                        tooltip={existingTransformer
                            ? 'Drop the ornament definitions and leave the ornaments as fitted'
                            : 'The ornaments are not stylized yet'}
                        disabled={!existingTransformer}
                        onClick={() => { if (existingTransformer) removeCall(existingTransformer.id) }}
                    >
                        Remove Style
                    </ToolbarButton>
                </ToolGroup>
            </DeskToolbar>

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
        </div>
    )
}