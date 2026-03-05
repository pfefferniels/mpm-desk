import { MSM } from "mpmify"
import { Scope } from "../../../../mpm-ts/lib"

export type Range = {
    start: number
    end: number
}

export type TempoSegment = {
    date: Range
    time?: Range
    selected: boolean
    silent: boolean
}

export const asBPM = (dateRange: Range, tickToSeconds?: (tick: number) => number) => {
    if (tickToSeconds) {
        return 60 / (tickToSeconds(dateRange.end) - tickToSeconds(dateRange.start))
    }
    return 60 / (dateRange.end - dateRange.start)
}

export type Onset = { date: number }

export const extractOnsets = (msm: MSM, part: Scope): Onset[] => {
    const chords = msm.asChords(part)
    const onsets: Onset[] = []
    for (const [date, notes] of chords) {
        if (notes[0]?.['midi.onset'] === undefined) continue
        onsets.push({ date })
    }
    return onsets.sort((a, b) => a.date - b.date)
}

export const extractTempoSegments = (msm: MSM, part: Scope) => {
    msm.shiftToFirstOnset()

    const segments: TempoSegment[] = []
    const chords = msm.asChords(part)

    const iterator = chords.entries()
    let current = iterator.next()
    while (!current.done) {
        const [date, notes] = current.value
        const onset = notes[0]['midi.onset']

        current = iterator.next()
        if (current.done) {
            const longest = notes.sort((a, b) => b.duration - a.duration)[0]

            if (longest.duration === 0 || longest['midi.duration'] === 0) {
                break
            }

            segments.push({
                date: {
                    start: date,
                    end: longest.date + longest.duration
                },
                selected: false,
                silent: false
            })

            break
        }

        const [nextDate, nextNotes] = current.value

        const nextOnset = nextNotes[0]['midi.onset']
        if (onset === undefined || nextOnset === undefined) {
            continue
        }

        if (onset - nextOnset === 0) {
            continue;
        }

        segments.push({
            date: {
                start: date,
                end: nextDate
            },
            selected: false,
            silent: false
        })
    }

    return segments
}

/**
 * A wrapper around an array of `TempoSegment`s. Provides
 * useful methods for working with segments, such as
 * sorting by their lengthes, finding the first and the
 * last onset times etc.
 */
export class TempoCluster {
    segments: TempoSegment[] = []

    constructor(tempos?: TempoSegment[]) {
        if (tempos) {
            this.segments = tempos
        }
    }

    clone() {
        return new TempoCluster(this.segments)
    }

    removeTempo(tempo: TempoSegment) {
        const index = this.segments.indexOf(tempo)
        if (index !== -1) {
            this.segments.splice(index, 1)
        }
    }

    sort(tickToSeconds?: (tick: number) => number) {
        return [...this.segments].sort((a, b) => {
            if (a.selected !== b.selected) {
                return a.selected ? 1 : -1
            }
            // Tallest boxes (highest BPM) rendered first (behind),
            // shortest boxes last (in front) so they stay clickable
            return asBPM(b.date, tickToSeconds) - asBPM(a.date, tickToSeconds)
        })
    }

    unselectAll() {
        this.segments.forEach(d => d.selected = false)
    }

    serialize() {
        return JSON.stringify(this.segments, null, 4)
    }

    highestBPM(tickToSeconds: (tick: number) => number) {
        return Math.max(...this.segments.map(t => asBPM(t.date, tickToSeconds)))
    }

    get startDate() {
        return Math.min(...this.segments.map(d => d.date.start))
    }

    get endDate() {
        return Math.max(...this.segments.map(d => d.date.end))
    }

    startOnset(tickToSeconds: (tick: number) => number) {
        return Math.min(...this.segments.map(d => tickToSeconds(d.date.start)))
    }

    endOnset(tickToSeconds: (tick: number) => number) {
        return Math.max(...this.segments.map(d => tickToSeconds(d.date.end)))
    }

    get length() {
        return this.segments.length
    }
}

export type DrawnLine = {
    from: { seconds: number, bpm: number }
    to: { seconds: number, bpm: number }
    meanTempoAt: number
    beatLength: number
    bpmScaled?: boolean
    startTick?: number
    endTick?: number
}

const STANDARD_BEAT_LENGTHS = [0.0625, 0.125, 0.25, 0.375, 0.5, 0.75, 1.0]

