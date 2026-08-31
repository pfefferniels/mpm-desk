import { PULSES_PER_QUARTER } from '../../fitting/ppq'
import { LANE_HEIGHT, ROW_HEIGHT, type PedalPlot } from './layout'

const RULE = '#e5e7eb'
const TEXT = '#6b7280'

/** Where a name ends, leaving the strip next to the plot to the position figures. */
const NAME_X = -22

const Name = ({ y, children }: { y: number; children: string }) => (
    <text x={NAME_X} y={y} dy='.32em' textAnchor='end' fontSize='9' fill={TEXT}>
        {children}
    </text>
)

/** What the depth of a lane measures: `@position`, 0 at the rail and 1 a lane below it. */
const PositionScale = ({ y }: { y: number }) => (
    <>
        {[0, 1].map(position => (
            <g key={position}>
                <line
                    x1={-4}
                    y1={y + position * LANE_HEIGHT}
                    x2={0}
                    y2={y + position * LANE_HEIGHT}
                    stroke={RULE}
                />
                <text
                    x={-6}
                    y={y + position * LANE_HEIGHT}
                    dy='.32em'
                    textAnchor='end'
                    fontSize='8'
                    fill={TEXT}
                >
                    {position}
                </text>
            </g>
        ))}
    </>
)

/**
 * What each row of the plot holds, in a column beside it.
 *
 * Drawn left of x = 0 in the plot's own vertical coordinates, as `PedalLaneLabels` is: the desk
 * puts it beside the scroller, so a name meets its own row and stays where it is once the plot
 * has been scrolled past the opening bars.
 */
export const PedalGutter = ({ plot }: { plot: PedalPlot }) => (
    <>
        {plot.rows.map(row => (
            <Name key={`row_${row.type}`} y={row.y + ROW_HEIGHT / 2}>
                {row.type}
            </Name>
        ))}

        {plot.lanes.map(lane => (
            <g key={`lane_${lane.controller}`}>
                <Name y={lane.y + LANE_HEIGHT / 2}>{lane.controller}</Name>
                <PositionScale y={lane.y} />
            </g>
        ))}

        <Name y={plot.axisY}>ticks</Name>
    </>
)

/** No two figures closer than this, so a five-digit date has room to be read. */
const MIN_LABEL_GAP = 80

/** The coarsest quarter-note grid that still keeps the figures that far apart. */
const labelStep = (stretchX: number): number => {
    const quarters = MIN_LABEL_GAP / stretchX / PULSES_PER_QUARTER
    return PULSES_PER_QUARTER * Math.max(1, 2 ** Math.ceil(Math.log2(quarters)))
}

/**
 * The grid everything on this desk is placed against: the score's own ticks.
 *
 * It scrolls with the plot, since a figure names the place it stands over.
 *
 * @param end where the piece ends, in ticks
 */
export const TickScale = ({
    end,
    stretchX,
    y,
}: {
    end: number
    stretchX: number
    y: number
}) => {
    const step = labelStep(stretchX)
    const dates = Array.from({ length: Math.floor(end / step) + 1 }, (_, i) => i * step)

    return (
        <g className='tickScale'>
            <line x1={0} y1={y} x2={end * stretchX} y2={y} stroke={RULE} />
            {dates.map(date => (
                <g key={date}>
                    <line
                        x1={date * stretchX}
                        y1={y}
                        x2={date * stretchX}
                        y2={y + 4}
                        stroke={RULE}
                    />
                    <text
                        x={date * stretchX}
                        y={y + 13}
                        textAnchor='middle'
                        fontSize='8'
                        fill={TEXT}
                    >
                        {date}
                    </text>
                </g>
            ))}
        </g>
    )
}
