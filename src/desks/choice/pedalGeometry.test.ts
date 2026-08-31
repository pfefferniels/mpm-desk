import { describe, expect, it } from 'vitest'
import type { AlignedPedal } from '../../fitting/alignment'
import { PEDAL_AREA, pedalLanes, pedalLine, pressesOf } from './pedalGeometry'

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
