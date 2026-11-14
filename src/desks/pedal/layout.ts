import type { AlignedPedal } from '../../fitting/alignment'

/**
 * Sustain over soft, as on the other desks that draw the two pedals: the rows of recorded presses
 * in this order, and the lanes of written movements below them in the same one.
 */
const ROW_ORDER: readonly AlignedPedal['type'][] = ['sustain', 'soft']

/**
 * Above the first row, which would otherwise rest on the app bar's lower edge: a press's line at
 * rest is the top of its row, and at y = 0 half of it was cut off by the top of the plot, where it
 * read as one more border of the bar.
 */
export const PLOT_TOP = 8

/** How tall one row of recorded presses is: a full stroke of the line, as tall as a lane's. */
export const ROW_HEIGHT = 30

/** What a `@position` of 1 comes to, in pixels below a lane's rail. */
export const LANE_HEIGHT = 30

/** Between two lanes, so that a full pedal and the next lane's rail are not the same line. */
const LANE_GAP = 12

/** Where the movement lanes begin, and with them the foot of the chord lines above. */
export const MOVEMENT_TOP = PLOT_TOP + 100

/** Between the last lane and the axis under it. */
const AXIS_GAP = 24

/** Under the axis, for the figures that hang off it. */
const AXIS_LABEL_ROOM = 20

/**
 * How wide the column of names is: 22 for the position figures, the rest for a name as long as
 * `unknown`.
 */
export const GUTTER_WIDTH = 60

/** One pedal's recorded presses, on a row of their own. */
export interface PressRow {
    type: AlignedPedal['type']
    /** The top of the row. */
    y: number
}

/** One controller's movements, on a lane of their own. */
export interface MovementLane {
    controller: string
    /** The rail the lane hangs from, which is `@position` 0. */
    y: number
}

/** What the plot has rows and lanes for, where the axis runs, and how tall that comes to. */
export interface PedalPlot {
    rows: PressRow[]
    lanes: MovementLane[]
    axisY: number
    height: number
}

export const rowY = (type: AlignedPedal['type']): number =>
    PLOT_TOP + ROW_ORDER.indexOf(type) * ROW_HEIGHT

/**
 * Where a controller's lane stands among the others: a pedal's where its row of presses does, any
 * other controller after both. A lane per controller in the order the MPM happens to mention them
 * put soft over sustain on the reconstruction, under rows that say the opposite.
 */
const laneRank = (controller: string): number => {
    const rank = ROW_ORDER.indexOf(controller as AlignedPedal['type'])
    return rank === -1 ? ROW_ORDER.length : rank
}

/**
 * The rows and lanes of one plot, given what there is to draw in them.
 *
 * A row for a pedal the residual cannot place is a name over nothing, so the rows follow the
 * presses that reached the tick grid rather than the types the recording mentions.
 *
 * @param pressed the type of every press the plot draws
 * @param controllers every `@controller` with movements. The lanes stack as the rows do, and a
 * controller that is no pedal of theirs keeps its place in this order, after them.
 */
export const pedalPlot = (
    pressed: readonly AlignedPedal['type'][],
    controllers: readonly string[],
): PedalPlot => {
    // `toSorted` is stable, which is what keeps the order of the controllers that are not pedals.
    const lanes = controllers
        .toSorted((a, b) => laneRank(a) - laneRank(b))
        .map((controller, lane) => ({
            controller,
            y: MOVEMENT_TOP + lane * (LANE_HEIGHT + LANE_GAP),
        }))
    const lowest = lanes.at(-1)
    const axisY = (lowest ? lowest.y + LANE_HEIGHT : MOVEMENT_TOP) + AXIS_GAP

    return {
        rows: ROW_ORDER
            .filter(type => pressed.includes(type))
            .map(type => ({ type, y: rowY(type) })),
        lanes,
        axisY,
        height: axisY + AXIS_LABEL_ROOM,
    }
}
