import type { Call } from '../../model/Work'
import type { Instruction } from '../../fitting/instructions/index'
import { clamp } from '../../fitting/utils'
import { LANE_HEIGHT } from './layout'

/** Where a press's curve is to pass, by score date: the guides an `InsertPedal` call states. */
export type PedalGuides = ReadonlyMap<number, number>

/** The press an `InsertPedal` call names, where it names one. */
export const pressOfCall = (call: Call): string | undefined =>
    call.name === 'InsertPedal' && typeof call.options.pedal === 'string' ? call.options.pedal : undefined

/** The guides a call states; none for a call that states none, as a trace or a ramp does. */
export const guidesOfCall = (call: Call): PedalGuides | undefined => {
    if (call.name !== 'InsertPedal') return undefined
    const { guides } = call.options
    return guides instanceof Map ? (guides as PedalGuides) : undefined
}

/**
 * The guides that would draw a press's movements again: where each starts, at the position it
 * starts from. A movement runs to the next, so the next one's start is where it arrives, and four
 * movements of a ramp each way come back as the four guides they were drawn through.
 *
 * Bends are not carried over: between two guides a movement takes the default bend. This is the
 * curve as a draft to work on, not a copy of it.
 */
export const guidesOfMovements = (movements: readonly Instruction<'movement'>[]): Map<number, number> =>
    new Map(
        movements
            .filter(movement => movement.position !== undefined)
            .map(movement => [movement.date, Number(movement.position)]),
    )

/**
 * Where a point in a lane puts a guide: on the whole tick under it, as far down as it is below the
 * lane's rail, to the hundredth the corrections desk writes a position to.
 */
export const guideAt = (x: number, belowRail: number, stretchX: number): { date: number; position: number } => ({
    date: Math.round(x / stretchX),
    position: Math.round(clamp(belowRail / LANE_HEIGHT, 0, 1) * 100) / 100,
})

/** The guides with the one at `from` moved to `to`, unless another guide already holds that date. */
export const withGuideMoved = (
    guides: PedalGuides,
    from: number,
    to: { date: number; position: number },
): Map<number, number> => {
    if (to.date !== from && guides.has(to.date)) return new Map(guides)
    const next = new Map(guides)
    next.delete(from)
    return next.set(to.date, to.position)
}
