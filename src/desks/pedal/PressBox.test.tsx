import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import type { AlignedPedal } from '../../fitting/alignment'
import { PressBox } from './PressBox'

const pedal: AlignedPedal = {
    'xml:id': 'sustain_0',
    type: 'sustain',
    'milliseconds.date': 0,
    'milliseconds.date.end': 1000,
}

/** One press 720 ticks long, drawn at a zoom that makes a tick a pixel. */
const renderPress = (onPick = vi.fn(), duration = 720) => {
    render(
        <svg>
            <PressBox
                pedal={pedal}
                date={1440}
                duration={duration}
                y={0}
                stretchX={1}
                guideTo={200}
                onPick={onPick}
            />
        </svg>,
    )

    const half = (direction: string) =>
        document.querySelector(`[data-direction="${direction}"]`) as SVGRectElement

    return { onPick, half }
}

describe('PressBox', () => {
    it('reads a click on the left half as the foot landing', () => {
        const { onPick, half } = renderPress()

        fireEvent.click(half('down'))

        expect(onPick).toHaveBeenCalledWith(pedal, 'down')
    })

    it('reads a click on the right half as the foot lifting', () => {
        const { onPick, half } = renderPress()

        fireEvent.click(half('up'))

        expect(onPick).toHaveBeenCalledWith(pedal, 'up')
    })

    it('splits the press down the middle, so each edge has the half beside it', () => {
        const { half } = renderPress()

        expect(half('down').getAttribute('x')).toBe('1440')
        expect(half('down').getAttribute('width')).toBe('360')
        expect(half('up').getAttribute('x')).toBe('1800')
        expect(half('up').getAttribute('width')).toBe('360')
    })

    it('names the tick each half would write at', () => {
        const { half } = renderPress()

        expect(half('down').querySelector('title')?.textContent).toBe('down @1440')
        expect(half('up').querySelector('title')?.textContent).toBe('up @2160')
    })

    it('keeps both halves clickable where a press is too narrow to draw the arrows in', () => {
        const { half } = renderPress(vi.fn(), 8)

        expect(document.querySelectorAll('path')).toHaveLength(0)
        expect(half('down')).not.toBeNull()
        expect(half('up')).not.toBeNull()
    })

    it('marks the edge it would write at once a half is hovered', () => {
        const { half } = renderPress()
        const anchors = () =>
            [...document.querySelectorAll('line')].filter(
                line => line.getAttribute('stroke-width') === '3',
            )

        expect(anchors()).toHaveLength(0)

        fireEvent.mouseEnter(half('up'))

        expect(anchors().map(line => line.getAttribute('x1'))).toEqual(['2160'])
    })
})
