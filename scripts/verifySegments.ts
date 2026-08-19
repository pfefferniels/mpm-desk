/**
 * Verifies the baked files in `public/` against the pipeline they came from.
 *
 *   1. Re-derive from `public/transcription.mei` + `data/info.json` and compare.
 *   2. Referential integrity: every element id a segment names is in the MPM,
 *      and no element is claimed by two segments.
 *   3. Spotlight: espressivo must accept every segment's element ids, since
 *      `renderPerformance` now passes them through unfiltered.
 *   4. The intensity curve drawn from the segments must equal the one the
 *      transformer pipeline used to produce — the same picture, no derivation.
 *
 * Re-running the pipeline anneals differently (Math.random in mpmify's
 * Approximation.ts), so fitted values may move. Dates, ids and ranges may not:
 * those are what the segments are built from, and check 1 says so.
 *
 * Usage:
 *   node_modules/.bin/vite-node scripts/verifySegments.ts
 */
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const { window } = new JSDOM()
globalThis.DOMParser = window.DOMParser
globalThis.XMLSerializer = window.XMLSerializer
globalThis.Element = window.Element
globalThis.Node = window.Node

const { spotlightMpm } = await import('espressivo')
const { getRange } = await import('mpmify')
const { derive } = await import('./deriveSegments')
const { negotiateIntensityCurve } = await import('../src/utils/intensityCurve')
import type { Reconstruction, Segment } from '../src/model/Reconstruction'

