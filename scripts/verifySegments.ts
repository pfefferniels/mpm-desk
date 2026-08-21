/**
 * Verifies the baked files in `public/` against each other.
 *
 *   1. Referential integrity: every element id a segment names is in the MPM,
 *      and no element is claimed by two segments.
 *   2. Spotlight: espressivo must accept every segment's element ids, since
 *      `renderPerformance` now passes them through unfiltered.
 *   3. The reader: every id a segment names must resolve through `readPerformance`,
 *      which is what the popover and the playback follow look it up in.
 *
 * These are the two checks that outlived the bake. The transformer pipeline that
 * produced the three files moved to `mpmify/scripts/bake/` when this repo dropped
 * `mpmify`, and with it the two checks that re-derived and diffed. Here `public/`
 * is the source of truth, and `data/info.json` is provenance nothing reads.
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
const { readPerformance } = await import('../src/utils/mpm')
const { readMeter } = await import('../src/utils/score')
import type { Reconstruction } from '../src/model/Reconstruction'

const problems: string[] = []
const check = (ok: boolean, message: string) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${message}`)
    if (!ok) problems.push(message)
}

const mpmXml = readFileSync('public/performance.mpm', 'utf-8')
const { segments } = JSON.parse(readFileSync('public/segments.json', 'utf-8')) as Reconstruction

// ----------------------------------------------------- 1. referential integrity
console.log('\n1. every reference lands')
const doc = new DOMParser().parseFromString(mpmXml, 'application/xml')
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

// ----------------------------------------------------------------- 2. spotlight
// renderPerformance passes segment ids to spotlightMpm unfiltered; espressivo throws
// SelectionNotFoundError on an id it cannot map onto a dimension, which would abort a
// region preview. Every segment is spotlit here so that cannot come as a surprise.
console.log('\n2. espressivo accepts every segment as a spotlight selection')
let spotlightFailures = 0
let firstFailure = ''
for (const segment of segments) {
    const ids = segment.spans.flatMap(p => p.elements)
    try {
        spotlightMpm(mpmXml, { ids, attenuation: 0.05 })
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
        spotlightMpm(mpmXml, { ids: span.elements, attenuation: 0.05 })
    } catch { spanFailures++ }
}
check(spanFailures === 0, `all ${spanIds.length} single-span selections spotlight cleanly (${spanFailures} failed)`)

// ------------------------------------------------------------------- 3. the reader
// Clicking a span looks its id up in `readPerformance`; following playback looks up what
// `effectiveAt` returns. An id that resolves in the XML but not in the reader would show
// an empty popover and never light up — which is exactly what `mpm-ts` did to all 51
// <accentuationPattern> elements before this repo moved to espressivo's object model.
console.log('\n3. the reader resolves every referenced element')
const reader = readPerformance(mpmXml, readMeter(readFileSync('public/score.msm', 'utf-8')))
const unresolved = allElements.filter(id => !reader.byId(id))
check(unresolved.length === 0,
    `all ${allElements.length} referenced ids resolve (${unresolved.length} missing${unresolved.length ? `: ${unresolved.slice(0, 5).join(', ')}` : ''})`)

const typeMismatches = segments.flatMap(s => s.spans).filter(span => reader.byId(span.id)?.type !== span.type)
check(typeMismatches.length === 0,
    `every span's type matches what the reader reports (${typeMismatches.length} differ)`)

// Both charts must have something to draw for every span of their type; a null means the
// renderer skips the instruction, which would leave the popover blank.
const undrawable = segments.flatMap(s => s.spans).filter(span => {
    const instruction = reader.byId(span.id)
    if (!instruction) return false
    if (instruction.type === 'tempo') return reader.tempoAround(instruction) === null
    if (instruction.type === 'dynamics') return reader.dynamicsAround(instruction) === null
    return false
})
check(undrawable.length === 0, `every tempo and dynamics span resolves to a curve (${undrawable.length} do not)`)

console.log(problems.length
    ? `\nFAIL — ${problems.length} problem(s)`
    : '\nOK — every reference lands, espressivo accepts every selection, and the reader resolves them all')
process.exit(problems.length ? 1 : 0)
