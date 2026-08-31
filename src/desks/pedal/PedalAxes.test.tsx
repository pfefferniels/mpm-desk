import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { PULSES_PER_QUARTER } from '../../fitting/ppq'
import { PedalGutter, TickScale } from './PedalAxes'
import { LANE_HEIGHT, pedalPlot } from './layout'

const draw = (element: React.ReactNode) => render(<svg>{element}</svg>).container

const textAt = (container: Element, name: string) =>
    [...container.querySelectorAll('text')].filter(text => text.textContent === name)

describe('PedalGutter', () => {
    it('names a row only where the plot has one', () => {
        const container = draw(<PedalGutter plot={pedalPlot(['sustain'], ['sustain'])} />)

        expect(textAt(container, 'soft')).toHaveLength(0)
        // The pedal is named twice: once over its presses, once over the movements written for it.
        expect(textAt(container, 'sustain')).toHaveLength(2)
    })

    it('names the axis the plot is drawn against', () => {
        const plot = pedalPlot(['sustain'], ['sustain'])
        const [ticks] = textAt(draw(<PedalGutter plot={plot} />), 'ticks')

        expect(Number(ticks.getAttribute('y'))).toBe(plot.axisY)
    })

    it('stays in its column, left of the plot', () => {
        const container = draw(<PedalGutter plot={pedalPlot(['sustain', 'soft'], ['unknown'])} />)
        const xs = [...container.querySelectorAll('line, text')]
            .flatMap(element => ['x1', 'x2', 'x'].map(attribute => element.getAttribute(attribute)))
            .filter((x): x is string => x !== null)
            .map(Number)

        expect(xs.length).toBeGreaterThan(0)
        expect(Math.max(...xs)).toBe(0)
    })

    it('puts a full pedal one lane below the rail it is measured from', () => {
        const plot = pedalPlot([], ['sustain', 'soft'])
        const container = draw(<PedalGutter plot={plot} />)
        const y = (position: string) =>
            textAt(container, position).map(text => Number(text.getAttribute('y')))

        expect(y('0')).toEqual(plot.lanes.map(lane => lane.y))
        expect(y('1')).toEqual(plot.lanes.map(lane => lane.y + LANE_HEIGHT))
    })
})

const dates = (stretchX: number, end = 91464) =>
    [...draw(<TickScale end={end} stretchX={stretchX} y={0} />).querySelectorAll('text')]
        .map(text => Number(text.textContent))

/** The zoom the desk can be at: `ZOOM_MIN` to `ZOOM_MAX`, over the 200 the symbolic domain is. */
describe.each([0.005, 0.02, 0.1, 0.3])('TickScale at a stretch of %f', stretchX => {
    it('counts in whole quarter notes', () => {
        expect(dates(stretchX).every(date => date % PULSES_PER_QUARTER === 0)).toBe(true)
    })

    it('leaves room to read a figure', () => {
        const drawn = dates(stretchX)

        expect(drawn.length).toBeGreaterThan(1)
        expect((drawn[1] - drawn[0]) * stretchX).toBeGreaterThanOrEqual(80)
    })
})

describe('TickScale', () => {
    it('stops where the piece does', () => {
        expect(Math.max(...dates(0.02, 10000))).toBeLessThanOrEqual(10000)
    })
})
