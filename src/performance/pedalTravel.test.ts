import { describe, it, expect } from 'vitest'
import {
    formatTravel,
    parseTravel,
    positionAt,
    sparseTravel,
    switchTravel,
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
