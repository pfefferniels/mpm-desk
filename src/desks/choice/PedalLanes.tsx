import type { AlignedPedal } from '../../fitting/alignment'
import { pedalLine, pressesOf, type PedalLane } from './pedalGeometry'

/** Two readings that pedal alike would draw one line over the other, so each gets its own track. */
const SEPARATION = 2

interface PedalLanesProps {
    pedals: readonly AlignedPedal[]
    lanes: readonly PedalLane[]
    /** Every reading the desk colours, in the order it colours them. */
    sources: readonly string[]
    stretchX: number
    /** How wide the plot is, so a line reaches the end of the piece. */
    width: number
    colorFor: (source: string) => string
}

/**
 * What each reading did with the pedals, under the roll.
 *
 * A line rather than the block this desk used to draw. The desk exists to hold two readings of a
 * passage against each other, and a block says only that a pedal was down *somewhere* in its
 * width: two blocks of nearly the same length, stacked in lanes of their own, hide the very
 * disagreement worth seeing. A line that drops when the foot goes down puts both readings on the
 * same two levels of one lane, so a press the other reading does not make is a step where the
 * other line stays flat, and a press held a beat longer is a step that lands further right.
 *
 * The tracks are separated by a couple of pixels for the case that decides nothing: two readings
 * that pedal identically would otherwise draw one line over the other, and the one underneath
 * would look like it was never there.
 */
export const PedalLanes = ({
    pedals,
    lanes,
    sources,
    stretchX,
    width,
    colorFor,
}: PedalLanesProps) => (
    <g>
        {lanes.map(lane => (
            <g key={`lane_${lane.type}`} data-lane={lane.type}>
                {/* The rail the lines rest on, so an untouched pedal still reads as a lane. */}
                <line
                    x1={0}
                    y1={lane.rest}
                    x2={width}
                    y2={lane.rest}
                    stroke='#e5e7eb'
                    strokeWidth={1}
                />

                {sources.map((source, index) => {
                    const offset = (index - (sources.length - 1) / 2) * SEPARATION

                    return (
                        <polyline
                            key={`pedal_${lane.type}_${source}`}
                            data-type={lane.type}
                            data-source={source}
                            points={pedalLine(
                                pressesOf(pedals, lane.type, source, stretchX),
                                lane.rest + offset,
                                lane.pressed + offset,
                                width,
                            )}
                            fill='none'
                            stroke={colorFor(source)}
                            strokeWidth={1.5}
                        >
                            <title>{`${source} — ${lane.type} pedal`}</title>
                        </polyline>
                    )
                })}
            </g>
        ))}
    </g>
)

/**
 * Which lane is which, for the gutter beside the plot.
 *
 * Drawn to the left of x = 0 in the plot's own vertical coordinates, so the desk can put it beside
 * the scroller and a name still meets its own rail — and stays put when the plot is scrolled,
 * which a name drawn at the head of the music does not.
 */
export const PedalLaneLabels = ({ lanes }: { lanes: readonly PedalLane[] }) => (
    <>
        {lanes.map(lane => (
            <text
                key={`label_${lane.type}`}
                x={-6}
                y={lane.rest}
                dy='.32em'
                textAnchor='end'
                fontSize='9'
                fill='#6b7280'
            >
                {lane.type}
            </text>
        ))}
    </>
)
