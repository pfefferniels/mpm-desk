import { describe, it, expect } from 'vitest'
import {
    formatTravel,
    isPressTravel,
    movedPlateau,
    movedVertex,
    parseTravel,
    plateauAround,
    positionAt,
    releaseShifted,
    returnToRest,
    sameTravel,
    sparseTravel,
    switchTravel,
    withVertex,
    withoutVertex,
    type Travel,
} from './pedalTravel'

/** The rise of the first sustain press of WM 225 A, as linked-rolls 0.7.0 renders it. */
const rise: Travel = [
    [0, 0.04], [3, 0.11], [7, 0.17], [10, 0.24], [14, 0.29], [17, 0.35], [21, 0.40], [26, 0.46],
    [31, 0.53], [36, 0.58], [43, 0.65], [50, 0.70], [59, 0.76], [70, 0.82], [83, 0.87],
    [103, 0.93], [146, 0.98], [191, 1.00],
].map(([ms, position]) => ({ ms, position }))

/** One controller step per unit level, the way a run-length stream arrives. */
const everyStep = (ms: number, from: number, to: number): Travel =>
    Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => ({
        ms: Math.round((i / Math.abs(to - from)) * ms),
        position: (from + Math.sign(to - from) * i) / 127,
    }))

describe('the travel as the record spells it', () => {
    it('survives a round trip through the text', () => {
        expect(parseTravel(formatTravel(rise))).toEqual(rise)
    })

    it('reads a text that wraps over lines', () => {
        expect(parseTravel('\n  0:0.00 190:1.00\n  400:0.00\n')).toEqual([
            { ms: 0, position: 0 },
            { ms: 190, position: 1 },
            { ms: 400, position: 0 },
        ])
    })

    it.each([
        ['runs backwards', '0:0.00 190:1.00 120:0.50'],
        ['stands still', '0:0.00 190:1.00 190:0.50'],
        ['leaves the unit range', '0:0.00 190:1.50'],
        ['is not pairs at all', 'down up'],
        ['is empty', '   '],
    ])('refuses a text that %s', (_, text) => {
        expect(() => parseTravel(text)).toThrow('Not a pedal travel')
    })
})

describe('thinning the line', () => {
    it('keeps both ends of a stretch at one position and one vertex per step of tolerance', () => {
        const press: Travel = [...everyStep(190, 0, 127), { ms: 2800, position: 1 }, ...everyStep(190, 127, 0).map(v => ({ ...v, ms: v.ms + 2800 }))]
        const kept = sparseTravel(press, 0.05)

        expect(kept.length).toBeLessThan(press.length / 3)
        expect(kept).toContainEqual({ ms: 190, position: 1 })
        expect(kept).toContainEqual({ ms: 2800, position: 1 })
        expect(kept.at(-1)).toEqual(press.at(-1))
        // Nothing thinned away is further from the kept line than the tolerance
        for (const vertex of press) {
            expect(Math.abs(positionAt(kept, vertex.ms) - vertex.position)).toBeLessThan(0.05)
        }
    })

    it('leaves a switch as it is', () => {
        expect(sparseTravel(switchTravel(400))).toEqual(switchTravel(400))
    })

    it('keeps both ends of a hold, however small their steps', () => {
        // A run-length stream holds a plateau as one sample, reached by a step of one level and
        // left by another, both of which position alone would thin away.
        const reachesPlateau = { ms: 190, position: 1 }
        const leavesPlateau = { ms: 2846, position: 126 / 127 }
        const press: Travel = [
            ...everyStep(190, 0, 127),
            leavesPlateau,
            ...everyStep(190, 125, 0).map(v => ({ ...v, ms: v.ms + 2849 })),
        ]

        const kept = sparseTravel(press, 0.05)
        expect(kept).toContainEqual(reachesPlateau)
        expect(kept).toContainEqual(leavesPlateau)
    })
})

describe('where the pedal stands', () => {
    it('holds the last vertex reached, as a controller value does', () => {
        expect(positionAt(rise, 10)).toBe(0.24)
        expect(positionAt(rise, 12)).toBe(0.24)
        expect(positionAt(rise, 1000)).toBe(1)
    })

    it('is at rest before the line begins', () => {
        expect(positionAt(rise, -1)).toBe(0)
    })

    it('reads a switch as down throughout and up at the end', () => {
        const held = switchTravel(400)
        expect(positionAt(held, 0)).toBe(1)
        expect(positionAt(held, 399)).toBe(1)
        expect(positionAt(held, 400)).toBe(0)
    })
})

/** Up in three steps, held, down again in three: the shape a corrected press tends to have. */
const press: Travel = [
    { ms: 0, position: 0.3 },
    { ms: 100, position: 0.7 },
    { ms: 190, position: 1 },
    { ms: 1800, position: 1 },
    { ms: 1900, position: 0.5 },
    { ms: 2000, position: 0 },
]

