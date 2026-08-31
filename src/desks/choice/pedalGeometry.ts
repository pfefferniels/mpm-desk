import type { AlignedPedal } from '../../fitting/alignment'
import { pedalHeldSeconds, pedalOnsetSeconds } from '../noteTiming'

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
 */
export const pedalLanes = (pedals: readonly AlignedPedal[], top: number): PedalLane[] => {
    const types = LANE_ORDER.filter(type => pedals.some(pedal => pedal.type === type))
    const height = PEDAL_AREA / (types.length || 1)

    return types.map((type, lane) => ({
        type,
        rest: top + lane * height + height * 0.2,
        pressed: top + lane * height + height * 0.75,
    }))
}

/** A stretch of the plot over which one pedal was held down, in pixels. */
interface Press {
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
            .filter(pedal => pedal.type === type && (pedal.source || 'unknown') === source)
            .map(pedal => ({
                from: pedalOnsetSeconds(pedal) * stretchX,
                to: (pedalOnsetSeconds(pedal) + pedalHeldSeconds(pedal)) * stretchX,
            }))
            // One non-finite time would take the whole polyline with it, where a rectangle simply
            // went undrawn.
            .filter(({ from, to }) => Number.isFinite(from) && Number.isFinite(to))
            .sort((a, b) => a.from - b.from),
    )

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
    [
        [0, rest],
        ...presses.flatMap(({ from, to }) => [
            [from, rest],
            [from, pressed],
            [to, pressed],
            [to, rest],
        ]),
        [end, rest],
    ]
        .map(([x, y]) => `${x},${y}`)
        .join(' ')
