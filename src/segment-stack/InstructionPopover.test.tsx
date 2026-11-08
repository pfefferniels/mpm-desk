/**
 * The card a sign in the score band opens: the one instruction the sign stands for, encoded
 * exactly as the performance has it, and nothing of the segment around it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { readPerformance, type Instruction } from '../utils/mpm'
import { readMeter } from '../utils/score'
import { InstructionPopover } from './InstructionPopover'
import { encodingOf } from './encoding'
import { publishedPath } from '../test/published'
import { readScoreNotes } from './band/bandMei'

// The published performance rather than the fixture: only it switches the articulation style in,
// so only there do articulations name a definition that resolves.
const msm = readFileSync(publishedPath('score'), 'utf-8')
const mpm = readPerformance(readFileSync(publishedPath('performance'), 'utf-8'), readMeter(msm))
const notes = readScoreNotes(msm)

const firstOfType = (type: string): Instruction => {
    const instruction = mpm.instructions.find(i => i.type === type)
    if (!instruction) throw new Error(`no ${type} in the published performance`)
    return instruction
}

/** Open the card for one sign and hand back what it says. */
const cardFor = async (instruction: Instruction) => {
    const anchor = document.createElement('span')
    const container = document.createElement('div')
    document.body.append(anchor, container)
    const root = createRoot(container)
    try {
        await act(async () => {
            root.render(
                <InstructionPopover mpm={mpm} activeSpanIds={new Set()} svg={null} focus={{ elementId: instruction.id, anchor }} notes={notes} />,
            )
        })
        const card = [...document.querySelectorAll('.MuiPopper-root')].at(-1)
        return {
            text: card?.textContent ?? '',
            chart: card?.querySelector('polyline') ?? null,
            figure: card?.querySelector('svg[role="img"]') ?? null,
            dots: card?.querySelectorAll('circle').length ?? 0,
        }
    } finally {
        await act(async () => { root.unmount() })
        anchor.remove()
        container.remove()
    }
}

describe('the card a sign opens', () => {
    it('shows a hairpin’s <dynamics> alone: its chart and its exact encoding, no neighbour', async () => {
        const dynamics = firstOfType('dynamics')
        const { text, chart } = await cardFor(dynamics)
        expect(chart).not.toBeNull()
        expect(text).toContain(`xml:id="${dynamics.id}"`)
        expect(text).toContain(`date="${String(dynamics.date)}"`)
        for (const other of mpm.ofType('dynamics').filter(d => d.id !== dynamics.id)) {
            expect(text).not.toContain(`"${other.id}"`)
        }
    })

    it('draws a rubato’s frame as written and as played, and says how it lingers', async () => {
        const { text, figure } = await cardFor(mpm.byId('rubato_2880')!)
        expect(figure).not.toBeNull()
        expect(text).toContain('long–short')
        // the two halves of the frame, as written and as played
        expect(text).toContain('50 %')
        expect(text).toContain('54 %')
        expect(text).toContain('xml:id="rubato_2880"')
    })

    it('draws a rolled chord note by note', async () => {
        const ornament = mpm.byId('ornament_4320')!
        // The gradient's scale is fitted to the velocities, so it is read off the ornament; the
        // card gives it in whole velocity steps.
        const scale = Math.round(Number(ornament.element.getAttributeValue('scale')))
        const { text, dots } = await cardFor(ornament)
        expect(dots).toBe(4)
        expect(text).toContain('upwards · before the beat')
        expect(text).toContain(`velocity −${String(scale)} → 0`)
        expect(text).toContain('<ornamentDef ')
    })

    it('quotes an articulation exactly, under its chart, with the definition it names', async () => {
        const articulation = mpm.ofType('articulation').find(i => mpm.defFor(i) !== null)
        if (!articulation) throw new Error('no articulation with a definition in the published performance')
        const { text, figure } = await cardFor(articulation)
        expect(figure).not.toBeNull()
        expect(text).toContain('<articulation ')
        expect(text).toContain(`xml:id="${articulation.id}"`)
        expect(text).toContain('<articulationDef ')
    })
})

describe('an encoding, quoted', () => {
    it('keeps every attribute as written, drops the re-declared namespace, and indents children', () => {
        const quoted = encodingOf(
            '<ornamentDef xmlns="http://www.cemfi.de/mpm/ns/1.0" name="a"><temporalSpread frame.start="-93.4398" frameLength="93.4384"/></ornamentDef>',
        )
        expect(quoted).toBe(
            '<ornamentDef name="a">\n  <temporalSpread frame.start="-93.4398" frameLength="93.4384"/>\n</ornamentDef>',
        )
    })
})
