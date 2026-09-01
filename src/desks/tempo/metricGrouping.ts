/**
 * The levels a time signature implies, and the boxes those levels make out of the ones the
 * recording left.
 *
 * A box is one inter-onset interval, so the skyline reads the tempo at whatever grid the notes
 * happen to be on. The beat, the bar and what lies between them are readings the metre implies
 * rather than anything the recording states, so they are derived here and nowhere stored: no box
 * this module makes reaches the work file, and a box of any kind reaches the MPM only as the
 * drawn curve somebody fits on top of it.
 */
import type { DatedTimeSignature, TimeSignature } from "../../fitting/timeSignature"
import { PULSES_PER_WHOLE } from "../../fitting/ppq"
import type { Range } from "./Tempo"

/** What to group by where the score states no time signature. */
const DEFAULT_METER: TimeSignature = { numerator: 4, denominator: 4 }

/** Nothing shorter than a sixty-fourth is a level of its own. */
const SHORTEST_LEVEL = PULSES_PER_WHOLE / 64

const usable = (meter: TimeSignature | undefined): TimeSignature =>
    meter && meter.numerator > 0 && meter.denominator > 0 ? meter : DEFAULT_METER

/**
 * Whether the beat is a dotted note — three denominator-notes rather than one.
 *
 * 3/8 is triple simple time and not one dotted quarter, which is why the numerator has to exceed
 * three as well as divide by it.
 */
const isCompound = ({ numerator }: TimeSignature) => numerator > 3 && numerator % 3 === 0

const beatTicks = (meter: TimeSignature) =>
    ((isCompound(meter) ? 3 : 1) * PULSES_PER_WHOLE) / meter.denominator

const beatsPerBar = (meter: TimeSignature) =>
    isCompound(meter) ? meter.numerator / 3 : meter.numerator

/** A count of beats as the factors it groups by, twos before threes: 4 → [2, 2], 6 → [2, 3]. */
const groupings = (beats: number): number[] => {
    if (beats <= 1) return []
    const factor = [2, 3].find(f => beats % f === 0) ?? beats
    return [factor, ...groupings(beats / factor)]
}

/** The levels under one beat, descending. A compound beat divides in three first, then in half. */
const under = (level: number, division: number): number[] => {
    const next = level / division
    return next < SHORTEST_LEVEL ? [] : [next, ...under(next, 2)]
}

/** The levels over one beat, ascending, the last of them the bar. */
const over = (level: number, factors: number[]): number[] =>
    factors.length === 0 ? [] : [level * factors[0], ...over(level * factors[0], factors.slice(1))]

/**
 * Every metric level of the signature in ticks, ascending: the subdivisions, the beat, and the
 * groupings of beats up to the bar.
 *
 * In 6/8 the quarter is absent and the dotted quarter present, which is the whole of what compound
 * time amounts to here. A numerator no small factor divides — 5/4, 7/8 — groups its beats straight
 * into the bar, because which of 2+3 and 3+2 a bar is beaten in is not in the signature.
 */
export const metricLevels = (meter?: TimeSignature): number[] => {
    const signature = usable(meter)
    const beat = beatTicks(signature)
    return [
        ...under(beat, isCompound(signature) ? 3 : 2).reverse(),
        beat,
        ...over(beat, groupings(beatsPerBar(signature))),
    ]
}

const rangeKey = ({ start, end }: Range) => `${start}_${end}`

/** How many of the boxes tile `[from, to)` end to end, or nothing where none of them do. */
const tiling = (from: number, to: number, byStart: ReadonlyMap<number, Range[]>): number | undefined => {
    if (from === to) return 0
    const rest = (byStart.get(from) ?? []).reduce<number | undefined>(
        (found, piece) =>
            found ?? (piece.end > from && piece.end <= to ? tiling(piece.end, to, byStart) : undefined),
        undefined
    )
    return rest === undefined ? undefined : rest + 1
}

/**
 * A stretch of the piece one signature governs, from the date it takes effect until the date the
 * next one displaces it.
 *
 * `until` is what bounds a cell rather than the score's end: a cell reaching over a change of
 * metre belongs to neither signature. The last stretch has no successor and runs to `Infinity`,
 * which costs nothing — no cell forms where no box tiles it, and the boxes end where the
 * recording does.
 */
interface MetricStretch {
    from: number
    until: number
    meter: TimeSignature
}

/**
 * The signature map as the stretches it governs. An empty map is common time throughout, which is
 * what {@link usable} already assumed of a missing one.
 */
const stretches = (signatures?: readonly DatedTimeSignature[]): MetricStretch[] => {
    const ascending = [...(signatures ?? [])].sort((a, b) => a.date - b.date)
    return ascending.length === 0
        ? [{ from: 0, until: Infinity, meter: DEFAULT_METER }]
        : ascending.map((signature, index) => ({
            from: signature.date,
            until: ascending[index + 1]?.date ?? Infinity,
            meter: usable(signature),
        }))
}

/**
 * The cells of one level that the boxes at hand tile exactly, and that are not boxes already.
 *
 * Two or more of them, filling the cell end to end and reaching past neither edge — so a stretch
 * the recording sounded only part of forms nothing, and neither does a cell some box already
 * spans on its own.
 *
 * Cells are counted from where the signature takes effect, not from tick 0. That is the bar line:
 * a score whose 4/4 begins after a quarter of anacrusis has its downbeats on 720, 3600, 6480, and
 * a grid counted from zero would name none of them.
 */
const cellsAt = (level: number, boxes: readonly Range[], within: MetricStretch): Range[] => {
    const byStart = Map.groupBy(boxes, box => box.start)
    const known = new Set(boxes.map(rangeKey))
    return [...byStart.keys()]
        .filter(start => start >= within.from && (start - within.from) % level === 0)
        .map(start => ({ start, end: start + level }))
        .filter(cell => cell.end <= within.until)
        .filter(cell => !known.has(rangeKey(cell)))
        .filter(cell => (tiling(cell.start, cell.end, byStart) ?? 0) >= 2)
        .sort((a, b) => a.start - b.start)
}

/**
 * The boxes the metre makes out of the ones given, one level at a time.
 *
 * Each level sees what the levels under it formed, which is what turns two eighths into a quarter
 * and then those quarters into a half, and each stretch of the piece is grouped under the
 * signature that governs it.
 */
export const combineByMeter = (
    boxes: readonly Range[],
    signatures?: readonly DatedTimeSignature[]
): Range[] =>
    stretches(signatures).flatMap(stretch =>
        metricLevels(stretch.meter).reduce<Range[]>(
            (formed, level) => [...formed, ...cellsAt(level, [...boxes, ...formed], stretch)],
            []
        )
    )
