import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { Alignment, type AlignedNote, type AlignedPedal } from '../../fitting/alignment'
import { createMpm, requireMap, type Mpm } from '../../fitting/instructions/index'
import type { PedalResidual, Residual } from '../../fitting/residual'
import type { Normalized } from 'espressivo'
import { CallSelectionProvider } from '../../hooks/CallSelection'
import { EditingContext } from '../../hooks/Editing'
import type { CallOutcome } from '../../fitting/fit'
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

/** A switch, a second long. */
const pedal = (type: AlignedPedal['type'], onsetMs: number): AlignedPedal => ({
    'xml:id': `${type}_${onsetMs}`,
    type,
    'milliseconds.date': onsetMs,
    'milliseconds.date.end': onsetMs + 1000,
})

/**
 * A residual that places every pedal it is given and no other.
 *
 * The desk asks it one thing — where a recorded press's line falls on the tick grid — so a stub
 * answering that one question is the whole of what a test needs, and deriving a real one would
 * take a `<tempo>` written for the purpose. A tick to the millisecond, so a switch a second long
 * is 720 ticks of it.
 */
const placing = (placed: readonly AlignedPedal[]): Residual => {
    const byPedal = new Map<string, PedalResidual>(
        placed.map(pedal => {
            const tickDate = pedal['milliseconds.date']
            return [
                pedal['xml:id'],
                {
                    pedal,
                    tickDate,
                    tickDuration: 720,
                    tickTravel: [
                        { date: tickDate, ms: 0, position: 1 },
                        { date: tickDate + 720, ms: 1000, position: 0 },
                    ],
                },
            ]
        }),
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

interface Mode {
    editable?: boolean
    /** What the fit reported, and which calls are selected. */
    outcomes?: CallOutcome[]
    active?: Set<string>
}

const renderDesk = (
    pedals: readonly AlignedPedal[],
    mpm: Mpm,
    placed = pedals,
    { editable = true, outcomes = [], active = new Set<string>() }: Mode = {},
) => {
    const msm = new Alignment([note('n1', 0), note('n2', 720)])
    msm.pedals = [...pedals]
    const addTransformer = vi.fn()

    render(
        <EditingContext value={editable}>
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
                        outcomes={outcomes}
                        activeCallIds={active}
                        setActiveCallIds={vi.fn()}
                        onRemoveCalls={vi.fn()}
                        focusCall={vi.fn()}
                    >
                        <PedalDesk
                            part='global'
                            msm={msm}
                            mpm={mpm}
                            residual={placing(placed)}
                            performanceXml=''
                            secondary={{}}
                            setSecondary={vi.fn()}
                            addTransformer={addTransformer}
                        />
                    </CallSelectionProvider>
                </ScrollSyncProvider>
            </ZoomContext>
        </EditingContext>,
    )

    return addTransformer
}

/** Everything the plot and its gutter have written, which is one name per row and lane. */
const names = () => [...document.querySelectorAll('text')].map(text => text.textContent)

describe('PedalDesk', () => {
    it('names the row of every press it draws', () => {
        renderDesk([pedal('sustain', 0), pedal('soft', 720)], createMpm())

        expect(names()).toContain('sustain')
        expect(names()).toContain('soft')
    })

    it('names no row for a press the residual cannot place', () => {
        renderDesk([pedal('sustain', 0), pedal('soft', 720)], createMpm(), [pedal('sustain', 0)])

        expect(names()).toContain('sustain')
        expect(names()).not.toContain('soft')
    })

    it('names each controller the MPM has movements for', () => {
        renderDesk([], withMovements('sustain', 'soft'))

        expect(names()).toEqual(expect.arrayContaining(['sustain', 'soft', 'ticks']))
    })

    it('draws each press as the line it recorded, at rest along the top of its row', () => {
        // 720 ticks at a tenth of a pixel each; a row thirty tall, with the stroke reaching its floor.
        renderDesk([pedal('sustain', 0)], createMpm())

        expect(document.querySelector('polyline[data-line="sustain_0"]')?.getAttribute('points'))
            .toBe('0,0 0,30 72,30 72,0')
    })

    it('writes the line of the press that was clicked, and nothing else', () => {
        const addTransformer = renderDesk([pedal('sustain', 0), pedal('soft', 720)], createMpm())

        fireEvent.click(document.querySelector('[data-press="sustain_0"]')!)

        expect(addTransformer).toHaveBeenCalledOnce()
        expect(addTransformer.mock.calls[0][0].options).toEqual({ pedal: 'sustain_0' })
    })

    // A movement lasts until the next one; the last of a lane used to be dropped (issue #33).
    it('holds the last movement of a lane to the end of the piece', () => {
        renderDesk([], withMovements('sustain'))

        expect(document.querySelectorAll('g.movementSegment')).toHaveLength(2)
    })

    it('keeps the names out of the scroller, so they hold still', () => {
        renderDesk([pedal('sustain', 0)], withMovements('sustain'))
        const scroller = document.querySelector('[style*="overflow-x"]')

        expect(scroller).not.toBeNull()
        expect([...scroller!.querySelectorAll('text')].map(text => text.textContent))
            .not.toContain('sustain')
    })

    it('writes nothing on a click in the viewer, where a press is no target', () => {
        const addTransformer = renderDesk([pedal('sustain', 0)], createMpm(), undefined, {
            editable: false,
        })
        const press = document.querySelector('[data-press="sustain_0"]')!

        fireEvent.click(press)

        expect(addTransformer).not.toHaveBeenCalled()
        expect(press).not.toHaveStyle({ cursor: 'pointer' })
    })

    it('marks the press a selected call was fitted to, in the editor and the viewer', () => {
        for (const editable of [true, false]) {
            renderDesk([pedal('sustain', 0), pedal('soft', 720)], createMpm(), undefined, {
                editable,
                outcomes: [
                    { id: 'pedal call', elements: [], range: { from: 0, to: 720 }, evidence: ['sustain_0'] },
                ],
                active: new Set(['pedal call']),
            })

            expect([...document.querySelectorAll('g.pedalPress[data-evidence]')].map(press =>
                press.getAttribute('data-id'),
            )).toEqual(['pedalPress_sustain_0'])
            cleanup()
        }
    })

    it('marks no press with no call selected', () => {
        renderDesk([pedal('sustain', 0)], createMpm())
        expect(document.querySelectorAll('[data-evidence]')).toHaveLength(0)
    })
})
