/**
 * The two instruction charts, over the MPM the app actually ships.
 *
 * These draw from espressivo's resolved records rather than deriving spans themselves, so
 * what is worth pinning is the whole path: a segment's element id ⇒ the reader ⇒ a resolved
 * neighbourhood ⇒ a polyline with points on it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { readPerformance, type Instruction } from '../utils/mpm'
import { readMeter } from '../utils/score'
import { TempoInstructionView } from './TempoInstructionView'
import { DynamicsInstructionView } from './DynamicsInstructionView'

const mpm = readPerformance(
    readFileSync('src/test/fixtures/performance.mpm', 'utf-8'),
    readMeter(readFileSync('src/test/fixtures/score.msm', 'utf-8')),
)

const render = async (node: React.ReactNode) => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(node) })
    return { container, cleanup: () => act(() => { root.unmount() }) }
}

const firstOfType = (type: string): Instruction => {
    const instruction = mpm.instructions.find(i => i.type === type)
    if (!instruction) throw new Error(`no ${type} in public/performance.mpm`)
    return instruction
}

describe('instruction charts over the shipped performance', () => {
    it('draws a tempo curve with a real polyline', async () => {
        const tempi = mpm.tempoAround(firstOfType('tempo'))
        expect(tempi).not.toBeNull()

        const { container, cleanup } = await render(
            <TempoInstructionView tempi={tempi!} meter={mpm.meter} />
        )
        const points = container.querySelector('polyline')?.getAttribute('points')
        expect(points?.split(' ').length).toBeGreaterThan(10)
        // Every sampled bpm must be a finite number, not a NaN dragged in from an
        // unresolvable @meanTempoAt.
        expect(points).not.toMatch(/NaN/)
        cleanup()
    })

    it('draws a dynamics curve with a real polyline', async () => {
        const dynamics = mpm.dynamicsAround(firstOfType('dynamics'))
        expect(dynamics).not.toBeNull()

        const { container, cleanup } = await render(
            <DynamicsInstructionView dynamics={dynamics!} meter={mpm.meter} />
        )
        const points = container.querySelector('polyline')?.getAttribute('points')
        expect(points?.split(' ').length).toBeGreaterThan(10)
        expect(points).not.toMatch(/NaN/)
        cleanup()
    })

    it('finds every <accentuationPattern>, which is what mpm-ts could not', async () => {
        // mpm-ts's getInstructions() returned 0 of the 51 in this document, so clicking one
        // opened an empty popover and the playback follow never lit those segments.
        const patterns = mpm.instructions.filter(i => i.type === 'accentuationPattern')
        expect(patterns.length).toBe(51)

        // Each is in force at its own date, and the next one bounds it — the half of
        // espressivo's coverage rule that a length-only test would miss.
        const [first, second] = patterns
        expect(mpm.effectiveAt(first.date, 'accentuationPattern').map(i => i.id)).toContain(first.id)
        const atSecond = mpm.effectiveAt(second.date, 'accentuationPattern').map(i => i.id)
        expect(atSecond).toContain(second.id)
        expect(atSecond).not.toContain(first.id)
    })
})
