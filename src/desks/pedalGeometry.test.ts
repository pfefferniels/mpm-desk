import { describe, expect, it } from 'vitest'
import type { AlignedPedal } from '../fitting/alignment'
import { switchTravel } from '../performance/pedalTravel'
import {
    laneY,
    PEDAL_AREA,
    pedalLanes,
    pedalLine,
    placeTravel,
    positionAtY,
    pressesOf,
    stepLine,
    type PedalLane,
} from './pedalGeometry'

/** A recorded depression, stated the way MSM states one: milliseconds, and an absolute release. */
const pedal = (
    type: AlignedPedal['type'],
    source: string,
    onsetMs: number,
    heldMs: number,
): AlignedPedal => ({
    'xml:id': `${source}_${type}_${onsetMs}`,
    type,
    source,
    'milliseconds.date': onsetMs,
    'milliseconds.date.end': onsetMs + heldMs,
})

describe('pedalLanes', () => {
    it('gives a lane only to a pedal the recordings use', () => {
        const lanes = pedalLanes([pedal('sustain', 'a', 0, 1000)], 300)

        expect(lanes.map(lane => lane.type)).toEqual(['sustain'])
        expect(lanes[0].rest).toBeGreaterThanOrEqual(300)
        expect(lanes[0].pressed).toBeLessThanOrEqual(300 + PEDAL_AREA)
    })

    it('puts sustain above soft, whatever order the pedals arrive in', () => {
        const lanes = pedalLanes(
            [pedal('soft', 'a', 0, 500), pedal('sustain', 'a', 0, 500)],
            300,
        )

        expect(lanes.map(lane => lane.type)).toEqual(['sustain', 'soft'])
        expect(lanes[0].rest).toBeLessThan(lanes[1].rest)
    })

    it('drops the line rather than raising it', () => {
        const [lane] = pedalLanes([pedal('sustain', 'a', 0, 500)], 300)

        expect(lane.pressed).toBeGreaterThan(lane.rest)
    })

    it('fills the band a desk asks for', () => {
        const [lane] = pedalLanes([pedal('sustain', 'a', 0, 500)], 312, 160)

        expect(lane.rest).toBe(344)
        expect(lane.pressed).toBe(432)
    })
})

describe('a position in a lane', () => {
    const lane: PedalLane = { type: 'sustain', rest: 10, pressed: 20 }

    it('is drawn between the rail and the floor', () => {
        expect(laneY(lane, 0)).toBe(10)
        expect(laneY(lane, 0.5)).toBe(15)
        expect(laneY(lane, 1)).toBe(20)
    })

    it('is read back off the plot, held inside the lane', () => {
        expect(positionAtY(lane, laneY(lane, 0.3))).toBeCloseTo(0.3, 10)
        expect(positionAtY(lane, 5)).toBe(0)
        expect(positionAtY(lane, 30)).toBe(1)
    })

    it('places a travel by seconds on the axis and position in the lane', () => {
        const placed = placeTravel([{ ms: 0, position: 0.5 }, { ms: 500, position: 1 }], 3000, lane, 20)

        expect(placed).toEqual([{ x: 60, y: 15 }, { x: 70, y: 20 }])
    })
})

describe('pressesOf', () => {
    const pedals = [
        pedal('sustain', 'welte', 0, 2000),
        pedal('sustain', 'hupfeld', 500, 1000),
        pedal('soft', 'welte', 3000, 1000),
    ]

    it('reads one reading of one pedal, in the pixels the plot draws in', () => {
        // Seconds on the axis: 500ms at stretch 10 is 5 units in, and lasts 10.
        expect(pressesOf(pedals, 'sustain', 'hupfeld', 10)).toEqual([{ from: 5, to: 15 }])
    })

    it('joins presses that overlap', () => {
        const overlapping = [
            pedal('sustain', 'welte', 0, 2000),
            pedal('sustain', 'welte', 1000, 2000),
        ]

        // One press from the first depression to the last lift: 0 to 3s, at a stretch of one
        // pixel to the second.
        expect(pressesOf(overlapping, 'sustain', 'welte', 1)).toEqual([{ from: 0, to: 3 }])
    })

    it('keeps a retake, where one press ends as the next begins', () => {
        const retaken = [
            pedal('sustain', 'welte', 0, 1000),
            pedal('sustain', 'welte', 1000, 1000),
        ]

        expect(pressesOf(retaken, 'sustain', 'welte', 1)).toHaveLength(2)
    })

    it('leaves out a press the recording does not time', () => {
        const untimed: AlignedPedal = {
            'xml:id': 'untimed',
            type: 'sustain',
            source: 'welte',
            'milliseconds.date': NaN,
            'milliseconds.date.end': NaN,
        }

        expect(pressesOf([untimed], 'sustain', 'welte', 1)).toEqual([])
    })
})

describe('pedalLine', () => {
    it('runs flat from end to end where the pedal is never touched', () => {
        expect(pedalLine([], 10, 20, 400)).toBe('0,10 400,10')
    })

    it('steps down at the press and back up at the lift', () => {
        expect(pedalLine([{ from: 100, to: 200 }], 10, 20, 400))
            .toBe('0,10 100,10 100,20 200,20 200,10 400,10')
    })
})

describe('stepLine', () => {
    const lane: PedalLane = { type: 'sustain', rest: 10, pressed: 20 }

    it('draws a switch as the step of one press', () => {
        expect(stepLine(placeTravel(switchTravel(1000), 5000, lane, 20), lane.rest))
            .toBe('100,10 100,20 120,20 120,10')
    })

    it('holds each position until the next vertex, and repeats no corner of a plateau', () => {
        const line = [
            { ms: 0, position: 0.5 },
            { ms: 500, position: 1 },
            { ms: 1500, position: 1 },
            { ms: 2000, position: 0 },
        ]

        expect(stepLine(placeTravel(line, 3000, lane, 20), lane.rest))
            .toBe('60,10 60,15 70,15 70,20 90,20 100,20 100,10')
    })

    it('draws nothing for no vertices', () => {
        expect(stepLine([], 10)).toBe('')
    })
})
