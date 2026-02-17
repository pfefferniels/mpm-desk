import { describe, it, expect } from 'vitest'
import { buildLookupTable, tickToSeconds, secondsToTick, LookupTable } from './timeMapping'

describe('buildLookupTable', () => {
    it('returns null for empty pairs', () => {
        expect(buildLookupTable([])).toBeNull()
    })

    it('sorts pairs by tick', () => {
        const result = buildLookupTable([[720, 2], [0, 0], [360, 1]])
        expect(result).toEqual([[0, 0], [360, 1], [720, 2]])
    })

    it('deduplicates by tick (first wins)', () => {
        const result = buildLookupTable([[0, 0], [360, 1], [360, 999]])
        expect(result).toEqual([[0, 0], [360, 1]])
    })

    it('merges extraPairs without duplicating existing ticks', () => {
        const result = buildLookupTable([[0, 0], [720, 2]], [[360, 1], [720, 99]])
        expect(result).toEqual([[0, 0], [360, 1], [720, 2]])
    })

    it('returns null when all pairs are filtered out', () => {
        expect(buildLookupTable([], [])).toBeNull()
    })
})

describe('tickToSeconds', () => {
    // A simple linear table: 1 tick = 0.001 seconds
    const linear: LookupTable = [[0, 0], [1000, 1], [2000, 2]]

    it('returns 0 for empty table', () => {
        expect(tickToSeconds([], 500)).toBe(0)
    })

    it('returns the single value for a one-entry table', () => {
        expect(tickToSeconds([[100, 5]], 999)).toBe(5)
    })

    it('interpolates between known points', () => {
        expect(tickToSeconds(linear, 500)).toBeCloseTo(0.5)
        expect(tickToSeconds(linear, 1500)).toBeCloseTo(1.5)
    })

    it('returns exact value at known points', () => {
        expect(tickToSeconds(linear, 0)).toBe(0)
        expect(tickToSeconds(linear, 1000)).toBe(1)
        expect(tickToSeconds(linear, 2000)).toBe(2)
    })

    it('extrapolates before the first point', () => {
        expect(tickToSeconds(linear, -500)).toBeCloseTo(-0.5)
    })

    it('extrapolates after the last point', () => {
        expect(tickToSeconds(linear, 3000)).toBeCloseTo(3)
    })

    it('handles non-linear tables', () => {
        // Accelerating: first half is slow, second half is fast
        const table: LookupTable = [[0, 0], [1000, 3], [2000, 4]]

        // Midpoint of first segment
        expect(tickToSeconds(table, 500)).toBeCloseTo(1.5)
        // Midpoint of second segment
        expect(tickToSeconds(table, 1500)).toBeCloseTo(3.5)
    })

    it('handles duplicate tick values gracefully', () => {
        const table: LookupTable = [[0, 0], [1000, 1000]]
        // Exact match on first
        expect(tickToSeconds(table, 0)).toBe(0)
    })
})

describe('secondsToTick', () => {
    const linear: LookupTable = [[0, 0], [1000, 1], [2000, 2]]

    it('returns 0 for empty table', () => {
        expect(secondsToTick([], 1)).toBe(0)
    })

    it('returns the single value for a one-entry table', () => {
        expect(secondsToTick([[100, 5]], 999)).toBe(100)
    })

    it('interpolates between known points', () => {
        expect(secondsToTick(linear, 0.5)).toBeCloseTo(500)
        expect(secondsToTick(linear, 1.5)).toBeCloseTo(1500)
    })

    it('returns exact value at known points', () => {
        expect(secondsToTick(linear, 0)).toBe(0)
        expect(secondsToTick(linear, 1)).toBe(1000)
        expect(secondsToTick(linear, 2)).toBe(2000)
    })

    it('extrapolates before the first point', () => {
        expect(secondsToTick(linear, -0.5)).toBeCloseTo(-500)
    })

    it('extrapolates after the last point', () => {
        expect(secondsToTick(linear, 3)).toBeCloseTo(3000)
    })

    it('handles non-linear tables', () => {
        const table: LookupTable = [[0, 0], [1000, 3], [2000, 4]]

        expect(secondsToTick(table, 1.5)).toBeCloseTo(500)
        expect(secondsToTick(table, 3.5)).toBeCloseTo(1500)
    })
})

describe('roundtrip consistency', () => {
    const table: LookupTable = [[0, 0], [720, 0.8], [1440, 1.9], [2160, 2.5], [2880, 3.6]]

    it('tickToSeconds then secondsToTick returns the original tick', () => {
        const testTicks = [0, 360, 720, 1080, 1440, 2000, 2880]
        for (const tick of testTicks) {
            const seconds = tickToSeconds(table, tick)
            const roundtrip = secondsToTick(table, seconds)
            expect(roundtrip).toBeCloseTo(tick, 5)
        }
    })

    it('secondsToTick then tickToSeconds returns the original seconds', () => {
        const testSeconds = [0, 0.4, 0.8, 1.5, 2.5, 3.6]
        for (const seconds of testSeconds) {
            const tick = secondsToTick(table, seconds)
            const roundtrip = tickToSeconds(table, tick)
            expect(roundtrip).toBeCloseTo(seconds, 5)
        }
    })

    it('roundtrips work for extrapolated values', () => {
        const tick = -500
        const seconds = tickToSeconds(table, tick)
        expect(secondsToTick(table, seconds)).toBeCloseTo(tick, 5)

        const sec = 5.0
        const t = secondsToTick(table, sec)
        expect(tickToSeconds(table, t)).toBeCloseTo(sec, 5)
    })
})
