import { useMemo, useState } from "react";
import { ScopedTransformerViewProps } from "../TransformerViewProps";
import { StylizeOrnamentation } from "../../fitting/transformers/ornamentation/StylizeOrnamentation";
import { FrameDomain } from "espressivo";
import { Stack, Box, Typography, Slider } from "@mui/material";
import { Plot } from "./Plot";
import { axisOver } from "./axis";
import { DeskToolbar } from "../../components/DeskToolbar";
import { ToolGroup } from "../../components/toolbar/ToolGroup";
import { ToolbarButton } from "../../components/toolbar/ToolbarButton";
import { DeleteOutline } from "@mui/icons-material";
import { useCallSelection } from "../../hooks/CallSelection";
import { useEditable } from "../../hooks/Editing";
import { isCallOf } from "../../fitting/calls";
import { SilentOrnaments } from "../SilentOrnaments";
import { GRACE_COLOUR } from "../arpeggiation/graceFigures";

interface ToleranceProps {
    label: string
    /** What the epsilon is measured against, in the terms the MPM uses. */
    note: string
    unit?: string
    value: number
    min: number
    max: number
    step: number
    /** Held where it is, at the tolerance a call already stylized with. */
    disabled?: boolean
    onChange: (value: number) => void
}

const Tolerance = ({ label, note, unit, value, min, max, step, disabled, onChange }: ToleranceProps) => (
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
            disabled={disabled}
        />
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{note}</Typography>
    </Box>
)

/** Where the sliders start, and what the viewer clusters at where the chain stylizes nothing. */
const DEFAULT_TOLERANCES = { tickTolerance: 10, intensityTolerance: 0.2, gradientTolerance: 0.2 }

/**
 * The unit the frames are in, as the axes and the frame tolerance state it.
 *
 * Read off the ornaments rather than assumed. The fitters measure in milliseconds, but the hinge
 * puts every frame a tempo covers into ticks before the style call clusters it, so a chain's
 * frames are ticks. The axes said milliseconds, which they were before the hinge ran in every
 * chain.
 */
const unitOf = (units: readonly FrameDomain[]): string =>
    units.length === 1 && units[0] === FrameDomain.Milliseconds
        ? 'ms'
        : units.length > 1 ? 'ticks or ms' : 'ticks'

/**
 * The fitted ornaments of a scope as the clustering places them, and the tolerances that decide
 * which share a definition.
 *
 * Drawn from the document as the chain's `StylizeOrnamentation` call found it (`found`), where
 * there is one. The call moves every frame into an `<ornamentDef>` and clears it off the
 * ornament, so the finished document has no ornament left to place: the reconstruction's 97
 * spreads drew as an empty plot. Before the call, and in the editor until Stylize, the two are
 * the same document.
 *
 * Where there is a call the tolerances are its own, in either mode, so the colours are the
 * definitions it wrote rather than what the sliders would make. In the editor the sliders hold at
 * those values until Remove Style frees them; in the viewer they and both buttons are gone and the
 * tolerances are stated instead. With no call the viewer clusters at the defaults, and says so.
 * The count of silent ornaments stays in the bar, being a fact about the chain rather than a
 * control, and is counted on the finished document, which is the one that sounds.
 */