describe('what a press record is', () => {
    it('leaves rest at 0 and returns there at the end', () => {
        expect(isPressTravel(press)).toBe(true)
        expect(isPressTravel(switchTravel(400))).toBe(true)
        expect(returnToRest(press)).toBe(2000)
    })

    it.each([
        ['is empty', []],
        ['is one vertex', [{ ms: 0, position: 1 }]],
        ['does not start at 0', [{ ms: 10, position: 1 }, { ms: 400, position: 0 }]],
        ['never returns to rest', [{ ms: 0, position: 1 }, { ms: 400, position: 0.2 }]],
        ['runs backwards', [{ ms: 0, position: 1 }, { ms: 400, position: 1 }, { ms: 300, position: 0 }]],
    ])('refuses a line that %s', (_, travel) => {
        expect(isPressTravel(travel)).toBe(false)
    })

    it('compares lines by their vertices', () => {
        expect(sameTravel(press, press.map(vertex => ({ ...vertex })))).toBe(true)
        expect(sameTravel(press, withoutVertex(press, 1))).toBe(false)
    })
})

describe('moving a vertex', () => {
    it('keeps it strictly between its neighbours, in whole milliseconds', () => {
        expect(movedVertex(press, 1, { ms: 150.4, position: 0.7 })[1]).toEqual({ ms: 150, position: 0.7 })
        expect(movedVertex(press, 1, { ms: -50, position: 0.7 })[1].ms).toBe(1)
        expect(movedVertex(press, 1, { ms: 5000, position: 0.7 })[1].ms).toBe(189)
    })

    it('holds the position inside the unit range, to two decimals', () => {
        expect(movedVertex(press, 1, { ms: 100, position: 1.4 })[1].position).toBe(1)
        expect(movedVertex(press, 1, { ms: 100, position: -0.2 })[1].position).toBe(0)
        expect(movedVertex(press, 1, { ms: 100, position: 0.123 })[1].position).toBe(0.12)
    })

    it('pins the first vertex at 0 and the last at rest', () => {
        expect(movedVertex(press, 0, { ms: 40, position: 0.6 })[0]).toEqual({ ms: 0, position: 0.6 })
        expect(movedVertex(press, 5, { ms: 2500, position: 0.9 })[5]).toEqual({ ms: 2500, position: 0 })
    })

    it('leaves the line alone for an index it does not have', () => {
        expect(movedVertex(press, 9, { ms: 0, position: 0 })).toBe(press)
    })
})

describe('adding and removing a vertex', () => {
    it('places a new vertex by its time', () => {
        expect(withVertex(press, { ms: 1000, position: 0.5 }).map(vertex => vertex.ms)).toEqual([
            0, 100, 190, 1000, 1800, 1900, 2000,
        ])
    })

    it('replaces the vertex already at that millisecond', () => {
        const replaced = withVertex(press, { ms: 190, position: 0.9 })
        expect(replaced).toHaveLength(press.length)
        expect(replaced[2]).toEqual({ ms: 190, position: 0.9 })
    })

    it('refuses a vertex outside the ends', () => {
        expect(withVertex(press, { ms: 0, position: 0.5 })).toBe(press)
        expect(withVertex(press, { ms: 2000, position: 0.5 })).toBe(press)
        expect(withVertex(press, { ms: 2500, position: 0.5 })).toBe(press)
    })

    it('removes a vertex but never an end', () => {
        expect(withoutVertex(press, 1).map(vertex => vertex.ms)).toEqual([0, 190, 1800, 1900, 2000])
        expect(withoutVertex(press, 0)).toBe(press)
        expect(withoutVertex(press, 5)).toBe(press)
    })
})

describe('the plateau', () => {
    it('is the run of neighbours at one position', () => {
        expect(plateauAround(press, 2)).toEqual({ from: 2, to: 3 })
        expect(plateauAround(press, 3)).toEqual({ from: 2, to: 3 })
        expect(plateauAround(press, 1)).toEqual({ from: 1, to: 1 })
    })

    it('moves whole', () => {
        const lowered = movedPlateau(press, 3, 0.6)
        expect(lowered.map(vertex => vertex.position)).toEqual([0.3, 0.7, 0.6, 0.6, 0.5, 0])
    })

    it('is not the final rest', () => {
        expect(movedPlateau(press, 5, 0.6)).toBe(press)
    })
})

describe('moving the release', () => {
    it('shifts the end of the hold and the fall together', () => {
        expect(releaseShifted(press, 500).map(vertex => vertex.ms)).toEqual([0, 100, 190, 2300, 2400, 2500])
        expect(releaseShifted(press, -500).map(vertex => vertex.ms)).toEqual([0, 100, 190, 1300, 1400, 1500])
    })

    it('cannot cross the last rise', () => {
        expect(releaseShifted(press, -5000).map(vertex => vertex.ms)).toEqual([0, 100, 190, 191, 291, 391])
    })

    it('moves the lift of a switch', () => {
        expect(releaseShifted(switchTravel(400), 100)).toEqual([{ ms: 0, position: 1 }, { ms: 500, position: 0 }])
        expect(releaseShifted(switchTravel(400), -1000)[1].ms).toBe(1)
    })

    it('leaves a retake before the release where it is', () => {
        const retake: Travel = [
            { ms: 0, position: 1 },
            { ms: 500, position: 0.2 },
            { ms: 600, position: 1 },
            { ms: 1500, position: 1 },
            { ms: 1700, position: 0 },
        ]
        expect(releaseShifted(retake, 300).map(vertex => vertex.ms)).toEqual([0, 500, 600, 1800, 2000])
    })
})
