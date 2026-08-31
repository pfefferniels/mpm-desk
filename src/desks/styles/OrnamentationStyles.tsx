import { useMemo, useState } from "react";
import { ScopedTransformerViewProps } from "../TransformerViewProps";
import { StylizeOrnamentation } from "../../fitting/transformers/ornamentation/StylizeOrnamentation";
import { Stack, Box, Typography, Slider } from "@mui/material";
import { Plot } from "./Plot";
import { axisOver } from "./axis";
import { DeskToolbar } from "../../components/DeskToolbar";
import { ToolGroup } from "../../components/toolbar/ToolGroup";
import { ToolbarButton } from "../../components/toolbar/ToolbarButton";
import { DeleteOutline } from "@mui/icons-material";
import { useCallSelection } from "../../hooks/CallSelection";
import { SilentOrnaments } from "../SilentOrnaments";

interface ToleranceProps {
    label: string
    /** What the epsilon is measured against, in the terms the MPM uses. */
    note: string
    unit?: string
    value: number
    min: number
    max: number
    step: number
    onChange: (value: number) => void
}

const Tolerance = ({ label, note, unit, value, min, max, step, onChange }: ToleranceProps) => (
    <Box>
        <Stack direction='row' justifyContent='space-between' alignItems='baseline'>
            <Typography variant='body2'>{label}</Typography>
            <Typography variant='body2' color='text.secondary'>
                {unit ? `${value} ${unit}` : value}
            </Typography>
        </Stack>
        <Slider
            size='small'
            value={value}
            onChange={(_, newValue) => onChange(newValue as number)}
            step={step}
            min={min}
            max={max}
        />
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{note}</Typography>
    </Box>
)

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

    // Memoised because it walks every ornament in the scope and clusters them twice, and a
    // slider drag repaints this desk on every frame.
    const styles = useMemo(
        () => new StylizeOrnamentation({
            tickTolerance,
            intensityTolerance,
            gradientTolerance
        }).stylesOf(mpm, part),
        [mpm, part, tickTolerance, intensityTolerance, gradientTolerance]
    )

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
                            ? 'The chain already holds a Stylize Ornaments call'
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
                    {/*
                        Beside the buttons, because here it says what they did rather than what
                        was forgotten: a run that leaves the count above zero has skipped those
                        ornaments — an unusable frame is the way that happens — and the button is
                        dead by then, so the state was otherwise unreadable.
                    */}
                    <SilentOrnaments mpm={mpm} scope={part} />
                </ToolGroup>
            </DeskToolbar>

            {/*
                Plot and sliders side by side, and in that order: the plot is what the sliders are
                for. The column carries a width of its own because MUI sizes a slider to its
                container, and a container no wider than its label leaves the control with less
                travel than the text naming it.
            */}
            <Stack direction='row' spacing={4} alignItems='flex-start' sx={{ p: 2 }}>
                <Box>
                    {styles.points.length === 0
                        ? (
                            <Typography color='text.secondary' sx={{ width: 560, py: 4 }}>
                                No ornament here carries a frame. Fit temporal spreads first, or
                                look in another scope — this plot shows the scope the bar is set to.
                            </Typography>
                        )
                        : (
                            <>
                                <Plot
                                    points={styles.points}
                                    x={axisOver('frame.start (ms)', styles.points, 0)}
                                    y={axisOver('frameLength (ms)', styles.points, 1)}
                                    width={560}
                                    height={320}
                                    // Intensity is the third dimension the clustering measures, so
                                    // it is drawn rather than left to the slider alone. Bounded:
                                    // the fit answers up to 5, and a point that size swallows its
                                    // neighbours.
                                    radiusOf={point => 3 + Math.min(point.value[2] ?? 1, 3) * 2}
                                />
                                <Typography variant='caption' color='text.secondary' sx={{ display: 'block', width: 560 }}>
                                    One point per ornament. Colour: the definition it lands in,
                                    grey for one it would hold alone. Size: intensity.
                                </Typography>
                            </>
                        )}
                </Box>

                <Stack spacing={3} sx={{ width: 240 }}>
                    <Tolerance
                        label='Frame'
                        note='frame.start and frameLength'
                        unit='ms'
                        value={tickTolerance}
                        onChange={setTickTolerance}
                        step={1}
                        min={1}
                        max={200}
                    />
                    <Tolerance
                        label='Intensity'
                        note='temporalSpread intensity'
                        value={intensityTolerance}
                        onChange={setIntensityTolerance}
                        step={0.05}
                        min={0}
                        max={2}
                    />
                    <Tolerance
                        label='Gradient'
                        note='dynamicsGradient ends, within a frame cluster'
                        value={gradientTolerance}
                        onChange={setGradientTolerance}
                        step={0.05}
                        min={0}
                        max={2}
                    />
                    <Typography variant='body2' color='text.secondary'>
                        {`${styles.points.length} ornaments → ${styles.definitions} definitions`}
                    </Typography>
                </Stack>
            </Stack>
        </div>
    )
}
