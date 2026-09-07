import type { AlignedPedal } from '../fitting/alignment'
import type { Travel } from '../performance/pedalTravel'
import { pedalHeldSeconds, pedalOnsetSeconds } from './noteTiming'

/** How tall the whole pedal band is, however many lanes it turns out to hold. */
export const PEDAL_AREA = 64

/** Between the lowest key and the first pedal lane, so the two do not read as one plot. */
export const PEDAL_GUTTER = 12

/** How wide the lane names need beside the plot, at the size they are drawn. */
export const PEDAL_LABEL_WIDTH = 52

/** Sustain above soft: it is the one being read, and the soft pedal is the rarer annotation. */
const LANE_ORDER: readonly AlignedPedal['type'][] = ['sustain', 'soft']

export interface PedalLane {
    type: AlignedPedal['type']
    /** Where the line rides while the pedal is up, in the plot's own pixels. */
    rest: number
    /** Where it rides while the pedal is down. */
    pressed: number
}

/**
 * One lane per pedal the recordings actually use, so a performance that never touches the soft
 * pedal shows no soft lane.
 *
 * @param top where the band begins, below the roll
 * @param area how tall the band is: a desk that drags positions asks for more than one that
 *   compares readings
 */
export const pedalLanes = (
    pedals: readonly AlignedPedal[],
    top: number,
    area = PEDAL_AREA,
): PedalLane[] => {
    const types = LANE_ORDER.filter(type => pedals.some(pedal => pedal.type === type))
    const height = area / (types.length || 1)

    return types.map((type, lane) => ({
        type,
        rest: top + lane * height + height * 0.2,
        pressed: top + lane * height + height * 0.75,
    }))
}

/** Where a position between up (0) and down (1) is drawn in a lane. */
export const laneY = (lane: PedalLane, position: number): number =>
    lane.rest + position * (lane.pressed - lane.rest)

/** The inverse, held inside the lane: the position a plot y names. */
export const positionAtY = (lane: PedalLane, y: number): number =>
    Math.min(1, Math.max(0, (y - lane.rest) / (lane.pressed - lane.rest)))

/** One vertex placed on the plot: seconds on the axis, position in the lane. */
export interface PlacedVertex {
    x: number
    y: number
}

/** @param dateMs the press's `milliseconds.date` */
export const placeTravel = (
    travel: Travel,
    dateMs: number,
    lane: PedalLane,
    stretchX: number,
): PlacedVertex[] =>
    travel.map(({ ms, position }) => ({
        x: ((dateMs + ms) / 1000) * stretchX,
        y: laneY(lane, position),
    }))

/** A stretch of the plot over which one pedal was held down, in pixels. */
export interface Press {
    from: number
    to: number
}

/**
 * Presses that overlap are one press.
 *
 * A depression recorded twice over the same stretch would otherwise lift the line and drop it
 * again at the same instant, which reads as a retake the recording never made. Touching presses
 * are left alone: there the lift is the recording's own.
 */
const joinOverlapping = (presses: readonly Press[]): Press[] =>
    presses.reduce<Press[]>((joined, press) => {
        const last = joined.at(-1)
        return last && press.from < last.to
            ? [...joined.slice(0, -1), { from: last.from, to: Math.max(last.to, press.to) }]
            : [...joined, press]
    }, [])

/** What one reading did with one pedal, as stretches of the plot. */
export const pressesOf = (
    pedals: readonly AlignedPedal[],
    type: AlignedPedal['type'],
    source: string,
    stretchX: number,
): Press[] =>
    joinOverlapping(
        pedals
            .filter(pedal => pedal.type === type && pedal.source === source)
            .map(pedal => ({
                from: pedalOnsetSeconds(pedal) * stretchX,
                to: (pedalOnsetSeconds(pedal) + pedalHeldSeconds(pedal)) * stretchX,
            }))
            // One non-finite time would take the whole polyline with it, where a rectangle simply
            // went undrawn.
            .filter(({ from, to }) => Number.isFinite(from) && Number.isFinite(to))
            .sort((a, b) => a.from - b.from),
    )

type Corner = readonly [number, number]

const asPoints = (corners: readonly Corner[]): string =>
    corners.map(([x, y]) => `${x},${y}`).join(' ')

/** A corner that repeats the one before it, as a plateau's far end would, is no corner. */
const withoutRepeats = (corners: readonly Corner[]): Corner[] =>
    corners.filter(([x, y], i) => i === 0 || x !== corners[i - 1][0] || y !== corners[i - 1][1])

/**
 * The corners of a line that holds each position until the next vertex: the flat run at a
 * vertex's height to the next vertex's time, then the vertical to the next height. It opens at
 * rest, where the pedal stands before its first vertex.
 */
const stepCorners = (vertices: readonly PlacedVertex[], rest: number): Corner[] => {
    const first = vertices[0]
    if (!first) return []
    return withoutRepeats([
        [first.x, rest],
        ...vertices.flatMap((vertex, i): Corner[] => {
            const next = vertices[i + 1]
            return next ? [[vertex.x, vertex.y], [next.x, vertex.y]] : [[vertex.x, vertex.y]]
        }),
    ])
}

/** The line a travel draws, as the points of a `<polyline>`. */
export const stepLine = (vertices: readonly PlacedVertex[], rest: number): string =>
    asPoints(stepCorners(vertices, rest))

/** The line a press drew, or used to draw, from the record's own terms. */
export const lineOf = (travel: Travel, dateMs: number, lane: PedalLane, stretchX: number): string =>
    stepLine(placeTravel(travel, dateMs, lane, stretchX), lane.rest)

/** The four corners of one depression: the switch it is, down where the foot lands and up where it lifts. */
const pressCorners = (press: Press, rest: number, pressed: number): Corner[] =>
    stepCorners([{ x: press.from, y: pressed }, { x: press.to, y: rest }], rest)

/**
 * The pedal as one line: at rest until it is pressed, down for as long as it is held.
 *
 * Every press contributes its four corners, so the line is vertical where the foot moves and flat
 * where it does not. A reading with no press of that type still gets a line, drawn flat from end
 * to end — which says "this one never used it", and is not the same as no line at all.
 */
export const pedalLine = (
    presses: readonly Press[],
    rest: number,
    pressed: number,
    end: number,
): string =>
    asPoints([
        [0, rest],
        ...presses.flatMap(press => pressCorners(press, rest, pressed)),
        [end, rest],
    ])
