import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { Normalized } from 'espressivo'
import { createMpm, getInstructions, requireMap, type Instruction } from '../../fitting/instructions/index'
import { MovementSegment } from './MovementSegment'

/**
 * A segment must not hold one point per tick, which would make its cost a property of the
 * score's grid. The soft lane of the shipped fixture spends 46,267 ticks at `position="0"`
 * between one press and the next, which comes to a `d` of 1,450,337 characters. See issue #31.
 */

const movement = (position: number, transitionTo?: number): Instruction<'movement'> => {
    const mpm = createMpm()
    requireMap(mpm, 'movement', 'global').addMovement({
        id: 'movement_0',
        date: 7_100,
        position: position as Normalized,
        transitionTo: transitionTo as Normalized | undefined,
        controller: 'soft',
    })

    return getInstructions(mpm, 'movement')[0]
}

/** The `d` the segment draws over `endDate`, at `stretchX` pixels per tick. */
const drawn = (instruction: Instruction<'movement'>, endDate: number, stretchX: number): string => {
    const { container } = render(
        <svg>
            <MovementSegment
                instruction={{ ...instruction, endDate }}
                stretchX={stretchX}
                stretchY={20}
            />
        </svg>
    )

    return container.querySelector('path')?.getAttribute('d') ?? ''
}

const corners = (d: string) => [...d.matchAll(/L /g)].length

/** The two ends of the symbolic zoom range, in pixels per tick. */
const zoomedIn = 0.3
const zoomedOut = 0.005

describe('MovementSegment', () => {
    const end = 53_367

    it('spends two points on a stretch where the pedal does not move', () => {
        // Two curve points and the corner back down to the rail.
        expect(corners(drawn(movement(0), end, zoomedIn))).toBe(3)
    })

    it('samples what the segment covers on screen, not what it covers in ticks', () => {
        const span = end - 7_100

        expect(corners(drawn(movement(0, 1), end, zoomedIn)))
            .toBe(Math.ceil(span * zoomedIn) + 2)
        expect(corners(drawn(movement(0, 1), end, zoomedOut)))
            .toBe(Math.ceil(span * zoomedOut) + 2)
        // The whole of the bug, stated as the thing that must no longer be true.
        expect(corners(drawn(movement(0, 1), end, zoomedIn))).toBeLessThan(span)
    })

    it('reaches the end of its span, so a segment meets the next one', () => {
        const d = drawn(movement(0, 1), end, zoomedIn)

        expect(d.endsWith(`L ${end * zoomedIn} 0`)).toBe(true)
    })
})
