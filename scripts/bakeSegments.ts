/**
 * One-off migration: bake the transformer pipeline into finished data.
 *
 * The viewer used to ship 460 transformers and re-run mpmify's pipeline in the
 * browser on every load, only to arrive at one MPM and one set of intensity
 * segments. Both are constants of the piece, so this computes them once:
 *
 *   public/score.msm        the MEI converted by espressivo — what a render performs
 *   public/performance.mpm  the pipeline's MPM
 *   public/segments.json    the intensity segments, each naming its MPM element ids
 *
 * The pipeline anneals (Math.random in mpmify's Approximation.ts), so the three
 * must come from one run: re-running fits different values and mints different
 * definition ids. Baking is what makes them agree for good.
 *
 * `data/info.json` stays in the repo as the source this was derived from.
 *
 * Usage:
 *   node_modules/.bin/vite-node scripts/bakeSegments.ts -- [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(`--${name}`)
const opt = (name: string, fallback: string) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const meiPath = opt('mei', 'public/transcription.mei')
const infoPath = opt('info', 'data/info.json')
const write = flag('write')

// espressivo, asMSM and mergeArgumentations all expect the browser's DOM.
const { window } = new JSDOM()
globalThis.DOMParser = window.DOMParser
globalThis.XMLSerializer = window.XMLSerializer
globalThis.Element = window.Element
globalThis.Node = window.Node

const { derive } = await import('./deriveSegments')

const info = readFileSync(infoPath, 'utf-8')
const { scoreMsm, mpmXml, reconstruction, stats } = derive(readFileSync(meiPath, 'utf-8'), info)
const { segments } = reconstruction

const spanCount = segments.reduce((n, s) => n + s.spans.length, 0)
const elementCount = segments.reduce((n, s) => n + s.spans.reduce((m, p) => m + p.elements.length, 0), 0)
console.log(`${stats.transformers} transformers, ${stats.argumentations} argumentations`)
console.log(`-> ${segments.length} segments, ${spanCount} spans, ${elementCount} element references`)
console.log(`   dropped ${stats.droppedSpans} spans that produced nothing, ${stats.droppedElements} stale element ids`)

const spanIds = segments.flatMap(s => s.spans.map(p => p.id))
const duplicates = spanIds.filter((id, i) => spanIds.indexOf(id) !== i)
if (duplicates.length) {
    console.error(`FAIL — span ids are not unique: ${duplicates.slice(0, 5).join(', ')}`)
    process.exit(1)
}

// Every referenced id must name an element of the MPM being written beside it.
const doc = new DOMParser().parseFromString(mpmXml, 'application/xml')
const tagById = new Map<string, string>()
for (const element of Array.from(doc.getElementsByTagName('*'))) {
    const id = element.getAttribute('xml:id')
    if (id) tagById.set(id, element.tagName)
}
const missing = segments.flatMap(s => s.spans.flatMap(p => p.elements)).filter(id => !tagById.has(id))
if (missing.length) {
    console.error(`FAIL — ${missing.length} referenced ids are absent from the MPM: ${missing.slice(0, 5).join(', ')}`)
    process.exit(1)
}
const tags = new Map<string, number>()
for (const s of segments) for (const span of s.spans) for (const id of span.elements) {
    const tag = tagById.get(id)!
    tags.set(tag, (tags.get(tag) ?? 0) + 1)
}
console.log(`   referenced elements: ${[...tags].sort().map(([k, v]) => `${k}=${v}`).join(', ')}`)

const json = JSON.stringify(reconstruction, null, 2) + '\n'
console.log(`\nscore.msm ${scoreMsm.length} B, performance.mpm ${mpmXml.length} B, segments.json ${json.length} B`)
console.log(`   (segments.json replaces info.json, ${info.length} B)`)

if (!write) {
    console.log('\ndry run — pass --write to update public/')
    process.exit(0)
}

writeFileSync('public/score.msm', scoreMsm)
writeFileSync('public/performance.mpm', mpmXml)
writeFileSync('public/segments.json', json)
console.log('\nwrote public/score.msm, public/performance.mpm, public/segments.json')
