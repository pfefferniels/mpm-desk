import { MSM } from "mpmify"
import { Scope } from "../../../mpm-ts/lib"

export type Range = {
    start: number
    end: number
}

export type TempoSegment = {
    date: Range
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

    sort(backwards?: boolean) {
        return [...this.segments].sort((a, b) => {
            if (a.selected !== b.selected) {
                return a.selected ? 1 : -1
            }
            if (backwards) return (b.date.start - a.date.start) || asBPM(b.date) - asBPM(a.date)
            return (a.date.start - b.date.start) || asBPM(b.date) - asBPM(a.date)
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

export const isWithinSegment = (date: number, segment: TempoSegment) => {
    return (date >= segment.date.start) && (date < segment.date.end)
}

