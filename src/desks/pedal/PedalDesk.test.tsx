import { beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Alignment, type AlignedNote, type AlignedPedal } from '../../fitting/alignment'
import { createMpm, requireMap, type Mpm } from '../../fitting/instructions/index'
import type { PedalResidual, Residual } from '../../fitting/residual'
import type { Normalized } from 'espressivo'
import { CallSelectionProvider } from '../../hooks/CallSelection'
import { EditingContext } from '../../hooks/Editing'
import type { CallOutcome } from '../../fitting/fit'
import { ScrollSyncProvider } from '../../hooks/ScrollSyncProvider'
import { ZoomContext } from '../../hooks/ZoomProvider'
import { DeskToolbarProvider } from '../../components/DeskToolbar'
import type { Call } from '../../model/Work'
import { PedalDesk } from './PedalDesk'

/**
 * An identity screen matrix, which jsdom has no notion of, as on the dynamics desk: with it a
 * client coordinate is a user coordinate, so a click is aimed at `date * 0.1` across and at its
 * lane's rail plus `position * 30` down.
 */
beforeAll(() => {
    const identity = { a: 1, inverse: () => identity }
    const proto = SVGSVGElement.prototype as unknown as {
        getScreenCTM: () => unknown
        createSVGPoint: () => unknown
    }
    proto.getScreenCTM = () => identity
    proto.createSVGPoint = () => {
        const point = { x: 0, y: 0, matrixTransform: () => ({ x: point.x, y: point.y }) }
        return point
    }
})

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
    /** The calls of the chain. */
    calls?: Call[]
}

