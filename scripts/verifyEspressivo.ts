/**
 * Verifies what playback depends on, straight from the files the app ships.
 *
 *   1. The MIDI carries one note-id text meta event per note-on, on a grid where
 *      one tick is one millisecond — `findNoteIdTime` and the playhead need both.
 *   2. Every id in that stream names a note of the score.
 *   3. Spotlight renders for a sample of every element type the segments use.
 *   4. Exaggeration x sketchiness stays on the smooth side of the ornament cliff,
 *      and a scalar past the cap still renders instead of throwing.
 *
 * `verifySegments.ts` covers the other half — that the baked files are the
 * pipeline, and that espressivo accepts every selection the app can make.
 *
 * Usage:
 *   node_modules/.bin/vite-node scripts/verifyEspressivo.ts
 */
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { read } from 'midifile-ts'
import type { Reconstruction } from '../src/model/Reconstruction'

// The espressivo facade runs in the browser.
const { window } = new JSDOM()
globalThis.DOMParser = window.DOMParser
globalThis.Element = window.Element
globalThis.Node = window.Node

const { renderPerformance } = await import('../src/utils/espressivo')

const msmXml = readFileSync('public/score.msm', 'utf-8')
const mpmXml = readFileSync('public/performance.mpm', 'utf-8')
const { segments } = JSON.parse(readFileSync('public/segments.json', 'utf-8')) as Reconstruction

const quiet = <T>(fn: () => T): T => {
    const log = console.log
    console.log = () => { }
    try { return fn() } finally { console.log = log }
}

const problems: string[] = []
const check = (ok: boolean, message: string) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${message}`)
    if (!ok) problems.push(message)
}

const toArrayBuffer = (bytes: Uint8Array) =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

const inspect = (bytes: Uint8Array) => {
    const file = read(toArrayBuffer(bytes))
    let textEvents = 0, noteOns = 0, msPerTick = 0, lastOnset = 0
    const ids: string[] = []
    for (const track of file.tracks) {
        let abs = 0
        for (const ev of track) {
            abs += ev.deltaTime
            if (ev.type === 'meta' && ev.subtype === 'setTempo') {
                msPerTick = ev.microsecondsPerBeat / file.header.ticksPerBeat / 1000
            } else if (ev.type === 'meta' && ev.subtype === 'text') {
                textEvents++
                ids.push(ev.text)
            } else if (ev.type === 'channel' && ev.subtype === 'noteOn' && ev.velocity > 0) {
                noteOns++
                lastOnset = Math.max(lastOnset, abs)
            }
        }
    }
    return { textEvents, noteOns, msPerTick, ids, seconds: lastOnset / 1000 }
}

// ---------------------------------------------------------------- 1. the grid
console.log('\n1. MSM + MPM -> expressive MIDI')
const t0 = performance.now()
const midi = quiet(() => renderPerformance({ msm: msmXml, mpm: mpmXml }))
console.log(`  render: ${(performance.now() - t0).toFixed(0)} ms, ${midi.byteLength} bytes`)

const rendered = inspect(midi)
check(rendered.msPerTick === 1, `one tick is one millisecond (got ${rendered.msPerTick})`)
check(rendered.textEvents === rendered.noteOns,
    `one note-id text event per note-on (${rendered.textEvents}/${rendered.noteOns})`)

// ------------------------------------------------------------- 2. the note ids
console.log('\n2. the ids playback reports')
const scoreIds = new Set(
    Array.from(new DOMParser().parseFromString(msmXml, 'application/xml').querySelectorAll('note'))
        .map(n => n.getAttribute('xml:id'))
        .filter((id): id is string => id !== null))
const unknown = rendered.ids.filter(id => !scoreIds.has(id))
check(unknown.length === 0,
    `every text event names a score note (${unknown.length} unknown${unknown.length ? ': ' + unknown.slice(0, 3) : ''})`)
console.log(`  score notes ${scoreIds.size}, sounding ${rendered.noteOns}`)

// --------------------------------------------------------------- 3. spotlight
console.log('\n3. spotlight per element type')
const byType = new Map<string, string[]>()
for (const segment of segments) for (const span of segment.spans) {
    byType.set(span.type, [...(byType.get(span.type) ?? []), ...span.elements])
}
let renderFailures = 0
for (const [type, ids] of [...byType].sort()) {
    const sample = ids.slice(0, 3)
    try {
        quiet(() => renderPerformance({ msm: msmXml, mpm: mpmXml, mpmIds: sample, isolate: true }))
        console.log(`    <${type}>: ${ids.length} ids, sample of ${sample.length} renders`)
    } catch (error) {
        renderFailures++
        console.log(`    <${type}>: render FAILED — ${(error as Error).message.split('\n')[0]}`)
    }
}
check(renderFailures === 0, `every element type renders under spotlight (${renderFailures} failed)`)

// ------------------------------------------------------------- 4. the sliders
// The exaggeration slider runs 1..2; computeSketchiness(stretchX) returns 1..1.5. The two
// multiply into one scalar, capped at EXPRESSION_MAX because ornamentSpread is a cliff:
// the sweep is smooth to 1.90 and jumps 51% at 1.95.
console.log('\n4. exaggeration x sketchiness')
const durations: { seconds: number; notes: number }[] = []
for (const [exaggerate, sketchiness] of
    [[1, 1], [1.2, 1], [1.5, 1], [2, 1], [1, 1.5], [1.5, 1.5], [2, 1.5]] as const) {
    try {
        const bytes = quiet(() => renderPerformance({ msm: msmXml, mpm: mpmXml, exaggerate, sketchiness }))
        const { seconds, noteOns } = inspect(bytes)
        durations.push({ seconds, notes: noteOns })
        console.log(`    exaggerate ${exaggerate}, sketchiness ${sketchiness}: ${seconds.toFixed(1)} s, ${noteOns} notes`)
    } catch (error) {
        check(false, `exaggerate ${exaggerate} / sketchiness ${sketchiness} threw — ${(error as Error).message.split('\n')[0]}`)
    }
}

const baseSeconds = durations[0]?.seconds ?? 0
check(durations.every(d => d.notes === durations[0].notes), 'no setting adds or drops a note')
check(durations.every(d => d.seconds < baseSeconds * 1.5),
    `no setting runs away (longest ${Math.max(...durations.map(d => d.seconds)).toFixed(1)} s vs ${baseSeconds.toFixed(1)} s)`)

// The cap is what keeps the product off the cliff, so a scalar past it must still render.
for (const exaggerate of [0, 0.5, 3, 10]) {
    try {
        quiet(() => renderPerformance({ msm: msmXml, mpm: mpmXml, exaggerate }))
        check(true, `exaggerate=${exaggerate} renders`)
    } catch (error) {
        check(false, `exaggerate=${exaggerate} threw — ${(error as Error).message.split('\n')[0].slice(0, 80)}`)
    }
}

console.log(problems.length ? `\nFAIL — ${problems.length} problem(s)` : '\nOK — the render contract holds')
process.exit(problems.length ? 1 : 0)
