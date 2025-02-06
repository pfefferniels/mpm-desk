import { Button, Slider, Stack, Tab, Tabs, Typography } from "@mui/material";
import { CompressOrnamentation, StylizeArticulation, StylizeOrnamentation } from "mpmify/lib/transformers";
import { useState } from "react";
import { ScopedTransformerViewProps } from "../DeskSwitch";
import { Plot } from "./Plot";
import { TabPanel } from "./TabPanel";

export const StylesDesk = ({ msm, mpm, setMSM, setMPM, part }: ScopedTransformerViewProps) => {
    const [volumeTolerance, setVolumeTolerance] = useState(0.05)
    const [relativeDurationTolerance, setRelativeDurationTolerance] = useState(0.15)
    const [tickTolerance, setTickTolerance] = useState(10)
    const [tabIndex, setTabIndex] = useState(0)

    const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
        setTabIndex(newValue)
    }

    const transformArticulations = () => {
        const stylizeArticulation = new StylizeArticulation()
        // const compressArticulation = new CompressArticulation()

        stylizeArticulation.setOptions({
            volumeTolerance,
            relativeDurationTolerance
        })

        stylizeArticulation.transform(msm, mpm)
        // compressArticulation.transform(msm, mpm)

        stylizeArticulation.insertMetadata(mpm)
        // compressArticulation.insertMetadata(mpm)

        setMSM(msm.clone())
        setMPM(mpm.clone())
    }

    const transformOrnaments = () => {
        const stylizeOrnaments = new StylizeOrnamentation()
        const compressOrnaments = new CompressOrnamentation()

        stylizeOrnaments.transform(msm, mpm)
        compressOrnaments.transform(msm, mpm)

        stylizeOrnaments.insertMetadata(mpm)
        compressOrnaments.insertMetadata(mpm)
    }

    const articulationPoints = new StylizeArticulation({
        relativeDurationTolerance,
        volumeTolerance
    }).generateClusters(mpm.getInstructions('articulation', part))

    const ornamentPoints = new StylizeOrnamentation({
        tolerance: tickTolerance
    }).generateClusters(mpm.getInstructions('ornament', part))

    return (
        <div style={{ width: '80vw', overflow: 'scroll' }}>
            <Tabs value={tabIndex} onChange={handleTabChange} aria-label="Ornaments and Articulations tabs">
                <Tab label="Ornaments" id="simple-tab-0" aria-controls="simple-tabpanel-0" />
                <Tab label="Articulations" id="simple-tab-1" aria-controls="simple-tabpanel-1" />
            </Tabs>

            <TabPanel value={tabIndex} index={0}>
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
                    sx={{ maxWidth: '50%' }}
                />
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
                />
                <Button
                    variant='contained'
                    onClick={transformOrnaments}
                >
                    Stylize Ornaments
                </Button>
            </TabPanel>

            <TabPanel value={tabIndex} index={1}>
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
            </TabPanel>
        </div>
    )
}