const renderDesk = (
    pedals: readonly AlignedPedal[],
    mpm: Mpm,
    placed = pedals,
    { editable = true, outcomes = [], active = new Set<string>(), calls = [] }: Mode = {},
) => {
    const msm = new Alignment([note('n1', 0), note('n2', 720)])
    msm.pedals = [...pedals]
    const addTransformer = vi.fn()
    const removeCalls = vi.fn()

    // The app bar's second row, which the toolbar is portalled into.
    const bar = document.createElement('div')
    document.body.appendChild(bar)

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
                        calls={calls}
                        outcomes={outcomes}
                        activeCallIds={active}
                        setActiveCallIds={vi.fn()}
                        onRemoveCalls={removeCalls}
                        focusCall={vi.fn()}
                    >
                      <DeskToolbarProvider target={bar}>
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
                      </DeskToolbarProvider>
                    </CallSelectionProvider>
                </ScrollSyncProvider>
            </ZoomContext>
        </EditingContext>,
    )

    return Object.assign(addTransformer, { removeCalls })
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

    it('stacks the lanes sustain over soft, as the rows of presses above them', () => {
        // The reconstruction's MPM mentions soft first, and the lanes used to stack in that order
        // under rows that put sustain on top.
        renderDesk([pedal('sustain', 0), pedal('soft', 720)], withMovements('soft', 'sustain'))
        const top = (selector: string) =>
            Number(/translate\(0, (\d+)\)/.exec(
                document.querySelector(selector)?.getAttribute('transform') ?? '',
            )?.[1])

        expect(top('g.controller_sustain')).toBeLessThan(top('g.controller_soft'))
        expect(names().filter(name => name === 'sustain' || name === 'soft'))
            .toEqual(['sustain', 'soft', 'sustain', 'soft'])
    })

    it('draws each press as the line it recorded, at rest along the top of its row', () => {
        // 720 ticks at a tenth of a pixel each; a row thirty tall, with the stroke reaching its
        // floor. The first row starts eight below the top, so that its line at rest is not drawn
        // on the edge of the plot, half of it cut off.
        renderDesk([pedal('sustain', 0)], createMpm())

        expect(document.querySelector('polyline[data-line="sustain_0"]')?.getAttribute('points'))
            .toBe('0,8 0,38 72,38 72,8')
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

describe('PedalDesk, guiding a press', () => {
    /** The first lane's rail: the movement lanes start a hundred below the first row's top. */
    const RAIL = 108
    const at = (date: number, position: number) => ({ clientX: date * 0.1, clientY: RAIL + position * 30 })

    const guideMode = () => act(() => {
        screen.getByRole('button', { name: 'Guide' }).click()
    })
    const pick = (id: string) => fireEvent.click(document.querySelector(`[data-press="${id}"]`)!)
    const surface = () => document.querySelector('.draftGuides rect')!
    const drafted = () => [...document.querySelectorAll('[data-draft-guide]')].map(handle => [
        Number(handle.getAttribute('data-draft-guide')),
        Number(handle.getAttribute('cy')) / 30,
    ])
    const apply = () => act(() => {
        screen.getByRole('button', { name: 'Apply' }).click()
    })

    it('pencils guides into the lane of the press picked, and Apply writes the curve through them', () => {
        const addTransformer = renderDesk([pedal('sustain', 0), pedal('soft', 720)], createMpm())

        guideMode()
        pick('sustain_0')
        for (const [date, position] of [[-100, 0], [100, 1], [600, 1], [800, 0]] as const) {
            fireEvent.click(surface(), at(date, position))
        }
        expect(drafted()).toEqual([[-100, 0], [100, 1], [600, 1], [800, 0]])
        apply()

        expect(addTransformer).toHaveBeenCalledOnce()
        expect(addTransformer.mock.calls[0][0].options).toEqual({
            pedal: 'sustain_0',
            guides: new Map([[-100, 0], [100, 1], [600, 1], [800, 0]]),
        })
        expect(document.querySelector('.draftGuides')).toBeNull()
    })

    it('writes nothing on a click in Guide mode, which picks the press', () => {
        const addTransformer = renderDesk([pedal('sustain', 0)], createMpm())

        guideMode()
        pick('sustain_0')

        expect(addTransformer).not.toHaveBeenCalled()
        expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    })

    it('starts from the guides the press has, and Apply replaces the call that has them', () => {
        const guided: Call = {
            id: 'guided',
            name: 'InsertPedal',
            options: { pedal: 'sustain_0', guides: new Map([[0, 0], [90, 0.8], [700, 0]]) },
        }
        const desk = renderDesk([pedal('sustain', 0)], createMpm(), undefined, { calls: [guided] })

        guideMode()
        pick('sustain_0')
        expect(drafted()).toEqual([[0, 0], [90, 0.8], [700, 0]])
        apply()

        expect(desk.removeCalls).toHaveBeenCalledWith(['guided'])
        expect(desk).toHaveBeenCalledOnce()
    })

    it('starts a press that has no guides from where its movements turn', () => {
        // Down over 90 ticks, held, and up again from 600 to 700: what a trace or a ramp writes.
        const mpm = createMpm()
        const map = requireMap(mpm, 'movement', 'global')
        const move = (id: string, date: number, position: number, transitionTo?: number) =>
            map.addMovement({
                id: `sustain_0_${id}`,
                date,
                position: position as Normalized,
                ...(transitionTo !== undefined && { transitionTo: transitionTo as Normalized }),
                controller: 'sustain',
            })
        move('down', 0, 0, 1)
        move('held', 90, 1)
        move('up', 600, 1, 0)
        move('rest', 700, 0)
        renderDesk([pedal('sustain', 0)], mpm)

        guideMode()
        pick('sustain_0')

        expect(drafted()).toEqual([[0, 0], [90, 1], [600, 1], [700, 0]])
    })

    it('drags a guide to where it is to go, and Alt+Shift+click takes one away', () => {
        renderDesk([pedal('sustain', 0)], createMpm())

        guideMode()
        pick('sustain_0')
        fireEvent.click(surface(), at(0, 0))
        fireEvent.click(surface(), at(200, 1))
        const handle = document.querySelector<SVGCircleElement>('[data-draft-guide="200"]')!
        const svg = handle.ownerSVGElement!

        fireEvent.mouseDown(handle)
        fireEvent.mouseMove(svg, at(300, 0.5))
        fireEvent.mouseUp(svg)
        expect(drafted()).toEqual([[0, 0], [300, 0.5]])

        fireEvent.click(document.querySelector('[data-draft-guide="300"]')!, { altKey: true, shiftKey: true })
        expect(drafted()).toEqual([[0, 0]])
    })

    it('replaces the call a press had when its line is written in Trace mode too', () => {
        const ramp: Call = {
            id: 'ramp',
            name: 'InsertPedal',
            options: { pedal: 'sustain_0', start: -100, duration: 200, direction: 'down' },
        }
        const desk = renderDesk([pedal('sustain', 0)], createMpm(), undefined, { calls: [ramp] })

        pick('sustain_0')

        expect(desk.removeCalls).toHaveBeenCalledWith(['ramp'])
        expect(desk.mock.calls[0][0].options).toEqual({ pedal: 'sustain_0' })
    })

    it('draws the guides a call states on its lane, in the viewer too, and those of a selected call in its colour', () => {
        const guided: Call = {
            id: 'guided',
            name: 'InsertPedal',
            options: { pedal: 'sustain_0', guides: new Map([[0, 0], [100, 1]]) },
        }
        renderDesk([pedal('sustain', 0)], withMovements('sustain'), undefined, {
            editable: false,
            calls: [guided],
            active: new Set(['guided']),
        })

        const crosses = [...document.querySelectorAll('[data-guide]')]
        expect(crosses.map(cross => cross.getAttribute('data-guide'))).toEqual(['guided@0', 'guided@100'])
        expect(crosses.map(cross => [cross.getAttribute('x'), cross.getAttribute('y')])).toEqual([['0', '0'], ['10', '30']])
        expect(crosses[0]).toHaveAttribute('fill', 'orange')
    })
})
