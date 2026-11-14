import type { AlignedPedal } from '../../fitting/alignment'
import { PedalRails } from '../PedalBand'
import { pedalLine, pressesOf, type PedalLane } from '../pedalGeometry'

/** Two readings that pedal alike would draw one line over the other, so each gets its own track. */
const SEPARATION = 2

interface PedalLanesProps {
    pedals: readonly AlignedPedal[]
    lanes: readonly PedalLane[]
    /** Every reading the desk colours, in the order it colours them. */
    sources: readonly string[]
    /**
     * The readings whose pedalling the chain kept, or undefined while it keeps every one — see
     * `takenPedalling`.
     */
    taken?: ReadonlySet<string>
    stretchX: number
    /** How wide the plot is, so a line reaches the end of the piece. */
    width: number
    colorFor: (source: string) => string
    nameFor: (source: string) => string
}

/**
 * What each reading did with the pedals, under the roll.
 *
 * A line rather than a block. The desk holds two readings of a passage against each other, and a
 * block says only that a pedal was down *somewhere* in its width, so two blocks of nearly the
 * same length in lanes of their own hide the disagreement worth seeing. A line that drops when
 * the foot goes down puts both readings on the same two levels of one lane: a press the other
 * reading does not make is a step where the other line stays flat, and a press held a beat longer
 * is a step that lands further right.
 *
 * The tracks are separated by a couple of pixels for the case that decides nothing: two readings
 * that pedal identically would otherwise draw one line over the other, and the one underneath
 * would look like it was never there.
 *
 * A reading whose pedalling the chain set aside is still drawn, dashed and faint as its notes
 * are, so that the line left solid is the one the performance pedals by.
 */
export const PedalLanes = ({
    pedals,
    lanes,
    sources,
    taken,
    stretchX,
    width,
    colorFor,
    nameFor,
}: PedalLanesProps) => (
    <g>
        <PedalRails lanes={lanes} width={width} />

        {lanes.map(lane => (
            <g key={`lane_${lane.type}`} data-lane={lane.type}>
                {sources.map((source, index) => {
                    const offset = (index - (sources.length - 1) / 2) * SEPARATION
                    const setAside = taken !== undefined && !taken.has(source)

                    return (
                        <polyline
                            key={`pedal_${lane.type}_${source}`}
                            data-type={lane.type}
                            data-source={source}
                            data-taken={taken?.has(source) || undefined}
                            points={pedalLine(
                                pressesOf(pedals, lane.type, source, stretchX),
                                lane.rest + offset,
                                lane.pressed + offset,
                                width,
                            )}
                            fill='none'
                            stroke={colorFor(source)}
                            strokeWidth={1.5}
                            strokeDasharray={setAside ? '3 2' : undefined}
                            opacity={setAside ? 0.45 : undefined}
                        >
                            <title>{`${nameFor(source)}, ${lane.type} pedal${setAside ? ', set aside' : ''}`}</title>
                        </polyline>
                    )
                })}
            </g>
        ))}
    </g>
)
