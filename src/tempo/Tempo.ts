import { MSM } from "mpmify"
import { Scope } from "../../../mpm-ts/lib"
import { Marker } from "mpmify/lib/transformers"

export type Range = {
    start: number
    end: number
}

export const expandRange = (a: Range, b: Range) => {
    return {
        start: Math.min(a.start, b.start),
        end: Math.max(a.end, b.end)
    }
}

export type TempoSegment = {
    date: Range
    time: Range
    selected: boolean
    silent: boolean
}

export const asBPM = (r: Range) => {
    return 60 / (r.end - r.start)
}

export const extractTempoSegments = (msm: MSM, part: Scope) => {
    msm.shiftToFirstOnset()

    const segments: TempoSegment[] = []
    const chords = msm.asChords(part)

    const iterator = chords.entries()
    let current = iterator.next()
    while (!current.done) {
        const [date, notes] = current.value

        current = iterator.next()
        if (current.done) break

        const [nextDate, nextNotes] = current.value

        const onset = notes[0]['midi.onset']
        const nextOnset = nextNotes[0]['midi.onset']
        if (onset === undefined || nextOnset === undefined) {
            console.log('MIDI onset not defined')
            continue
        }

        segments.push({
            date: {
                start: date,
                end: nextDate
            },
            time: {
                start: onset,
                end: nextOnset
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

    // sort by area descending
    sort() {
        // const areaOf = (t: Tempo) => (t.date.end - t.date.start) * asBPM(t.time)
        return this.segments.sort((a, b) => (a.date.start - b.date.start) || asBPM(b.date) - asBPM(a.date))
    }

    unselectAll() {
        this.segments.forEach(d => d.selected = false)
    }

    importSegments(newSegments: TempoSegment[]) {
        if (this.segments.length === 0) {
            this.segments = newSegments
            return
        }

        for (const segment of this.segments) {
            const leftFriend = newSegments.find(s => s.date.start === segment.date.start)
            if (leftFriend) {
                segment.time.start = leftFriend.time.start
            }

            const rightFriend = newSegments.find(s => s.date.end === segment.date.end)
            if (rightFriend) {
                segment.time.end = rightFriend.time.end
            }
        }
    }

    serialize() {
        return JSON.stringify(this.segments, null, 4)
    }

    get highestBPM() {
        return Math.max(...this.segments.map(t => asBPM(t.time)))
    }

    get startDate() {
        return Math.min(...this.segments.map(d => d.date.start))
    }

    get endDate() {
        return Math.max(...this.segments.map(d => d.date.end))
    }

    get startOnset() {
        return Math.min(...this.segments.map(d => d.time.start))
    }

    get endOnset() {
        return Math.max(...this.segments.map(d => d.time.end))
    }

    get length() {
        return this.segments.length
    }
}

export const isWithinSegment = (date: number, segment: TempoSegment) => {
    return (date >= segment.date.start) && (date < segment.date.end)
}

export const markerFromTempo = (tempo: TempoSegment): Marker => {
    return {
        date: tempo.date.start,
        beatLength: tempo.date.end - tempo.date.start
    }
}

export const isShallowEqual = <T extends object,>(obj1: T, obj2: T) =>
    Object.keys(obj1).length === Object.keys(obj2).length &&
    Object.keys(obj1).every(key =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Object.hasOwn(obj2, key) && (obj1 as any)[key] === (obj2 as any)[key]
    );

