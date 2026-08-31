import { describe, expect, it } from 'vitest'
import { anchorsOf, nearestAnchor } from './anchors'
import type { DynamicsSegment } from './segments'

const dot = (date: number, velocity: number): DynamicsSegment => ({
    date: { start: date, end: date },
    velocity,
    active: false,
})

describe('anchorsOf', () => {
    it('gives one anchor per chord onset, at the mean of its dots', () => {
        expect(anchorsOf([dot(0, 50), dot(0, 60), dot(720, 40)], new Map())).toEqual([
            { date: 0, velocity: 55 },
            { date: 720, velocity: 40 },
        ])
    })

    it('adds a date no chord sounds at, where a phantom is pencilled in', () => {
        expect(anchorsOf([dot(0, 50)], new Map([[360, 20]]))).toEqual([
            { date: 0, velocity: 50 },
            { date: 360, velocity: 20 },
        ])
    })

    it('lets a phantom replace the chord at its own date', () => {
        expect(anchorsOf([dot(0, 50)], new Map([[0, 20]]))).toEqual([{ date: 0, velocity: 20 }])
    })

    it('returns them in date order, whatever order they were found in', () => {
        const anchors = anchorsOf([dot(720, 40), dot(0, 50)], new Map([[360, 20]]))
        expect(anchors.map((anchor) => anchor.date)).toEqual([0, 360, 720])
    })
})

describe('nearestAnchor', () => {
    const anchors = anchorsOf([dot(0, 50), dot(720, 40)], new Map([[360, 20]]))

    it('finds the nearest one within reach', () => {
        expect(nearestAnchor(anchors, 300, 100)).toEqual({ date: 360, velocity: 20 })
    })

    it('finds nothing beyond reach', () => {
        expect(nearestAnchor(anchors, 180, 100)).toBeUndefined()
    })

    it('reaches a phantom exactly as it reaches a chord', () => {
        expect(nearestAnchor(anchors, 340, 400)).toEqual({ date: 360, velocity: 20 })
    })
})
