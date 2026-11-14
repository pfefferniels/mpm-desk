import { describe, expect, it } from 'vitest'
import { PULSES_PER_QUARTER } from '../../fitting/ppq'
import { DEFAULT_GUIDE_GRID, gridDates, gridTicks, snapGuide } from './guideGrid'

/** The score's own extent in these cases: three quarters and a bit. */
const end = 2500

describe('the guide grid', () => {
    it('is the score resolution, not a literal', () => {
        expect(gridTicks(DEFAULT_GUIDE_GRID)).toBe(PULSES_PER_QUARTER)
        expect(gridTicks(0.125)).toBe(PULSES_PER_QUARTER / 2)
    })

    it('snaps a click to the nearest line', () => {
        expect(snapGuide({ date: 400, velocity: 64 }, 0.25, end)?.date).toBe(720)
        expect(snapGuide({ date: 300, velocity: 64 }, 0.25, end)?.date).toBe(0)
        expect(snapGuide({ date: 400, velocity: 64 }, 0.125, end)?.date).toBe(360)
    })

    it('places nothing off either end of the score', () => {
        expect(snapGuide({ date: -400, velocity: 64 }, 0.25, end)).toBeUndefined()
        expect(snapGuide({ date: 2600, velocity: 64 }, 0.25, end)).toBeUndefined()
    })

    it('rounds the velocity and holds it in MIDI range', () => {
        expect(snapGuide({ date: 0, velocity: 63.6 }, 0.25, end)?.velocity).toBe(64)
        expect(snapGuide({ date: 0, velocity: 200 }, 0.25, end)?.velocity).toBe(127)
        expect(snapGuide({ date: 0, velocity: -3 }, 0.25, end)?.velocity).toBe(0)
    })

    it('draws its lines from tick 0, so the anacrusis needs no origin', () => {
        expect(gridDates(0.25, 2160)).toEqual([0, 720, 1440, 2160])
        expect(gridDates(0.25, 2100)).toEqual([0, 720, 1440])
    })
})
