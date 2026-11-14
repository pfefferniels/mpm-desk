import { Slider, Stack, Typography } from "@mui/material"
import { DeleteOutline } from "@mui/icons-material"
import { useMemo, useState } from "react"
import { StylizeArticulation } from "../../fitting/transformers/articulation/StylizeArticulation"
import { getInstructions, scopesOf } from "../../fitting/instructions/index"
import type { IPoint } from "../../fitting/dbscan"
import { DeskToolbar } from "../../components/DeskToolbar"
import { ToolGroup } from "../../components/toolbar/ToolGroup"
import { ToolbarButton } from "../../components/toolbar/ToolbarButton"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { useCallSelection } from "../../hooks/CallSelection"
import { useEditable } from "../../hooks/Editing"
import { isCallOf } from "../../fitting/calls"
import { Plot } from "./Plot"
import type { Axis } from "./axis"

/**
 * The points the clustering could place.
 *
 * `clustersOf` answers one point per articulation and keeps the slot of every one it could not
 * place — nothing stating a relative pair, or an absolute attribute no shared def could carry —
 * so the length of its answer counts articulations rather than anything the clustering measured.
 * That is the question the button asks; what the plot draws is `positionsOf`.
 */
const placeable = (points: readonly IPoint[]) => points.filter(point => point.value.length > 0)

/**
 * For the questions that do not depend on a tolerance.
 *
 * `generateClusters` decides whether an articulation has a position at all before dbscan sees it,
 * and the tolerances only decide which cluster a placed point then lands in; where a point is drawn
 * depends on neither. This instance carries the defaults and is asked nothing else.
 */
const placement = new StylizeArticulation()

/** Where the sliders start, and what the viewer clusters at where the chain stylizes nothing. */
const DEFAULT_TOLERANCES = { volumeTolerance: 0.05, relativeDurationTolerance: 0.15 }

/**
 * `axis`, widened to take in every value drawn on it.
 *
 * Fixed, unlike the ornamentation plot's: both axes are ratios against the notated value, so 1 is
 * a fixed and meaningful place on each, and two scopes are drawn to one scale. Widened only where a
 * value would fall off it: the reconstruction has four articulations at a relative velocity of
 * 1.78, which a plot stopping at 1.5 clips away.
 */
const spanning = (axis: Axis, values: readonly number[]): Axis => {
    const min = Math.min(axis.min, ...values)
    const max = Math.max(axis.max, ...values)
    const padding = (max - min) * 0.04
    return {
        label: axis.label,
        min: min < axis.min ? min - padding : min,
        max: max > axis.max ? max + padding : max,
    }
}

/**
 * The articulations of a scope where they render, and the tolerances that decide which share a
 * def.
 *
 * Every articulation is drawn at the two ratios it renders with, a ratio its def leaves unstated
 * being 1, as the renderer reads it. The clustering only places one whose def states both, and
 * drawing only what it placed showed 3 of the reconstruction's 65 articulations: the 56 on a def
 * stating a relative duration alone and the 4 on one stating a volume alone were left out. They
 * are drawn now, and coloured as what they are to the clustering: left alone. An articulation with
 * an absolute duration in force has no place on a ratio axis and is counted under the plot
 * rather than drawn.
 *
 * Drawn from the document as the chain's `StylizeArticulation` call found it (`found`), where
 * there is one, as the ornament Styles desk is: the call repoints each articulation at its
 * cluster's mean and takes the largest cluster's away for a `defaultArticulation`, so the finished
 * document no longer holds what was clustered. The tolerances are then the call's in either mode,
 * the sliders holding at them in the editor until Remove Style; in the viewer there are no sliders
 * and no buttons, and where the reconstruction made no call it clusters at the defaults and says
 * so — the colours are then what stylizing would do, not what was done.
 */
