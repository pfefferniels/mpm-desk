import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { VerticalScale } from './VerticalScale'
import { velocityAxis } from '../velocityAxis'

/**
 * The scale lives in a gutter beside the chart rather than over it, which holds only if it draws
 * nothing to the right of its axis and nothing past the top or bottom of the plot it labels.
 */

/** WM 225 on the desk: corrected velocities from 8, recorded ones up to 62, on a 320px plot. */
const height = 320
const axis = velocityAxis([8, 35, 54, 62], height)

const draw = () => render(<svg><VerticalScale axis={axis} /></svg>).container

describe('VerticalScale', () => {
    it('draws nothing right of the axis', () => {
        const container = draw()
        const xs = [...container.querySelectorAll('line, text')]
            .flatMap(el => ['x1', 'x2', 'x'].map(a => el.getAttribute(a)))
            .filter((x): x is string => x !== null)
            .map(Number)

        expect(xs.length).toBeGreaterThan(0)
        expect(Math.max(...xs)).toBe(0)
    })

    it('labels the whole range the plot shows, the softest note included', () => {
        const labels = [...draw().querySelectorAll('text')].map(t => Number(t.textContent))

        // The old scale stopped at 25, where its 320px ran out, and the notes `Expand` took down
        // to 8 were drawn beneath it.
        expect(Math.min(...labels)).toBeLessThanOrEqual(8)
        expect(Math.max(...labels)).toBeGreaterThanOrEqual(62)
        expect(labels[0]).toBe(axis.min)
        expect(labels[labels.length - 1]).toBe(axis.max)
    })

    it('keeps every tick inside the plot', () => {
        const ys = [...draw().querySelectorAll('line')]
            .flatMap(el => [el.getAttribute('y1'), el.getAttribute('y2')])
            .map(Number)

        expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
        expect(Math.max(...ys)).toBeLessThanOrEqual(height)
    })

    it('puts a tick where the plot puts its velocity', () => {
        const container = draw()
        const label = [...container.querySelectorAll('text')].find(t => t.textContent === '40')
        expect(Number(label!.getAttribute('y'))).toBe(axis.y(40))
    })
})
