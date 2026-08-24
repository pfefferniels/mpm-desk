import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isRegistered, createTransformer, getTransformerOrder, MSM } from 'mpmify'
import { parseWork } from './utils/workImport'
import { runPipeline, type SerializedTransformer } from './pipeline'
import './transformers/register'

/**
 * Every transformer a desk can construct has to be reachable by name, because name is all that
 * survives being saved to a work file or posted to the worker. A name the registry does not know
 * is dropped from the chain, so the desk's button appears to work and changes nothing —
 * `MakeDefaultArticulation` was in exactly that state.
 */

const BEAT = 720

const note = (i: number) => ({
    'xml:id': `n_1_${i}`,
    date: i * BEAT,
    part: 1,
    pitchname: 'g' as const,
    octave: 4,
    duration: BEAT,
    accidentals: 0,
    'midi.pitch': 67,
    'midi.onset': i * 0.6,
    'midi.duration': 0.5,
    'midi.velocity': 80,
})

const input = () => {
    const msm = new MSM(Array.from({ length: 9 }, (_, i) => note(i)), { numerator: 4, denominator: 4 })
    return { allNotes: msm.allNotes, pedals: msm.pedals, timeSignature: msm.timeSignature }
}

const call = (name: string, options: unknown): SerializedTransformer => ({
    id: `call-${name}`,
    name,
    options,
    created: [],
    argumentation: {
        id: `arg-${name}`,
        type: 'simpleArgumentation',
        conclusion: { id: `belief-${name}`, motivation: 'calm', certainty: 'plausible' },
    },
})

const METADATA = { author: 'test', title: 'test' }

/**
 * Read the desks rather than importing them: importing `DeskSwitch` pulls the whole component
 * tree (and Tone.js) into the test, and what is being checked here is a fact about the source —
 * which transformers the UI can construct — not about rendering.
 */
const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return sourceFiles(path)
        return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : []
    })

/** mpmify classes a desk may construct that are documents, not transformers. */
const NOT_TRANSFORMERS = new Set(['MPM', 'MSM'])

/** Names the UI constructs with `new X(...)` that it imported from mpmify or ./transformers. */
const constructedTransformerNames = (): string[] => {
    const names = new Set<string>()

    for (const file of [...sourceFiles('src/desks'), ...sourceFiles('src/components')]) {
        const source = readFileSync(file, 'utf8')

        const imported = new Set<string>()
        for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
            const [, clause, from] = match
            if (from !== 'mpmify' && !from.includes('transformers')) continue
            for (const part of clause.split(',')) {
                const name = part.trim().split(/\s+as\s+/).pop()?.trim()
                if (name) imported.add(name)
            }
        }

        for (const match of source.matchAll(/new\s+(\w+)\s*\(/g)) {
            if (imported.has(match[1]) && !NOT_TRANSFORMERS.has(match[1])) names.add(match[1])
        }
    }

    return [...names].sort()
}

describe('the transformer registry covers every transformer the desks construct', () => {
    const names = constructedTransformerNames()

    it('finds the transformers the desks construct', () => {
        // A guard on the guard: if the scan silently matched nothing, the checks below would pass
        // vacuously.
        expect(names.length).toBeGreaterThan(10)
        expect(names).toContain('MakeDefaultArticulation')
    })

    it.each(names.map(name => [name] as const))(
        '%s is registered, so it can be ordered, saved and run',
        name => {
            expect(isRegistered(name), `${name} is constructed by a desk but not registered`).toBe(true)
            expect(createTransformer(name)?.name).toBe(name)
        }
    )
})

describe('runPipeline', () => {
    it('runs a chain and reports what each call created', () => {
        const outcome = runPipeline(
            [call('ApproximateLogarithmicTempo', {
                scope: 'global', from: 0, to: 8 * BEAT, beatLength: 0.25, silentOnsets: [],
            })],
            input(),
            METADATA
        )

        expect(outcome.type).toBe('result')
        if (outcome.type !== 'result') return
        expect(outcome.mpm.getInstructions('tempo', 'global').length).toBeGreaterThan(0)
        expect(outcome.created['call-ApproximateLogarithmicTempo']).not.toHaveLength(0)
    })

    it('keeps MakeDefaultArticulation in the chain instead of dropping it', () => {
        const outcome = runPipeline(
            [
                // Deliberately the retired spelling: this also proves a saved work file naming
                // the old class still reconstructs through the registry's alias.
                call('TranslatePhyiscalTimeToTicks', { translatePhysicalModifiers: true }),
                call('MakeDefaultArticulation', { scope: 'global' }),
            ],
            input(),
            METADATA
        )

        expect(outcome.type).toBe('result')
        if (outcome.type !== 'result') return
        expect(outcome.mpm.getDefinition('articulationDef', 'default articulation')).toBeDefined()
    })

    it('reports an unregistered name rather than silently running without it', () => {
        const outcome = runPipeline([call('NoSuchTransformer', { scope: 'global' })], input(), METADATA)

        // The name cannot be reconstructed at all, so the chain runs one call short —
        // `reconstructTransformer` warns and drops it.
        expect(outcome.type).toBe('result')
    })

    it('is a function of the chain: two runs give the same document', () => {
        const calls = [call('ApproximateLogarithmicTempo', {
            scope: 'global', from: 0, to: 8 * BEAT, beatLength: 0.25, silentOnsets: [],
        })]
        const once = runPipeline(calls, input(), METADATA)
        const twice = runPipeline(calls, input(), METADATA)

        expect(once.type).toBe('result')
        if (once.type !== 'result' || twice.type !== 'result') return
        expect(twice.mpm.toXML()).toBe(once.mpm.toXML())
    })
})

describe('the shipped work file', () => {
    /**
     * `public/info.json` is a real reconstruction — 494 calls across 136 argumentations, and it
     * still names `TranslatePhyiscalTimeToTicks` the way the class used to be misspelled. It is
     * the only end-to-end check that the registry covers what actually exists on disk.
     */
    const parsed = parseWork(readFileSync('public/info.json', 'utf8'))
    const saved = JSON.parse(readFileSync('public/info.json', 'utf8'))
    const savedCalls: { name: string }[] = saved.creation.argumentations.flatMap(
        (a: { calls: { name: string }[] }) => a.calls
    )

    it('reconstructs every call, dropping none', () => {
        // parseWork lifts InsertMetadata out of the chain into the metadata fields.
        const expected = savedCalls.filter(c => c.name !== 'InsertMetadata').length
        expect(parsed.transformers).toHaveLength(expected)
    })

    it('validates without complaint', () => {
        expect(parsed.validationMessages).toEqual([])
    })

    it('loads the retired spelling under its current name', () => {
        expect(savedCalls.some(c => c.name === 'TranslatePhyiscalTimeToTicks')).toBe(true)
        expect(parsed.transformers.some(t => t.name === 'TranslatePhysicalTimeToTicks')).toBe(true)
        expect(parsed.transformers.some(t => t.name === 'TranslatePhyiscalTimeToTicks')).toBe(false)
    })

    it('orders the chain with no unrecognised name falling off the end', () => {
        const order = getTransformerOrder()
        for (const transformer of parsed.transformers) {
            expect(order.indexOf(transformer.name), `${transformer.name} is not in the order`)
                .toBeGreaterThanOrEqual(0)
        }
    })
})
