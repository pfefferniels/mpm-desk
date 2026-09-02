import { describe, expect, it } from 'vitest'
import { areaPath, sampleTransition } from './transitionSamples'

/**
 * The desks used to walk a transition in steps of one tick, so a segment's cost was a property of
 * the score's grid rather than of how many pixels it covers. See issue #31.
 */

const span = { date: 0, endDate: 46_000 }

/** A ramp, so that no two dates in the span answer the same value. */
const rampFrom = (from: number, to: number) => (date: number) =>
    from + ((to - from) * (date - span.date)) / (span.endDate - span.date)

describe('sampleTransition', () => {
    it('samples once per pixel, whatever the span is in ticks', () => {
        const zoomedOut = sampleTransition(span, rampFrom(0, 1), 0.005)
        const zoomedIn = sampleTransition(span, rampFrom(0, 1), 0.3)

        expect(zoomedOut.length).toBe(Math.ceil(46_000 * 0.005) + 1)
        expect(zoomedIn.length).toBe(Math.ceil(46_000 * 0.3) + 1)
        // The whole of the bug, stated as the thing that must no longer be true.
        expect(zoomedIn.length).toBeLessThan(46_000)
    })

    it('spends two points on a span that holds one value', () => {
        const flat = sampleTransition(span, () => 0, 0.3)

        expect(flat).toEqual([
            { x: 0, value: 0 },
            { x: 46_000 * 0.3, value: 0 },
        ])
    })

    it('reaches both ends of the span exactly', () => {
        const samples = sampleTransition(span, rampFrom(10, 90), 0.05)

        expect(samples.at(0)).toEqual({ x: 0, value: 10 })
        expect(samples.at(-1)).toEqual({ x: 46_000 * 0.05, value: 90 })
    })

    it('draws nothing for a span with no extent', () => {
        expect(sampleTransition({ date: 480, endDate: 480 }, () => 1, 0.3)).toEqual([])
    })
})

describe('areaPath', () => {
    const points = [{ x: 0, y: 4 }, { x: 1, y: 2 }]

    it('runs from the baseline through the points and back', () => {
        expect(areaPath(points, 10)).toBe('M 0 10 L 0 4 L 1 2 L 1 10')
    })

    it('closes the outline when asked', () => {
        expect(areaPath(points, 10, { closed: true })).toBe('M 0 10 L 0 4 L 1 2 L 1 10 Z')
    })

    it('is empty without points', () => {
        expect(areaPath([], 10)).toBe('')
    })
})
