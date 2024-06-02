import { MSM } from "mpmify"
import { Part } from "../../../mpm-ts/lib"

type Range = {
    start: number
    end: number
}

export type TempoSegment = {
    date: Range
    time: Range
    selected: boolean
}

export const asBPM = (r: Range) => {
    return 60 / (r.end - r.start)
}

export const extractTempoSegment = (msm: MSM, part: Part) => {
    const segments: TempoSegment[] = []
    const chords = Object.entries(msm.asChords(part))
    for (let i = 0; i < chords.length - 1; i++) {
        const [date, notes] = chords[i]
        const [nextDate, nextNotes] = chords[i + 1]

        const onset = notes[0]['midi.onset']
        const nextOnset = nextNotes[0]['midi.onset']
        if (!onset || !nextOnset) {
            console.log('MIDI onset not defined')
            continue
        }

        segments.push({
            date: {
                start: +date,
                end: +nextDate
            },
            time: {
                start: onset,
                end: nextOnset
            },
            selected: false
        })
    }

    return segments
}

/**
 * A wrapper around an array of `Duration`s. Provides 
 * useful methods for working with durations, such as 
 * sorting by their lengthes, finding the first and the 
 * last onset times etc.
 */
export class TempoCluster {
    tempos: TempoSegment[]

    constructor(tempos: TempoSegment[]) {
        this.tempos = tempos
    }

    removeTempo(tempo: TempoSegment) {
        const index = this.tempos.indexOf(tempo)
        if (index !== -1) {
            this.tempos.splice(index, 1)
        }
    }

    // sort by area descending
    sort() {
        // const areaOf = (t: Tempo) => (t.date.end - t.date.start) * asBPM(t.time)
        return this.tempos.sort((a, b) => (a.date.start - b.date.start) || asBPM(b.date) - asBPM(a.date))
    }

    unselectAll() {
        this.tempos.forEach(d => d.selected = false)
    }

    highestBPM() {
        return Math.max(...this.tempos.map(t => asBPM(t.time)))
    }

    start() {
        console.log(this.tempos)
        return Math.min(...this.tempos.map(d => d.date.start))
    }

    end() {
        return Math.max(...this.tempos.map(d => d.date.end))
    }
}

export type Marker = {
    date: number
    beatLength: number
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