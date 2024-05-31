type Range = {
    start: number 
    end: number
}

export type Tempo = {
    date: Range
    time: Range
    selected: boolean
}

export const asBPM = (r: Range) => {
    return 60 / (r.end - r.start)
}

/**
 * A wrapper around an array of `Duration`s. Provides 
 * useful methods for working with durations, such as 
 * sorting by their lengthes, finding the first and the 
 * last onset times etc.
 */
export class TempoCluster {
    tempos: Tempo[]

    constructor(tempos: Tempo[]) {
        this.tempos = tempos
    }

    removeTempo(tempo: Tempo) {
        const index = this.tempos.indexOf(tempo)
        if (index !== -1) {
            this.tempos.splice(index, 1)
        }
    }

    // sort by area descending
    sort() {
        // const areaOf = (t: Tempo) => (t.date.end - t.date.start) * asBPM(t.time)
        return this.tempos.sort((a, b) => asBPM(b.date) - asBPM(a.date))
    }

    unselectAll() {
        this.tempos.forEach(d => d.selected = false)
    }

    highestBPM() {
        return Math.max(...this.tempos.map(t => asBPM(t.time)))
    }

    start() {
        return Math.min(...this.tempos.map(d => d.date.start))
    }

    end() {
        return Math.max(...this.tempos.map(d => d.date.end))
    }
}