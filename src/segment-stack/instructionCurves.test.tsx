/**
 * The timeline's curves, over the MPM the app actually ships.
 *
 * These draw from espressivo's resolved records rather than deriving anything themselves,
 * so what is worth pinning is the whole path: a segment's tick range ⇒ the reader ⇒ a lane
 * of instructions ⇒ points that say what that lane does there. Plus the pane underneath,
 * which is the same path arriving at words instead of at a shape.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { readPerformance } from '../utils/mpm'
import { readMeter } from '../utils/score'
import { dynamicsCurve, pedalCurve, tempoCurve } from './instructionCurves'
import { InstructionAttributes } from './InstructionAttributes'
import { SegmentTimelinePopover } from './SegmentTimeline'
import { pointSpanFallback, tickRange } from './StackModel'
import type { Reconstruction, Segment } from '../model/Reconstruction'

const mpm = readPerformance(
    readFileSync('src/test/fixtures/performance.mpm', 'utf-8'),
    readMeter(readFileSync('src/test/fixtures/score.msm', 'utf-8')),
)
const { segments } = JSON.parse(readFileSync('src/test/fixtures/segments.json', 'utf-8')) as Reconstruction
const minPointSpan = pointSpanFallback(segments)

const rangeOf = (segment: Segment) => tickRange(segment, minPointSpan)
const byId = (id: string) => {
    const segment = segments.find(s => s.id === id)
    if (!segment) throw new Error(`no segment ${id} in public/segments.json`)
    return segment
}

const render = async (node: React.ReactNode) => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(node) })
    return { container, cleanup: () => act(() => { root.unmount() }) }
}

describe('the curves the timeline draws', () => {
    it('opens a lane on the value the window itself starts with', () => {
        // REGRESSION: an instruction handing over exactly where the window opens used to
        // contribute a zero-width stretch at the left edge, so the first point — and with it
        // the endpoint label — read the value of the gesture *before* the segment.
        // `tempo_5760` starts at 5760 with @bpm 64.15; the segment starts there too.
        const { from, to } = rangeOf(byId('018ee72f-65e0-4cc7-bb81-2b0c050ab60d'))
        expect(from).toBe(5760)
        const points = tempoCurve(mpm, from, to)
        expect(points[0].tick).toBe(from)
        expect(points[0].value).toBeCloseTo(64.15, 1)
    })

    it('falls where the instruction says it falls', () => {
        // @bpm 64.15 → @transition.to 40.15 over 5760..7200, and only then the next one.
        const points = tempoCurve(mpm, 5760, 7200)
        expect(points[points.length - 1].value).toBeCloseTo(40.15, 1)
        expect(Math.min(...points.map(p => p.value))).toBeCloseTo(40.15, 1)
    })

    it('holds a pedal down between the movement that presses it and the one that lifts it', () => {
        // sustain-6840: down at 6840ish, up again at 6986 → 7426.
        const { from, to } = rangeOf(byId('018ee72f-65e0-4cc7-bb81-2b0c050ab60d'))
        const points = pedalCurve(mpm, 'sustain', from, to)
        expect(points.length).toBeGreaterThan(10)
        // A position is a position: never off the 0..1 dial, whatever the Bézier does.
        for (const point of points) {
            expect(point.value).toBeGreaterThanOrEqual(0)
            expect(point.value).toBeLessThanOrEqual(1)
        }
        // It both presses and releases inside this segment.
        expect(Math.max(...points.map(p => p.value))).toBeGreaterThan(0.5)
        expect(points[points.length - 1].value).toBeCloseTo(0, 5)
    })

    it('says nothing about a controller no instruction has touched yet', () => {
        // The first segment presses the soft pedal at tick -100; the sustain pedal's first
        // `<movement>` is at 700. Over that window sustain has no value to hold, and an
        // empty lane is the honest answer — not a curve at zero.
        const { from, to } = rangeOf(byId('821fda57-7ea5-4a05-ab4f-2b221a141996'))
        expect(pedalCurve(mpm, 'soft', from, to).length).toBeGreaterThan(1)
        expect(pedalCurve(mpm, 'sustain', from, to)).toEqual([])
    })

    it('draws every lane every segment claims, over the whole corpus, without a NaN', () => {
        for (const segment of segments) {
            const { from, to } = rangeOf(segment)
            const claimed = new Set(segment.spans.map(span => span.type))
            const lanes = [
                claimed.has('tempo') && tempoCurve(mpm, from, to),
                claimed.has('dynamics') && dynamicsCurve(mpm, from, to),
                ...['sustain', 'soft'].map(controller =>
                    segment.spans.some(span =>
                        span.type === 'movement' &&
                        span.elements.some(id => {
                            const instruction = mpm.byId(id)
                            return instruction !== undefined &&
                                (instruction.element.getAttributeValue('controller') ?? 'sustain') === controller
                        })) && pedalCurve(mpm, controller, from, to)),
            ]
            for (const points of lanes) {
                if (points === false) continue
                // Two points or there is no line to draw, and the row would fall back to bars.
                expect(points.length, segment.id).toBeGreaterThan(1)
                for (const point of points) {
                    expect(Number.isFinite(point.value), `${segment.id} @${point.tick}`).toBe(true)
                    expect(point.tick).toBeGreaterThanOrEqual(from)
                    expect(point.tick).toBeLessThanOrEqual(to)
                }
            }
        }
    })
})

describe('the pane that says what a gesture is made of', () => {
    it('keeps what shapes the sound and drops the bookkeeping', async () => {
        const { container, cleanup } = await render(
            <InstructionAttributes elements={['tempo_5760']} mpm={mpm} />
        )
        const text = container.textContent ?? ''
        expect(text).toContain('tempo')
        expect(text).toContain('bpm="64.151"')
        expect(text).toContain('transition.to="40.15"')
        expect(text).toContain('meanTempoAt="0.356"')
        // The row already draws where the gesture is, and who claims it is the open word.
        expect(text).not.toContain('date=')
        expect(text).not.toContain('endDate=')
        expect(text).not.toContain('corresp=')
        expect(text).not.toContain('xml:id=')
        // And no float tails: `0.356328125` is arithmetic, not a measurement.
        expect(text).not.toMatch(/\d\.\d{4,}/)
        cleanup()
    })

    it('follows a @name.ref to the def it names', async () => {
        const pattern = mpm.instructions.find(i => i.type === 'accentuationPattern')!
        expect(mpm.defFor(pattern)).not.toBeNull()

        const { container, cleanup } = await render(
            <InstructionAttributes elements={[pattern.id]} mpm={mpm} />
        )
        const text = container.textContent ?? ''
        expect(text).toContain('accentuationPatternDef')
        // The def's own children come with it — a pattern is its accentuations.
        expect(text).toContain('accentuation')
        expect(text).toContain('beat=')
        cleanup()
    })

    it('says nothing extra for a gesture that names no def', async () => {
        const { container, cleanup } = await render(
            <InstructionAttributes elements={['tempo_5760']} mpm={mpm} />
        )
        // @bpm here is a number, not the name of a tempoDef, so there is nothing to follow.
        expect(container.textContent).not.toContain('Def')
        cleanup()
    })

    it('shows every element a gesture is made of, not only the first', async () => {
        // A pedal release is two `<movement>`s: the one that starts lifting and the one
        // that says it has arrived.
        const span = byId('018ee72f-65e0-4cc7-bb81-2b0c050ab60d')
            .spans.find(s => s.elements.length > 1)!
        const { container, cleanup } = await render(
            <InstructionAttributes elements={span.elements} mpm={mpm} />
        )
        const text = container.textContent ?? ''
        expect(text.match(/movement/g)?.length).toBe(span.elements.length)
        cleanup()
    })
})

describe('the shape of a row', () => {
    /**
     * The card, over one segment, opened. `SegmentTimelinePopover` is what owns the
     * hover state and the pane, so the assertions below have to go through it rather
     * than through the row component.
     */
    // The card portals to the body, so a test that ended early would otherwise leave one
    // behind for the next test to count.
    afterEach(() => { document.body.replaceChildren() })

    const openCard = async (segment: Segment) => {
        const anchorEl = { getBoundingClientRect: () => new DOMRect(0, 0, 0, 0) }
        const { container, cleanup } = await render(
            <SegmentTimelinePopover
                segments={[segment]}
                mpm={mpm}
                anchorEl={anchorEl}
                placement="top"
                minPointSpan={minPointSpan}
                interactive
            />
        )
        return { container: document.body, cleanup, root: container }
    }

    /** `M0,1L2,3Z` → `[[0,1],[2,3]]`. */
    const pointsOf = (d: string) =>
        d.replace(/Z$/, '').split(/[ML]/).filter(Boolean)
            .map(pair => pair.split(',').map(Number))

    it('hangs the pedal from the top, because a pedal is pressed down', async () => {
        // The segment that lifts the soft pedal, which both presses and releases in view.
        const { container, cleanup } = await openCard(byId('018ee72f-65e0-4cc7-bb81-2b0c050ab60d'))

        const stroke = container.querySelector('path[stroke="#475569"]')!.getAttribute('d')!
        const area = container.querySelector('path[fill="#475569"]')!.getAttribute('d')!
        const lineYs = pointsOf(stroke).map(p => p[1])
        const baseY = pointsOf(area).at(-1)![1]

        // The shading closes at or above every point of the curve — it hangs from the
        // released position and grows downwards. Anchored at the row's floor instead (as a
        // rising-is-pressing picture would be) this would be the largest y, not the least.
        expect(baseY).toBeLessThanOrEqual(Math.min(...lineYs))
        cleanup()
    })

    it('offers the pointer only the gestures that have no drawing yet', async () => {
        const segment = byId('018ee72f-65e0-4cc7-bb81-2b0c050ab60d')
        const { container, cleanup } = await openCard(segment)

        // One hit target per span, minus the ones on a lane that draws itself.
        const drawn = new Set(['tempo', 'dynamics', 'movement'])
        const expected = segment.spans.filter(span => !drawn.has(span.type)).length
        expect(container.querySelectorAll('rect[fill="transparent"]').length).toBe(expected)
        expect(expected).toBeGreaterThan(0)
        cleanup()
    })

    it('says nothing at all until a gesture is pointed at', async () => {
        const { container, cleanup } = await openCard(byId('018ee72f-65e0-4cc7-bb81-2b0c050ab60d'))
        // No placeholder, no reserved box: the pane exists only while it has something in it.
        expect(container.textContent).not.toContain('name.ref')
        expect(container.querySelectorAll('.MuiPaper-root').length).toBe(1)
        cleanup()
    })
})