export const ArticulationStyles = ({ mpm, found, addTransformer, part }: ScopedTransformerViewProps<StylizeArticulation>) => {
    const editable = useEditable()
    const { calls, removeCall } = useCallSelection()
    const written = calls.find(isCallOf('StylizeArticulation'))

    const [draftVolume, setVolumeTolerance] = useState(DEFAULT_TOLERANCES.volumeTolerance)
    const [draftDuration, setRelativeDurationTolerance] = useState(DEFAULT_TOLERANCES.relativeDurationTolerance)
    const shown = written
        ? { ...DEFAULT_TOLERANCES, ...written.options }
        : editable
            ? { volumeTolerance: draftVolume, relativeDurationTolerance: draftDuration }
            : DEFAULT_TOLERANCES
    const { volumeTolerance, relativeDurationTolerance } = shown

    const transformArticulations = () => {
        addTransformer(new StylizeArticulation({
            volumeTolerance,
            relativeDurationTolerance
        }))
    }

    const plotted = found ?? mpm
    const articulations = useMemo(() => getInstructions(plotted, 'articulation', part), [plotted, part])

    // Memoised because it reads every articulation in the scope through the definition each one
    // names and then clusters them, and a slider drag repaints this desk on every frame.
    const clusters = useMemo(
        () => new StylizeArticulation({
            relativeDurationTolerance,
            volumeTolerance
        }).clustersOf(articulations, plotted),
        [articulations, plotted, relativeDurationTolerance, volumeTolerance]
    )

    // The clustering's labels at the renderer's positions: the slots line up, both answering one
    // entry per articulation in the order given. One with no position keeps `[]`, which `Plot`
    // skips.
    const positions = useMemo(() => placement.positionsOf(articulations, plotted), [articulations, plotted])
    const points = clusters.map((point, index) => ({ ...point, value: [...(positions[index] ?? [])] }))
    const drawn = points.filter(point => point.value.length > 0)
    const absolute = points.length - drawn.length

    // Over the whole document, unlike the plot: `transform` loops over `scopesOf(mpm)` and
    // restyles every scope it finds, so `part` narrows what is drawn and not what the call covers.
    // Gating the button on the scope on screen would withhold a call that has work to do elsewhere.
    const canStylize = useMemo(
        () => scopesOf(mpm).some(scope =>
            placeable(placement.clustersOf(getInstructions(mpm, 'articulation', scope), mpm)).length > 0),
        [mpm]
    )

    // One sentence per case and mode. Fitting is the editor's remedy and no answer to a reader of
    // the viewer, and no remedy at all for an absolute duration, which a fit wrote on purpose.
    const emptyNote = articulations.length > 0
        ? 'Every articulation here has an absolute duration, which replaces the notated one rather than scaling it, so none is drawn. Look in another scope'
        : editable
            ? 'No articulation here. Fit articulations first, or look in another scope'
            : 'The reconstruction articulates nothing in this scope. Look in another'

    return (
        <div>
            {editable && <DeskToolbar>
                <ToolGroup>
                    <ToolbarButton
                        primary
                        label='Stylize Articulations'
                        tooltip={written
                            ? 'The chain already holds a Stylize Articulations call'
                            : canStylize
                                ? 'Cluster the articulations and define one style per cluster'
                                : 'Nothing in the document can share a def. Fit articulations first'}
                        disabled={written !== undefined || !canStylize}
                        onClick={transformArticulations}
                    >
                        Stylize Articulations
                    </ToolbarButton>
                    <ToolbarButton
                        icon={<DeleteOutline />}
                        label='Remove Style'
                        tooltip={written
                            ? 'Drop the shared defs and leave the articulations as fitted'
                            : 'The articulations are not stylized yet'}
                        disabled={!written}
                        onClick={() => { if (written) removeCall(written.id) }}
                    >
                        Remove Style
                    </ToolbarButton>
                </ToolGroup>
            </DeskToolbar>}

            {!editable && (
                <Typography variant='body2' color='text.secondary' sx={{ width: 600, py: 1 }}>
                    {written
                        ? `Clustered as the reconstruction stylized its articulations: volume within ${volumeTolerance}, duration within ${relativeDurationTolerance}.`
                        : 'The reconstruction does not stylize its articulations. The colours are what the default tolerances would make of them.'}
                </Typography>
            )}

            {editable && <Stack direction='row' spacing={1}>
                <Typography gutterBottom>
                    Volume Tolerance
                </Typography>
                <Slider
                    value={volumeTolerance}
                    onChange={(_, newValue) => setVolumeTolerance(newValue as number)}
                    disabled={written !== undefined}
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
                    disabled={written !== undefined}
                    step={0.01}
                    min={0}
                    max={1}
                    valueLabelDisplay="auto"
                />
            </Stack>}
            {editable && written && (
                <Typography variant='body2' color='text.secondary' sx={{ width: 600 }}>
                    Held at the tolerances Stylize Articulations was called with, which are what
                    wrote these defs. Remove Style to try others.
                </Typography>
            )}

            {drawn.length === 0
                ? (
                    <Typography color='text.secondary' sx={{ width: 600, py: 4 }}>
                        {`${emptyNote} — this plot shows the scope the bar is set to.`}
                    </Typography>
                )
                : (
                    <>
                        <Plot
                            points={points}
                            x={spanning({ label: 'Relative Duration', min: 0, max: 2.5 }, drawn.map(point => point.value[0] ?? 1))}
                            y={spanning({ label: 'Relative Volume', min: 0.5, max: 1.5 }, drawn.map(point => point.value[1] ?? 1))}
                            width={600}
                            height={400}
                        />
                        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', width: 600 }}>
                            One point per articulation, at the ratios it renders with; one its def
                            leaves unstated is 1. Colour: the def it shares, grey for one left
                            alone — alone at these tolerances, or on a def that does not state both
                            ratios, which a shared def has to.
                            {absolute > 0 && ` Not drawn: ${absolute} with an absolute duration, which replaces the notated one rather than scaling it.`}
                        </Typography>
                    </>
                )}
        </div>
    )
}
