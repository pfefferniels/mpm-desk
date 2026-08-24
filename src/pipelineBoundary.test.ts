import { describe, expect, it } from 'vitest'
import { MPM } from 'mpmify'
import type { AnyInstruction } from 'mpmify'

/**
 * `pipeline.worker.ts` hands its finished MPM to `usePipelineRunner` as source, and the
 * main thread parses it back. That indirection is not decoration: espressivo's document
 * is a live XML tree, which structured clone cannot carry, so the serialization *is* the
 * boundary. Everything the UI reads off an instruction has to survive it — above all
 * `xml:id`, which is how a transformer is matched to what it created, and `corresp`,
 * which carries the argumentation links.
 */

const SCOPE = 0

const instructions = [
    { type: 'tempo', 'xml:id': 't1', date: 0, bpm: 72, beatLength: 0.25, corresp: 'arg-1' },
    { type: 'tempo', 'xml:id': 't2', date: 1440, bpm: 60, beatLength: 0.25, 'transition.to': 80, meanTempoAt: 0.4, corresp: 'arg-1 arg-2' },
    { type: 'dynamics', 'xml:id': 'd1', date: 0, volume: 64, 'transition.to': 90, curvature: 0.3, protraction: -0.2, corresp: 'arg-3' },
    { type: 'rubato', 'xml:id': 'r1', date: 720, frameLength: 720, intensity: 1.2, lateStart: 0.1, earlyEnd: 0.9, loop: true, corresp: 'arg-4' },
    { type: 'articulation', 'xml:id': 'a1', date: 360, 'name.ref': 'staccato', noteid: '#n5', corresp: 'arg-5' },
    { type: 'asynchrony', 'xml:id': 'y1', date: 0, 'milliseconds.offset': -12.5, corresp: 'arg-6' },
    { type: 'movement', 'xml:id': 'm1', date: 0, position: 1, controller: 'sustain', 'transition.to': 0, corresp: 'arg-7' },
    { type: 'ornament', 'xml:id': 'o1', date: 2160, 'name.ref': 'arp', 'note.order': '#n1 #n2', scale: 1.5, corresp: 'arg-8' },
    { type: 'accentuationPattern', 'xml:id': 'p1i', date: 0, 'name.ref': 'p1', scale: 1, loop: true, corresp: 'arg-9' },
] as unknown as AnyInstruction[]

/** An MPM shaped like one the pipeline leaves behind: every map, plus header and metadata. */
const buildMPM = () => {
    const mpm = new MPM()

    mpm.insertDefinition({ type: 'articulationDef', name: 'staccato', relativeDuration: 0.5 }, SCOPE)
    mpm.insertDefinition({
        type: 'ornamentDef', name: 'arp',
        temporalSpread: {
            type: 'temporalSpread', 'frame.start': -300, frameLength: 600,
            'time.unit': 'milliseconds', 'noteoff.shift': false,
        },
    }, SCOPE)
    mpm.insertDefinition({
        type: 'accentuationPatternDef', name: 'p1', length: 4,
        children: [
            { type: 'accentuation', beat: 1, value: 8, 'transition.from': 8, 'transition.to': 8 },
            { type: 'accentuation', beat: 3, value: 4, 'transition.from': 4, 'transition.to': 4 },
        ],
    }, SCOPE)
    mpm.insertStyle({ type: 'style', 'xml:id': 'st1', date: 0, 'name.ref': 'performance_style' }, 'articulation', SCOPE)

    for (const instruction of instructions) mpm.insertInstruction(instruction, SCOPE)

    mpm.setMetadata([
        { type: 'author', number: 0, text: 'Niels Pfeffer' },
        { type: 'comment', text: 'boundary probe' },
    ])
    return mpm
}

/** Instructions as comparable plain records, in a stable order. */
const records = (mpm: MPM) => mpm.getInstructions()
    .map(instruction => ({ ...instruction }) as Record<string, unknown>)
    .sort((a, b) => String(a['xml:id']).localeCompare(String(b['xml:id'])))

describe('the worker/main-thread MPM boundary', () => {
    it('carries every instruction across unchanged', () => {
        const written = buildMPM()
        // structuredClone is what postMessage does to the payload.
        const read = MPM.parse(structuredClone(written.toXML()))

        expect(records(read)).toEqual(records(written))
    })

    it('keeps the xml:ids and corresp the UI matches transformers on', () => {
        const read = MPM.parse(buildMPM().toXML())

        const byId = new Map(read.getInstructions().map(i => [i['xml:id'], i]))
        for (const written of instructions) {
            const instruction = byId.get(written['xml:id'])
            expect(instruction, `no instruction for ${written['xml:id']}`).toBeDefined()
            expect(instruction!.corresp).toBe(written.corresp)
        }
    })

    it('carries the header and metadata across', () => {
        const written = buildMPM()
        const read = MPM.parse(written.toXML())

        for (const [type, name] of [
            ['articulationDef', 'staccato'],
            ['ornamentDef', 'arp'],
            ['accentuationPatternDef', 'p1'],
        ] as const) {
            expect({ ...read.getDefinition(type, name) }).toEqual({ ...written.getDefinition(type, name) })
        }
        expect(read.getStyles('articulation', SCOPE).map(s => ({ ...s })))
            .toEqual(written.getStyles('articulation', SCOPE).map(s => ({ ...s })))
        expect(read.toXML()).toContain('Niels Pfeffer')
    })

    it('is a fixed point, so a second run cannot drift from the first', () => {
        const once = buildMPM().toXML()
        expect(MPM.parse(once).toXML()).toBe(once)
    })
})
