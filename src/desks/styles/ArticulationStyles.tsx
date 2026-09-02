import { Slider, Stack, Typography } from "@mui/material"
import { useMemo, useState } from "react"
import { StylizeArticulation } from "../../fitting/transformers/articulation/StylizeArticulation"
import { getInstructions, scopesOf } from "../../fitting/instructions/index"
import type { IPoint } from "../../fitting/dbscan"
import { DeskToolbar } from "../../components/DeskToolbar"
import { ToolGroup } from "../../components/toolbar/ToolGroup"
import { ToolbarButton } from "../../components/toolbar/ToolbarButton"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { Plot } from "./Plot"

/**
 * The points the clustering could place.
 *
 * `clustersOf` answers one point per articulation and keeps the slot of every one it could not
 * place — nothing stating a relative pair, or an absolute attribute no shared def could carry —
 * so the length of its answer counts articulations rather than anything the plot can draw. A
 * scope of nothing but those draws the same empty surface as a scope holding no articulation at
 * all, which is the state this desk had no word for (issue #41).
 */
const placeable = (points: readonly IPoint[]) => points.filter(point => point.value.length > 0)

/**
 * For the one question that does not depend on a tolerance.
 *
 * `generateClusters` decides whether an articulation has a position at all before dbscan sees it,
 * and the tolerances only decide which cluster a placed point then lands in. This instance carries
 * the defaults and is asked nothing else.
 */
const placement = new StylizeArticulation()

export const ArticulationStyles = ({ mpm, addTransformer, part }: ScopedTransformerViewProps<StylizeArticulation>) => {
    const [volumeTolerance, setVolumeTolerance] = useState(0.05)
    const [relativeDurationTolerance, setRelativeDurationTolerance] = useState(0.15)

    const transformArticulations = () => {
        addTransformer(new StylizeArticulation({
            volumeTolerance,
            relativeDurationTolerance
        }))
    }

    // Memoised because it reads every articulation in the scope through the definition each one
    // names and then clusters them, and a slider drag repaints this desk on every frame.
    const articulationPoints = useMemo(
        () => new StylizeArticulation({
            relativeDurationTolerance,
            volumeTolerance
        }).clustersOf(getInstructions(mpm, 'articulation', part), mpm),
        [mpm, part, relativeDurationTolerance, volumeTolerance]
    )

    // Over the whole document, unlike the plot: `transform` loops over `scopesOf(mpm)` and
    // restyles every scope it finds, so `part` narrows what is drawn and not what the call covers.
    // Gating the button on the scope on screen would withhold a call that has work to do elsewhere.
    const canStylize = useMemo(
        () => scopesOf(mpm).some(scope =>
            placeable(placement.clustersOf(getInstructions(mpm, 'articulation', scope), mpm)).length > 0),
        [mpm]
    )

    return (
        <div>
            <DeskToolbar>
                <ToolGroup>
                    <ToolbarButton
                        primary
                        label='Stylize Articulations'
                        tooltip={canStylize
                            ? 'Cluster the articulations and define one style per cluster'
                            : 'Nothing in the document can share a def. Fit articulations first'}
                        disabled={!canStylize}
                        onClick={transformArticulations}
                    >
                        Stylize Articulations
                    </ToolbarButton>
                </ToolGroup>
            </DeskToolbar>

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

            {placeable(articulationPoints).length === 0
                ? (
                    <Typography color='text.secondary' sx={{ width: 600, py: 4 }}>
                        Nothing here to cluster: a shared def needs both relative attributes and
                        no absolute one. Fit articulations first, or look in another scope — this
                        plot shows the scope the bar is set to.
                    </Typography>
                )
                : (
                    /* A fixed range, unlike the ornamentation plot's: both axes are ratios against
                       the notated value, so 1 is a fixed and meaningful place on each. The unplaced
                       points are passed in with the rest, keeping the slot `Plot` expects. */
                    <Plot
                        points={articulationPoints}
                        x={{ label: 'Relative Duration', min: 0, max: 2.5 }}
                        y={{ label: 'Relative Volume', min: 0.5, max: 1.5 }}
                        width={600}
                        height={400}
                    />
                )}
        </div>
    )
}
