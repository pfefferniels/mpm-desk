import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { VerticalScale } from './VerticalScale'

/**
 * The scale lives in a gutter beside the chart, not over it. That only holds if it draws nothing
 * to the right of its axis and nothing past the bottom of the plot it labels — which is what the
 * absolutely positioned overlay it replaced got wrong in both directions.
 */

/** The desk's numbers: velocity 10..80 every 5, at stretch 3, against a 320px plot. */
const desk = { min: 10, max: 80, step: 5, height: 320, stretchY: 3 }

const draw = (props = desk) => render(<svg><VerticalScale {...props} /></svg>).container

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

    it('labels only the velocities the plot can show', () => {
        const labels = [...draw().querySelectorAll('text')].map(t => t.textContent)

        // (127 - 20.33) * 3 = 320, so 10 and 15 are below the plot's floor — the overlay drew
        // them anyway and let the viewport cut them off.
        expect(labels).not.toContain('10')
        expect(labels).not.toContain('15')
        expect(labels[0]).toBe('25')
        expect(labels[labels.length - 1]).toBe('80')
    })

    it('keeps every tick inside the plot', () => {
        const ys = [...draw().querySelectorAll('line')]
            .flatMap(el => [el.getAttribute('y1'), el.getAttribute('y2')])
            .map(Number)

        expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
        expect(Math.max(...ys)).toBeLessThanOrEqual(desk.height)
    })

    it('puts a tick where the plot puts its velocity', () => {
        const container = draw()
        const label = [...container.querySelectorAll('text')].find(t => t.textContent === '80')
        // The chart draws velocity v at (127 - v) * stretchY, and the scale has to agree.
        expect(Number(label!.getAttribute('y'))).toBe((127 - 80) * desk.stretchY)
    })
})