const problems: string[] = []
const check = (ok: boolean, message: string) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${message}`)
    if (!ok) problems.push(message)
}

const shipped = {
    scoreMsm: readFileSync('public/score.msm', 'utf-8'),
    mpmXml: readFileSync('public/performance.mpm', 'utf-8'),
    reconstruction: JSON.parse(readFileSync('public/segments.json', 'utf-8')) as Reconstruction,
}
const segments = shipped.reconstruction.segments

// ------------------------------------------------------------- 1. re-derive
console.log('\n1. re-derive from the MEI and info.json')
const fresh = derive(
    readFileSync('public/transcription.mei', 'utf-8'),
    readFileSync('data/info.json', 'utf-8'),
)
console.log(`  ${fresh.stats.transformers} transformers -> ${fresh.reconstruction.segments.length} segments`)

// espressivo mints a fresh `meico_<uuid>` for the sequencing markers on every
// conversion; nothing else in the MSM moves, notes included.
const withoutMintedIds = (msm: string) => msm.replace(/meico_[0-9a-f-]{36}/g, 'meico_*')
check(withoutMintedIds(fresh.scoreMsm) === withoutMintedIds(shipped.scoreMsm),
    'score.msm is what espressivo converts the MEI to, up to its minted marker ids')

/** What a segment claims, independent of which spans carry it. */
const claim = (s: Segment) =>
    `${s.id} ${s.motivation}/${s.certainty} [${s.from},${s.to}]${s.continue ? ` ->${s.continue}` : ''} ${s.note ?? ''}`
check(segments.map(claim).sort().join('\n') === fresh.reconstruction.segments.map(claim).sort().join('\n'),
    `every segment, its range and its argument survive a re-run (${segments.length})`)

const elementsOf = (list: Segment[]) => list.flatMap(s => s.spans.flatMap(p => p.elements))
const shippedElements = new Set(elementsOf(segments))
const freshElements = new Set(elementsOf(fresh.reconstruction.segments))
check(shippedElements.size === freshElements.size &&
    [...shippedElements].every(id => freshElements.has(id)),
    `the same ${shippedElements.size} MPM elements are referenced (fresh run: ${freshElements.size})`)

// Where a re-run *does* differ: annealed velocity fits decide whether two metrical
// accentuations are alike enough for MergeMetricalAccentuations to fold together, and
// the fold moves a pattern from one transformer's `created` to another's. That is the
// non-determinism the bake freezes. A difference in any other element type would not be
// annealing, it would be a regression.
const spansByType = (s: Segment) => {
    const map = new Map<string, string>()
    for (const p of s.spans) {
        map.set(`${p.type}|${p.id}`, `[${p.from},${p.to}] ${p.elements.join(' ')}`)
    }
    return map
}
const freshById = new Map(fresh.reconstruction.segments.map(s => [s.id, s]))
const unstableTypes = new Set<string>()
let unstableSegments = 0
for (const segment of segments) {
    const other = freshById.get(segment.id)
    if (!other) continue
    const a = spansByType(segment)
    const b = spansByType(other)
    let differs = false
    for (const key of new Set([...a.keys(), ...b.keys()])) {
        if (a.get(key) !== b.get(key)) { unstableTypes.add(key.split('|')[0]); differs = true }
    }
    if (differs) unstableSegments++
}
console.log(`  spans differ in ${unstableSegments} of ${segments.length} segments` +
    `${unstableTypes.size ? ` (${[...unstableTypes].sort().join(', ')})` : ''}`)
check([...unstableTypes].every(type => type === 'accentuationPattern'),
    'only accentuationPattern grouping moves between runs')

// -------------------------------------------------------- 2. referential integrity
console.log('\n2. every reference lands')
const doc = new DOMParser().parseFromString(shipped.mpmXml, 'application/xml')
const tagById = new Map<string, string>()
for (const element of Array.from(doc.getElementsByTagName('*'))) {
    const id = element.getAttribute('xml:id')
    if (id) tagById.set(id, element.tagName)
}

const allElements = segments.flatMap(s => s.spans.flatMap(p => p.elements))
const missing = allElements.filter(id => !tagById.has(id))
check(missing.length === 0, `all ${allElements.length} element ids exist in performance.mpm (${missing.length} missing)`)

const owner = new Map<string, string>()
const contested: string[] = []
for (const s of segments) for (const span of s.spans) for (const id of span.elements) {
    if (owner.has(id) && owner.get(id) !== s.id) contested.push(id)
    else owner.set(id, s.id)
}
check(contested.length === 0, `no element is claimed by two segments (${contested.length} contested)`)

const spanIds = segments.flatMap(s => s.spans.map(p => p.id))
check(new Set(spanIds).size === spanIds.length, `span ids are unique (${spanIds.length})`)
check(segments.every(s => s.spans.every(p => p.elements[0] === p.id)),
    'every span is identified by the element it leads with')
check(segments.every(s => s.spans.every(p => tagById.get(p.id) === p.type)),
    'every span type matches its element in the MPM')

// ----------------------------------------------------------------- 3. spotlight
// renderPerformance passes segment ids to spotlightMpm unfiltered; espressivo throws
// SelectionNotFoundError on an id it cannot map onto a dimension, which would abort a
// region preview. Every segment is spotlit here so that cannot come as a surprise.
console.log('\n3. espressivo accepts every segment as a spotlight selection')
let spotlightFailures = 0
let firstFailure = ''
for (const segment of segments) {
    const ids = segment.spans.flatMap(p => p.elements)
    try {
        spotlightMpm(shipped.mpmXml, { ids, attenuation: 0.05 })
    } catch (error) {
        spotlightFailures++
        if (!firstFailure) firstFailure = `${segment.id}: ${(error as Error).message.split('\n')[0]}`
    }
}
check(spotlightFailures === 0,
    `all ${segments.length} segments spotlight cleanly${firstFailure ? ` — ${firstFailure}` : ''}`)

let spanFailures = 0
for (const segment of segments) for (const span of segment.spans) {
    try {
        spotlightMpm(shipped.mpmXml, { ids: span.elements, attenuation: 0.05 })
    } catch { spanFailures++ }
}
check(spanFailures === 0, `all ${spanIds.length} single-span selections spotlight cleanly (${spanFailures} failed)`)

// --------------------------------------------------------------- 4. the picture
// The curve the app draws, against the one the transformer pipeline described.
console.log('\n4. the intensity curve is unchanged')

/**
 * How TransformerStack built the curve before the bake: argumentations grouped
 * by identity, ranges resolved through the MSM, element types looked up in the MPM.
 */
const curveFromPipeline = (maxDate: number) => {
    const { transformers, msm, mpm } = fresh.pipeline
    const typeById = new Map((mpm.getInstructions() as { 'xml:id': string; type: string }[])
        .map(i => [i['xml:id'], i.type]))
    const argumentations = Map.groupBy(transformers, t => t.argumentation)

    const startsByType = new Map<string, number[]>()
    for (const [, group] of argumentations) {
        for (const t of group) {
            const range = getRange(t.options, msm)
            if (!range) continue
            const types = [...new Set(t.created.map(id => typeById.get(id)).filter(Boolean))] as string[]
            for (const type of types) {
                startsByType.set(type, [...(startsByType.get(type) ?? []), range.from])
            }
        }
    }
    for (const starts of startsByType.values()) starts.sort((a, b) => a - b)

    const diff = new Array<number>(maxDate).fill(0)
    for (const [argumentation, group] of argumentations) {
        const range = getRange(group, msm)
        if (!range) continue

        let sign: number, gain: number
        switch (argumentation.conclusion.motivation) {
            case 'intensify': sign = +1; gain = 1.0; break
            case 'move': sign = +1; gain = 0.5; break
            case 'relax': sign = -1; gain = 1.0; break
            case 'calm': sign = -1; gain = 0.5; break
            default: continue
        }

        const start = range.from
        const end = range.to ?? range.from
        let length = Math.max(200, end - start + 1)
        if (range.to === undefined || range.to === range.from) {
            const types = group.flatMap(t =>
                [...new Set(t.created.map(id => typeById.get(id)).filter(Boolean))] as string[])
            let nextStart = Infinity
            for (const type of types) {
                for (const s of startsByType.get(type) ?? []) {
                    if (s > start && s < nextStart) { nextStart = s; break }
                }
            }
            if (nextStart < start + length) length = nextStart - start
        }
        if (length === 1) continue

        for (let idx = 0; idx < length; idx++) {
            const i = start + idx
            if (!Number.isInteger(i) || i < 0 || i >= diff.length) continue
            const t = idx / (length - 1)
            diff[i] += sign * Math.sin(Math.PI * t) * Math.sqrt(length) * gain
        }
    }
    return diff
}

/** The tail of negotiateIntensityCurve: integrate, de-trend, scale to 0..1. */
const normalize = (diff: number[]) => {
    const n = diff.length
    const integrated = new Array<number>(n)
    let running = 0
    for (let i = 0; i < n; i++) { running += diff[i]; integrated[i] = running }
    const end = integrated[n - 1]
    const bridged = integrated.map((v, i) => v - (i / (n - 1)) * end)
    let min = bridged[0], max = bridged[0]
    for (const v of bridged) { if (v < min) min = v; if (v > max) max = v }
    return max === min ? bridged.map(() => 0) : bridged.map(v => (v - min) / (max - min))
}

const maxDate = segments.reduce((max, s) => Math.max(max, s.to), 0)
const fromSegments = negotiateIntensityCurve(segments, maxDate)
const fromPipeline = normalize(curveFromPipeline(maxDate))

let maxDelta = 0
for (let i = 0; i < fromSegments.values.length; i++) {
    const source = Math.min(fromPipeline.length - 1, i * fromSegments.step)
    maxDelta = Math.max(maxDelta, Math.abs(fromSegments.values[i] - fromPipeline[source]))
}
check(maxDelta < 1e-9, `curve identical to the pipeline's (largest difference ${maxDelta.toExponential(2)})`)

console.log(problems.length
    ? `\nFAIL — ${problems.length} problem(s)`
    : '\nOK — the baked files are the pipeline, and the picture is unchanged')
process.exit(problems.length ? 1 : 0)
