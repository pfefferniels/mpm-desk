import type { PedalLane } from './pedalGeometry'

/**
 * The rails the pedal lines rest on, so a lane reads as a lane before anything is drawn in it.
 *
 * @param width how wide the plot is, so a rail reaches the end of the piece
 */
export const PedalRails = ({
    lanes,
    width,
}: {
    lanes: readonly PedalLane[]
    width: number
}) => (
    <>
        {lanes.map(lane => (
            <line
                key={`rail_${lane.type}`}
                x1={0}
                y1={lane.rest}
                x2={width}
                y2={lane.rest}
                stroke='#e5e7eb'
                strokeWidth={1}
            />
        ))}
    </>
)

/**
 * Which lane is which, for the gutter beside the plot.
 *
 * Drawn to the left of x = 0 in the plot's own vertical coordinates, so a desk can put it beside
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