export const OrnamentationStyles = ({ mpm, found, addTransformer, part }: ScopedTransformerViewProps<StylizeOrnamentation>) => {
    const { calls, removeCall } = useCallSelection()
    const editable = useEditable()

    // By name alone, and unlike the two arpeggiation desks that is correct here.
    // `StylizeOrnamentationOptions` carries no `scope` — `transform` loops over `scopesOf(mpm)`
    // and defines the whole document's ornaments in one pass — so there is exactly one such call
    // to find. `part` narrows what the plot below shows, not what the call covers; adding
    // `t.options.scope === part` would compare against an attribute that is never written and
    // leave `Stylize Ornaments` live forever.
    const existingTransformer = calls.find(isCallOf('StylizeOrnamentation'))
    const [draftTick, setTickTolerance] = useState(DEFAULT_TOLERANCES.tickTolerance)
    const [draftIntensity, setIntensityTolerance] = useState(DEFAULT_TOLERANCES.intensityTolerance)
    const [draftGradient, setGradientTolerance] = useState(DEFAULT_TOLERANCES.gradientTolerance)
    const { tickTolerance, intensityTolerance, gradientTolerance } = existingTransformer
        ? { ...DEFAULT_TOLERANCES, ...existingTransformer.options }
        : editable
            ? { tickTolerance: draftTick, intensityTolerance: draftIntensity, gradientTolerance: draftGradient }
            : DEFAULT_TOLERANCES

    const transformOrnaments = () => {
        addTransformer(new StylizeOrnamentation({
            tickTolerance,
            intensityTolerance,
            gradientTolerance
        }))
    }

    // Memoised because it walks every ornament in the scope and clusters them twice, and a
    // slider drag repaints this desk on every frame.
    const plotted = found ?? mpm
    const styles = useMemo(
        () => new StylizeOrnamentation({
            tickTolerance,
            intensityTolerance,
            gradientTolerance
        }).stylesOf(plotted, part),
        [plotted, part, tickTolerance, intensityTolerance, gradientTolerance]
    )
    const unit = unitOf(styles.units)

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
                    {editable && <>
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
                    </>}
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
                    {/*
                        Two sentences, one per mode. Fitting is the editor's remedy and no answer to
                        a reader of the viewer, who can do nothing about it; there the plot is empty
                        because the reconstruction made no spread here, and the scope is all that
                        is theirs to change. A spread is a roll's or a grace figure's alike: both
                        are fitted on the Temporal Spread desk and both are clustered here.
                    */}
                    {styles.points.length === 0
                        ? (
                            <Typography color='text.secondary' sx={{ width: 560, py: 4 }}>
                                {editable
                                    ? 'No ornament here carries a frame. Fit temporal spreads first, or look in another scope'
                                    : 'The reconstruction fits no temporal spread in this scope, so it has no ornament here to cluster. Look in another'}
                                {' — this plot shows the scope the bar is set to.'}
                            </Typography>
                        )
                        : (
                            <>
                                <Plot
                                    points={styles.points}
                                    x={axisOver(`frame.offset (${unit})`, styles.points, 0)}
                                    y={axisOver(`frameLength (${unit})`, styles.points, 1)}
                                    width={560}
                                    height={320}
                                    // Intensity is the third dimension the clustering measures, so
                                    // it is drawn rather than left to the slider alone. Bounded:
                                    // the fit answers up to 5, and a point that size swallows its
                                    // neighbours.
                                    radiusOf={point => 3 + Math.min(point.value[2] ?? 1, 3) * 2}
                                    // A figure is clustered on its frame like any roll, so the
                                    // fill is the definition's either way and the ring says
                                    // which kind of ornament the point is.
                                    ringOf={point => styles.figures.has(point.index) ? GRACE_COLOUR : undefined}
                                />
                                <Typography variant='caption' color='text.secondary' sx={{ display: 'block', width: 560 }}>
                                    One point per ornament, where the fitters measured it.
                                    Colour: the definition it lands in, grey for one it holds
                                    alone. Size: intensity. Ringed in{' '}
                                    <Box component='span' sx={{ color: GRACE_COLOUR, fontWeight: 600 }}>this colour</Box>
                                    : a grace figure.
                                </Typography>
                            </>
                        )}
                </Box>

                <Stack spacing={3} sx={{ width: 240 }}>
                    {!editable && (
                        <Typography variant='body2' color='text.secondary'>
                            {existingTransformer
                                ? `Clustered as the reconstruction stylized its ornaments: frame within ${tickTolerance} ${unit}, intensity within ${intensityTolerance}, gradient within ${gradientTolerance}.`
                                : 'The reconstruction does not stylize its ornaments. The colours are what the default tolerances would make of them.'}
                        </Typography>
                    )}
                    {editable && <>
                        <Tolerance
                            label='Frame'
                            note='frame.offset and frameLength'
                            unit={unit}
                            value={tickTolerance}
                            onChange={setTickTolerance}
                            disabled={existingTransformer !== undefined}
                            step={1}
                            min={1}
                            max={200}
                        />
                        <Tolerance
                            label='Intensity'
                            note='temporalSpread intensity'
                            value={intensityTolerance}
                            onChange={setIntensityTolerance}
                            disabled={existingTransformer !== undefined}
                            step={0.05}
                            min={0}
                            max={2}
                        />
                        <Tolerance
                            label='Gradient'
                            note='dynamicsGradient ends, within a frame cluster'
                            value={gradientTolerance}
                            onChange={setGradientTolerance}
                            disabled={existingTransformer !== undefined}
                            step={0.05}
                            min={0}
                            max={2}
                        />
                        {existingTransformer && (
                            <Typography variant='body2' color='text.secondary'>
                                Held at the tolerances Stylize Ornaments was called with, which
                                are what wrote these definitions. Remove Style to try others.
                            </Typography>
                        )}
                    </>}
                    <Typography variant='body2' color='text.secondary'>
                        {`${styles.points.length} ornaments → ${styles.definitions} definitions`}
                    </Typography>
                </Stack>
            </Stack>
        </div>
    )
}