export function inferBeatLength(
    seconds: number,
    bpm: number,
    onsets: Onset[],
    tickToSeconds: (tick: number) => number
): number {
    let closestIdx = 0
    let closestDist = Infinity
    for (let i = 0; i < onsets.length; i++) {
        const dist = Math.abs(tickToSeconds(onsets[i].date) - seconds)
        if (dist < closestDist) {
            closestDist = dist
            closestIdx = i
        }
    }

    const nextIdx = closestIdx + 1 < onsets.length ? closestIdx + 1 : closestIdx - 1
    if (nextIdx < 0 || nextIdx >= onsets.length) return 0.25

    const deltaTicks = Math.abs(onsets[nextIdx].date - onsets[closestIdx].date)
    const deltaSeconds = Math.abs(tickToSeconds(onsets[nextIdx].date) - tickToSeconds(onsets[closestIdx].date))
    if (deltaTicks === 0 || deltaSeconds === 0) return 0.25

    const secondsPerTick = deltaSeconds / deltaTicks
    const secondsPerBeat = 60 / bpm
    const ticksPerBeat = secondsPerBeat / secondsPerTick
    const rawBeatLength = ticksPerBeat / 2880

    let best = 0.25
    let bestDist2 = Infinity
    for (const bl of STANDARD_BEAT_LENGTHS) {
        const d = Math.abs(rawBeatLength - bl)
        if (d < bestDist2) {
            bestDist2 = d
            best = bl
        }
    }

    return best
}

export function beatLengthLabel(beatLength: number): string {
    switch (beatLength) {
        case 0.0625: return '1/16'
        case 0.125: return '1/8'
        case 0.25: return '1/4'
        case 0.375: return '3/8'
        case 0.5: return '1/2'
        case 0.75: return '3/4'
        case 1.0: return '1/1'
        default: return beatLength.toFixed(3)
    }
}

export function findOnsetTick(
    seconds: number,
    onsets: Onset[],
    tickToSeconds: (tick: number) => number
): number | undefined {
    let bestTick: number | undefined
    let bestDist = Infinity
    for (const onset of onsets) {
        const dist = Math.abs(tickToSeconds(onset.date) - seconds)
        if (dist < bestDist) {
            bestDist = dist
            bestTick = onset.date
        }
    }
    return bestTick
}

function interpolateBpm(line: DrawnLine, atSeconds: number): number {
    const x = (atSeconds - line.from.seconds) / (line.to.seconds - line.from.seconds)
    const p = Math.log(0.5) / Math.log(line.meanTempoAt)
    return line.from.bpm + Math.pow(x, p) * (line.to.bpm - line.from.bpm)
}

export function resolveOverlaps(existing: DrawnLine[], newLine: DrawnLine): DrawnLine[] {
    const newStart = Math.min(newLine.from.seconds, newLine.to.seconds)
    const newEnd = Math.max(newLine.from.seconds, newLine.to.seconds)

    const result: DrawnLine[] = []

    for (const old of existing) {
        const oldStart = Math.min(old.from.seconds, old.to.seconds)
        const oldEnd = Math.max(old.from.seconds, old.to.seconds)

        // No overlap — keep as-is
        if (oldEnd <= newStart || oldStart >= newEnd) {
            result.push(old)
            continue
        }

        // Completely covered — remove
        if (oldStart >= newStart && oldEnd <= newEnd) {
            continue
        }

        const leftToRight = old.from.seconds <= old.to.seconds

        // Old extends before new — keep the part before newStart
        if (oldStart < newStart) {
            const bpmAtTrim = interpolateBpm(old, newStart)
            const trimmed = leftToRight
                ? { from: old.from, to: { seconds: newStart, bpm: bpmAtTrim } }
                : { from: { seconds: newStart, bpm: bpmAtTrim }, to: old.to }
            result.push({ ...trimmed, meanTempoAt: old.meanTempoAt, beatLength: old.beatLength })
        }

        // Old extends after new — keep the part after newEnd
        if (oldEnd > newEnd) {
            const bpmAtTrim = interpolateBpm(old, newEnd)
            const trimmed = leftToRight
                ? { from: { seconds: newEnd, bpm: bpmAtTrim }, to: old.to }
                : { from: old.from, to: { seconds: newEnd, bpm: bpmAtTrim } }
            result.push({ ...trimmed, meanTempoAt: old.meanTempoAt, beatLength: old.beatLength })
        }
    }

    return result
}
