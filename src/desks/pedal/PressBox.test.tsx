import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import type { AlignedPedal } from '../../fitting/alignment'
import type { TickVertex } from '../../fitting/transformers/tempo/tickTimes'
import { PressBox } from './PressBox'

const pedal: AlignedPedal = {
    'xml:id': 'sustain_0',
    type: 'sustain',
    'milliseconds.date': 0,
    'milliseconds.date.end': 1000,
}

/** A switch 720 ticks long from tick 1440, and a half pedal drawn by hand. */
const held: TickVertex[] = [
    { date: 1440, ms: 0, position: 1 },
    { date: 2160, ms: 1000, position: 0 },
]
const halfway: TickVertex[] = [
    { date: 1440, ms: 0, position: 0.5 },
    { date: 1800, ms: 500, position: 1 },
    { date: 2160, ms: 1000, position: 0 },
]

/** Drawn at a zoom that makes a tick a pixel, on a row starting at the top of the plot. */
const renderPress = (line: TickVertex[] = held, onPick = vi.fn()) => {
    render(
        <svg>
            <PressBox pedal={pedal} line={line} y={0} stretchX={1} onPick={onPick} />
        </svg>,
    )

    return {
        onPick,
        line: document.querySelector('polyline[data-line="sustain_0"]'),
        box: document.querySelector('rect[data-press="sustain_0"]') as SVGRectElement,
    }
}

describe('PressBox', () => {
    it('draws a switch as the step it is, a full stroke tall', () => {
        const { line } = renderPress()

        expect(line?.getAttribute('points')).toBe('1440,0 1440,30 2160,30 2160,0')
    })

    it('holds each position of a line until the next vertex', () => {
        const { line } = renderPress(halfway)

        expect(line?.getAttribute('points')).toBe('1440,0 1440,15 1800,15 1800,30 2160,30 2160,0')
    })

    it('is grabbed by the box it encloses, which names the press', () => {
        const { box, onPick } = renderPress()

        expect(box.getAttribute('x')).toBe('1440')
        expect(box.getAttribute('width')).toBe('720')
        expect(box.querySelector('title')?.textContent).toBe('write sustain @1440')

        fireEvent.click(box)

        expect(onPick).toHaveBeenCalledWith(pedal)
    })

    it('thickens the line while the pointer is on it', () => {
        const { box, line } = renderPress()

        expect(line?.getAttribute('stroke-width')).toBe('1.5')
        fireEvent.mouseEnter(box)
        expect(line?.getAttribute('stroke-width')).toBe('2')
    })
})
