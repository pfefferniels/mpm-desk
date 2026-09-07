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

/** Milliseconds from leaving rest to returning there: the last vertex, and so a press's length. */
export const returnToRest = (travel: Travel): number => travel.at(-1)?.ms ?? 0

/** What the record of a press is: well-formed, leaving rest at 0 and back at rest at the end. */
export const isPressTravel = (travel: Travel): boolean =>
    wellFormed(travel) && travel.length >= 2 && travel[0].ms === 0 && travel[travel.length - 1].position === 0

export const sameTravel = (a: Travel, b: Travel): boolean =>
    a.length === b.length && a.every((vertex, i) => vertex.ms === b[i].ms && vertex.position === b[i].position)

/** Two decimals inside the unit range, as `formatTravel` writes it, so what is drawn is what is saved. */
const asWritten = (position: number): number => Math.round(Math.min(1, Math.max(0, position)) * 100) / 100

/**
 * A vertex moved as a drag moves it, in whole milliseconds strictly between its neighbours.
 *
 * The first vertex stays at 0: its time is the onset, which is `Modify`'s to shift. The last stays
 * at rest: it is the release.
 */
export const movedVertex = (travel: Travel, index: number, to: TravelVertex): Travel => {
    const last = travel.length - 1
    if (index < 0 || index > last) return travel
    const floor = index === 0 ? 0 : travel[index - 1].ms + 1
    const ceiling = index === last ? Number.POSITIVE_INFINITY : travel[index + 1].ms - 1
    const ms = index === 0 || floor > ceiling ? travel[index].ms : Math.min(ceiling, Math.max(floor, Math.round(to.ms)))
    const position = index === last ? 0 : asWritten(to.position)
    return travel.with(index, { ms, position })
}

/**
 * A vertex added inside the line, placed by its time; one already at that millisecond gives way,
 * a run-length record holding one position per moment. Outside the ends the line is unchanged.
 */
export const withVertex = (travel: Travel, vertex: TravelVertex): Travel => {
    const ms = Math.round(vertex.ms)
    if (travel.length < 2 || ms <= 0 || ms >= returnToRest(travel)) return travel
    const at = travel.findIndex(other => other.ms >= ms)
    return travel.toSpliced(at, travel[at].ms === ms ? 1 : 0, { ms, position: asWritten(vertex.position) })
}

/** A vertex removed. The ends are the press itself and stay. */
export const withoutVertex = (travel: Travel, index: number): Travel =>
    index <= 0 || index >= travel.length - 1 ? travel : travel.toSpliced(index, 1)

/** The flat stretch a vertex belongs to: the run of neighbours at its position, as indices. */
export const plateauAround = (travel: Travel, index: number): { from: number; to: number } => {
    const level = travel[index].position
    const before = travel.findLastIndex((vertex, i) => i < index && vertex.position !== level)
    const after = travel.findIndex((vertex, i) => i > index && vertex.position !== level)
    return { from: before + 1, to: after === -1 ? travel.length - 1 : after - 1 }
}

/** A plateau raised or lowered whole. The final rest is the release and does not move. */
export const movedPlateau = (travel: Travel, index: number, position: number): Travel => {
    const { from, to } = plateauAround(travel, index)
    if (to === travel.length - 1) return travel
    const level = asWritten(position)
    return travel.map((vertex, i) => (i >= from && i <= to ? { ...vertex, position: level } : vertex))
}

/**
 * The release moved: every vertex from the one after the last rise onward, shifted together and
 * kept after the vertex before them. The hold grows or shrinks; the fall keeps its shape.
 */
export const releaseShifted = (travel: Travel, changeMs: number): Travel => {
    const lastRise = travel.findLastIndex((vertex, i) => i > 0 && vertex.position > travel[i - 1].position)
    const releaseStart = Math.max(1, lastRise + 1)
    if (releaseStart >= travel.length) return travel
    const applied = Math.max(Math.round(changeMs), travel[releaseStart - 1].ms + 1 - travel[releaseStart].ms)
    return travel.map((vertex, i) => (i < releaseStart ? vertex : { ...vertex, ms: vertex.ms + applied }))
}
