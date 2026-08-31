import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { Alignment, type AlignedNote, type AlignedPedal } from '../../fitting/alignment'
import { createMpm, requireMap, type Mpm } from '../../fitting/instructions/index'
import type { PedalResidual, Residual } from '../../fitting/residual'
import type { Normalized } from 'espressivo'
import { CallSelectionProvider } from '../../hooks/CallSelection'
import { ScrollSyncProvider } from '../../hooks/ScrollSyncProvider'
import { ZoomContext } from '../../hooks/ZoomProvider'
import { PedalDesk } from './PedalDesk'

/** The chord lines sound a chord on hover, and Tone in jsdom is a slow way to assert nothing. */
vi.mock('react-pianosound', () => ({
    usePiano: () => ({ play: vi.fn(), stop: vi.fn() }),
}))

const note = (id: string, date: number): AlignedNote => ({
    'xml:id': id,
    part: 1,
    staff: '1',
    layer: '1',
    date,
    duration: 720,
    pitchname: 'c',
    accidentals: 0,
    octave: 4,
    'milliseconds.date': date,
    'milliseconds.date.end': date + 500,
    'midi.pitch': 60,
    velocity: 64,
})

const pedal = (type: AlignedPedal['type'], onsetMs: number): AlignedPedal => ({
    'xml:id': `${type}_${onsetMs}`,
    type,
    'milliseconds.date': onsetMs,
    'milliseconds.date.end': onsetMs + 1000,
})

/**
 * A residual that places every pedal it is given and no other.
 *
 * The desk asks it one thing — where a recorded press falls on the tick grid — so a stub answering
 * that one question is the whole of what a test needs, and deriving a real one would take a
 * `<tempo>` written for the purpose.
 */
const placing = (placed: readonly AlignedPedal[]): Residual => {
    const byPedal = new Map<string, PedalResidual>(
        placed.map(pedal => [
            pedal['xml:id'],
            { pedal, tickDate: pedal['milliseconds.date'], tickDuration: 720 },
        ]),
    )

    return {
        of: () => undefined,
        ofPedal: pedal => byPedal.get(pedal['xml:id']),
        notes: [],
        pedals: [...byPedal.values()],
    }
}

/** An MPM carrying one movement per controller named, which is a lane each on the desk. */
const withMovements = (...controllers: string[]): Mpm => {
    const mpm = createMpm()
    const map = requireMap(mpm, 'movement', 'global')

    controllers.forEach((controller, index) => {
        map.addMovement({
            id: `${controller}_down`,
            date: index * 720,
            position: 0 as Normalized,
            transitionTo: 1 as Normalized,
            controller,
        })
        map.addMovement({
            id: `${controller}_held`,
            date: index * 720 + 90,
            position: 1 as Normalized,
            controller,
        })
    })

    return mpm
}

const renderDesk = (pedals: readonly AlignedPedal[], mpm: Mpm, placed = pedals) => {
    const msm = new Alignment([note('n1', 0), note('n2', 720)])
    msm.pedals = [...pedals]

    render(
        <ZoomContext
            value={{ symbolic: { stretchX: 0.1 }, physical: { stretchX: 20 }, setStretchX: vi.fn() }}
        >
            <ScrollSyncProvider
                symbolicZoom={0.1}
                physicalZoom={20}
                tickToSeconds={tick => tick / 1440}
                secondsToTick={seconds => seconds * 1440}
            >
                <CallSelectionProvider
                    calls={[]}
                    outcomes={[]}
                    activeCallIds={new Set()}
                    setActiveCallIds={vi.fn()}
                    onRemoveCalls={vi.fn()}
                    focusCall={vi.fn()}
                >
                    <PedalDesk
                        part='global'
                        msm={msm}
                        mpm={mpm}
                        residual={placing(placed)}
                        projected={[]}
                        performanceXml=''
                        secondary={{}}
                        setSecondary={vi.fn()}
                        addTransformer={vi.fn()}
                    />
                </CallSelectionProvider>
            </ScrollSyncProvider>
        </ZoomContext>,
    )

    return [...document.querySelectorAll('text')].map(text => text.textContent)
}

describe('PedalDesk', () => {
    it('names the row of every press it draws', () => {
        const names = renderDesk([pedal('sustain', 0), pedal('soft', 720)], createMpm())

        expect(names).toContain('sustain')
        expect(names).toContain('soft')
    })

    it('names no row for a press the residual cannot place', () => {
        const names = renderDesk([pedal('sustain', 0), pedal('soft', 720)], createMpm(), [
            pedal('sustain', 0),
        ])

        expect(names).toContain('sustain')
        expect(names).not.toContain('soft')
    })

    it('names each controller the MPM has movements for', () => {
        const names = renderDesk([], withMovements('sustain', 'soft'))

        expect(names).toEqual(expect.arrayContaining(['sustain', 'soft', 'ticks']))
    })

    it('keeps the names out of the scroller, so they hold still', () => {
        renderDesk([pedal('sustain', 0)], withMovements('sustain'))
        const scroller = document.querySelector('[style*="overflow-x"]')

        expect(scroller).not.toBeNull()
        expect([...scroller!.querySelectorAll('text')].map(text => text.textContent))
            .not.toContain('sustain')
    })
})
