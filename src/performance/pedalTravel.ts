/**
 * A pedal's travel over one press, as the as-played-by customization records it: vertices of
 * milliseconds since the pedal left rest and a position from 0 (up) to 1 (down), ascending.
 *
 * The line is a run-length record, as the MIDI it comes from is: a position holds until the next
 * vertex. That is what a synthesizer hears, and it is why a switch reads as two vertices, down at
 * the first and up again at the last, rather than as a ramp between them.
 */

export interface TravelVertex {
    readonly ms: number
    readonly position: number
}

export type Travel = readonly TravelVertex[]

/**
 * Below this change of position a vertex adds nothing a reader would draw. The roll desk draws
 * its own line at 0.02; the record is written coarser, since every vertex kept is a handle the
 * corrections desk offers.
 */
const TOLERANCE = 0.05

/** The travel of a switch: down at once, and up again when it was released. */
export const switchTravel = (durationMs: number): Travel => [
    { ms: 0, position: 1 },
    { ms: durationMs, position: 0 },
]

/**
 * The vertices worth keeping: both ends of every stretch the pedal spends at one position, and
 * along a traversal one vertex per `tolerance` of position.
 */
export const sparseTravel = (travel: Travel, tolerance = TOLERANCE): Travel => {
    const last = travel.length - 1
    const endsAStretch = (i: number) =>
        i === 0 ||
        i === last ||
        (travel[i].position === travel[i - 1].position) !==
            (travel[i].position === travel[i + 1].position)

    let anchor = Number.NaN
    return travel.filter((vertex, i) => {
        if (!endsAStretch(i) && Math.abs(vertex.position - anchor) < tolerance) return false
        anchor = vertex.position
        return true
    })
}

/** `ms:position` pairs separated by spaces, the position to two decimals. */
export const formatTravel = (travel: Travel): string =>
    travel.map(({ ms, position }) => `${Math.round(ms)}:${position.toFixed(2)}`).join(' ')

const wellFormed = (vertices: Travel): boolean =>
    vertices.length > 0 &&
    vertices.every(
        ({ ms, position }, i) =>
            Number.isInteger(ms) &&
            ms >= 0 &&
            position >= 0 &&
            position <= 1 &&
            (i === 0 || ms > vertices[i - 1].ms),
    )

/** The inverse of `formatTravel`. A text that is not a travel is a defect in the file, and says so. */
export const parseTravel = (text: string): Travel => {
    const vertices = text
        .trim()
        .split(/\s+/)
        .map(pair => {
            const [ms, position] = pair.split(':').map(Number)
            return { ms, position }
        })
    if (!wellFormed(vertices)) throw new Error(`Not a pedal travel: "${text.trim()}"`)
    return vertices
}

/** Where the pedal stands `ms` after it left rest: at the last vertex reached, at rest before the first. */
export const positionAt = (travel: Travel, ms: number): number =>
    travel.findLast(vertex => vertex.ms <= ms)?.position ?? 0
