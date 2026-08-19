/**
 * Verifies the espressivo migration against the Java meico backend it replaced.
 *
 *   1. MEI -> MSM:  espressivo's conversion, fed through the app's own `asMSM`, must produce
 *                   the same notes and pedals as the backend's `/convert` did.
 *   2. MSM -> MIDI: the rendered performance must carry one note-id text meta event per
 *                   note-on on a one-tick-per-millisecond grid, which is what playback and
 *                   `findNoteIdTime` rely on, and must agree with `/perform` on onsets.
 *   3. Spotlight:   the ids the app actually passes must survive `resolveSpotlightIds` and
 *                   render, including the `<accentuation>` ids espressivo cannot map itself.
 *
 * Steps 1 and 2's backend half is skipped when :8080 is not running; everything else still
 * runs, so this is useful once the Java service is gone for good.
 *
 * Usage:
 *   node_modules/.bin/vite-node scripts/verifyEspressivo.ts
 */
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { read } from 'midifile-ts'

const BACKEND = process.env.MPM_BACKEND_URL ?? 'http://localhost:8080'

// asMSM and the espressivo facade both run in the browser.
const { window } = new JSDOM()
globalThis.DOMParser = window.DOMParser
globalThis.Element = window.Element
globalThis.Node = window.Node

const { convertMei, renderPerformance, resolveSpotlightIds } = await import('../src/utils/espressivo')
const { asMSM } = await import('../src/utils/asMSM')
const { parseWork } = await import('../src/utils/workImport')
const { MPM, InsertMetadata, compareTransformers } = await import('mpmify')
const { exportMPM } = await import('mpm-ts')

const mei = readFileSync('public/transcription.mei', 'utf-8')
const info = readFileSync('public/info.json', 'utf-8')

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

// ---------------------------------------------------------------- 1. conversion
console.log('\n1. MEI -> MSM')
const t0 = performance.now()
const { msm: msmXml } = quiet(() => convertMei(mei))
console.log(`  espressivo conversion: ${(performance.now() - t0).toFixed(0)} ms`)

const espMsm = asMSM(mei, msmXml)
console.log(`  notes ${espMsm.allNotes.length}, pedals ${espMsm.pedals.length}`)
check(espMsm.allNotes.length > 0, 'conversion yields notes')

let javaMsmXml: string | null = null
try {
    const response = await fetch(`${BACKEND}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ mei }),
    })
    if (response.ok) javaMsmXml = (await response.json() as { msm: string }).msm
} catch { /* backend gone — that is the point of this migration */ }

if (!javaMsmXml) {
    console.log('  (java backend unavailable — skipping the comparison half)')
} else {
    const javaMsm = asMSM(mei, javaMsmXml)
    const noteKey = (n: { 'xml:id': string; date: number; 'midi.pitch': number }) =>
        `${n['xml:id']}|${n.date}|${n['midi.pitch']}`
    const noteValue = (n: { 'midi.onset': number; 'midi.duration': number; 'midi.velocity': number }) =>
        `${n['midi.onset'].toFixed(6)}|${n['midi.duration'].toFixed(6)}|${n['midi.velocity']}`

    check(javaMsm.allNotes.length === espMsm.allNotes.length,
        `note count matches java (${javaMsm.allNotes.length})`)
    check(javaMsm.pedals.length === espMsm.pedals.length,
        `pedal count matches java (${javaMsm.pedals.length})`)

    const espByKey = new Map(espMsm.allNotes.map(n => [noteKey(n), n]))
    let mismatched = 0
    for (const jn of javaMsm.allNotes) {
        const en = espByKey.get(noteKey(jn))
        if (!en || noteValue(en) !== noteValue(jn)) mismatched++
    }
    check(mismatched === 0, `every note identical to java's (${mismatched} differ)`)
}

// ---------------------------------------------------------------- 2. rendering
console.log('\n2. MSM + MPM -> expressive MIDI')
const parsed = parseWork(info)

// parseWork strips InsertMetadata and pipeline.worker.ts prepends its own; without it the
// MPM carries no metadata and espressivo rejects it ("Cannot generate empty Metadata object").
const metadata = new InsertMetadata({
    authors: parsed.metadata.author ? [{ number: 0, text: parsed.metadata.author }] : [],
    comments: parsed.metadata.title ? [{ text: parsed.metadata.title }] : [],
})
metadata.argumentation = {
    note: '',
    id: 'argumentation-metadata',
    conclusion: { certainty: 'authentic', id: 'belief-metadata', motivation: 'calm' },
    type: 'simpleArgumentation',
}

const transformers = [metadata, ...parsed.transformers].sort(compareTransformers)
const mpm = new MPM()
quiet(() => transformers.forEach(t => t.run(espMsm, mpm)))
const mpmXml = exportMPM(mpm)
const mpmDoc = new DOMParser().parseFromString(mpmXml, 'application/xml')
const tagById = new Map<string, string>()
for (const element of Array.from(mpmDoc.getElementsByTagName('*'))) {
    const id = element.getAttribute('xml:id')
    if (id) tagById.set(id, element.tagName)
}
console.log(`  pipeline: ${transformers.length} transformers -> ${mpmXml.length} chars of MPM`)

const t1 = performance.now()
const midi = quiet(() => renderPerformance({ msm: msmXml, mpm: mpmXml }))
console.log(`  render: ${(performance.now() - t1).toFixed(0)} ms, ${midi.byteLength} bytes`)

const toArrayBuffer = (bytes: Uint8Array) =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

const inspect = (bytes: Uint8Array) => {
    const file = read(toArrayBuffer(bytes))
    let textEvents = 0, noteOns = 0, msPerTick = 0
    const onsets: number[] = []
    const ids: string[] = []
    /** Onset per note id — the text event precedes its note-on at the same tick. */
    const onsetById = new Map<string, number>()
    for (const track of file.tracks) {
        let abs = 0
        let pendingId: string | null = null
        for (const ev of track) {
            abs += ev.deltaTime
            if (ev.type === 'meta' && ev.subtype === 'setTempo') {
                msPerTick = ev.microsecondsPerBeat / file.header.ticksPerBeat / 1000
            } else if (ev.type === 'meta' && ev.subtype === 'text') {
                textEvents++
                ids.push(ev.text)
                pendingId = ev.text
            } else if (ev.type === 'channel' && ev.subtype === 'noteOn' && ev.velocity > 0) {
                noteOns++
                onsets.push(abs)
                if (pendingId !== null && !onsetById.has(pendingId)) onsetById.set(pendingId, abs)
                pendingId = null
            }
        }
    }
    return { textEvents, noteOns, msPerTick, onsets, ids, onsetById }
}

/** Largest per-note onset difference between two renders, matched by note id. */
const maxDriftById = (a: Map<string, number>, b: Map<string, number>) => {
    let max = 0
    for (const [id, onset] of a) {
        const other = b.get(id)
        if (other !== undefined) max = Math.max(max, Math.abs(onset - other))
    }
    return max
}

const rendered = inspect(midi)
check(rendered.msPerTick === 1, `one tick is one millisecond (got ${rendered.msPerTick})`)
check(rendered.textEvents === rendered.noteOns,
    `one note-id text event per note-on (${rendered.textEvents}/${rendered.noteOns})`)

// The MIDI renders the whole score; `msm.allNotes` holds only the notes the MEI carries
// performance data for, so the id set to check against is the converted MSM's, not the
// enriched one's. PlaybackProvider already ignores an id it cannot resolve.
const scoreIds = new Set(
    Array.from(new DOMParser().parseFromString(msmXml, 'application/xml').querySelectorAll('note'))
        .map(n => n.getAttribute('xml:id'))
        .filter((id): id is string => id !== null))
const unknown = rendered.ids.filter(id => !scoreIds.has(id))
check(unknown.length === 0,
    `every text event names a score note (${unknown.length} unknown${unknown.length ? ': ' + unknown.slice(0, 3) : ''})`)
console.log(`  score notes ${scoreIds.size}, of which ${espMsm.allNotes.length} carry performance data`)

try {
    const response = await fetch(`${BACKEND}/perform`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ mei, mpm: mpmXml }),
    })
    if (response.ok) {
        const b64 = (await response.json() as { midi_b64: string }).midi_b64
        const javaBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
        const java = inspect(javaBytes)
        check(java.msPerTick === rendered.msPerTick, 'tick grid matches java')

        // Control first: were an MPM to carry imprecision maps or note-generating ornaments,
        // the renderer would seed them from Math.random() and two espressivo renders of the
        // same input would already disagree. Measure that before reading anything into a
        // java/espressivo difference.
        const second = inspect(quiet(() => renderPerformance({ msm: msmXml, mpm: mpmXml })))
        const selfDrift = maxDriftById(rendered.onsetById, second.onsetById)
        const crossDrift = maxDriftById(rendered.onsetById, java.onsetById)
        console.log(`  java onsets ${java.onsets.length}, espressivo ${rendered.onsets.length}`)
        console.log(`  max onset drift: espressivo vs itself ${selfDrift} ms, vs java ${crossDrift} ms`)

        const drifting = Array.from(rendered.onsetById)
            .filter(([id, onset]) => {
                const other = java.onsetById.get(id)
                return other !== undefined && Math.abs(onset - other) > Math.max(selfDrift, 1)
            })
            .map(([id, onset]) => ({ id, onset, java: java.onsetById.get(id)! }))

        console.log(`  notes differing from java: ${drifting.length} of ${java.onsetById.size}`)
        for (const d of drifting.slice(0, 10)) {
            console.log(`    ${d.id}: java ${d.java} ms, espressivo ${d.onset} ms (${d.onset - d.java > 0 ? '+' : ''}${d.onset - d.java})`)
        }

        // Every difference found so far sits on an <ornament> whose temporalSpread frame is
        // measured in ticks — the one case espressivo's own docs name as diverging, because
        // its v3 renderer derives generated notes' dates from the frame. A difference anywhere
        // else would be a real regression and is what this asserts.
        const tickFramedDates = new Set<number>()
        const tickDefs = new Set(
            Array.from(mpmDoc.querySelectorAll('ornamentDef'))
                .filter(def => Array.from(def.querySelectorAll('temporalSpread'))
                    .some(spread => (spread.getAttribute('time.unit') ?? 'ticks') === 'ticks'))
                .map(def => def.getAttribute('name'))
                .filter((name): name is string => name !== null))
        for (const ornament of Array.from(mpmDoc.querySelectorAll('ornament'))) {
            const ref = ornament.getAttribute('name.ref')
            const date = Number(ornament.getAttribute('date'))
            if (ref && tickDefs.has(ref) && Number.isFinite(date)) tickFramedDates.add(date)
        }
        const unexplained = drifting.filter(d => {
            const date = espMsm.getByID(d.id)?.date
            return date === undefined || !tickFramedDates.has(date)
        })
        check(unexplained.length === 0,
            `every java difference sits on a tick-framed ornament (${unexplained.length} unexplained` +
            `${unexplained.length ? ': ' + unexplained.slice(0, 3).map(u => u.id).join(', ') : ''})`)
    } else {
        console.log('  (java /perform unavailable — skipping onset comparison)')
    }
} catch {
    console.log('  (java backend unavailable — skipping onset comparison)')
}

// ---------------------------------------------------------------- 3. spotlight
console.log('\n3. spotlight over the ids the app passes')
const created = transformers.flatMap(t => t.created)
console.log(`  transformers created ${created.length} instruction ids`)

const byTag = new Map<string, string[]>()
for (const id of created) {
    const tag = tagById.get(id) ?? '(not in mpm)'
    byTag.set(tag, [...(byTag.get(tag) ?? []), id])
}
for (const [tag, list] of byTag) console.log(`    <${tag}>: ${list.length}`)

let rendersOk = 0, renderFailures = 0
for (const [tag, list] of byTag) {
    if (tag === '(not in mpm)') continue
    const sample = list.slice(0, 3)
    const resolvedIds = resolveSpotlightIds(mpmXml, sample)
    try {
        quiet(() => renderPerformance({ msm: msmXml, mpm: mpmXml, mpmIds: sample, isolate: true }))
        rendersOk++
        console.log(`    <${tag}>: ${sample.length} ids -> ${resolvedIds.length} spotlit, render ok`)
    } catch (error) {
        renderFailures++
        console.log(`    <${tag}>: render FAILED — ${(error as Error).message.split('\n')[0]}`)
    }
}
check(renderFailures === 0, `every instruction type renders under spotlight (${rendersOk} ok, ${renderFailures} failed)`)

// The fallback that exists for them: <accentuation> ids govern no dimension, so espressivo
// rejects them outright — and all-or-nothing, so one would abort a whole region preview.
const accentuationIds = Array.from(mpmDoc.querySelectorAll('accentuation'))
    .map(el => el.getAttribute('xml:id'))
    .filter((id): id is string => id !== null)
console.log(`  <accentuation> ids in the MPM: ${accentuationIds.length}`)
if (accentuationIds.length) {
    const sample = accentuationIds.slice(0, 3)
    const mapped = resolveSpotlightIds(mpmXml, sample)
    check(mapped.length > 0, `<accentuation> ids map onto accentuationPattern instructions (${sample.length} -> ${mapped.length})`)
    check(mapped.every(id => tagById.get(id) === 'accentuationPattern'),
        'every mapped id is an accentuationPattern')
    try {
        quiet(() => renderPerformance({ msm: msmXml, mpm: mpmXml, mpmIds: sample, isolate: true }))
        check(true, 'a selection of <accentuation> ids renders under spotlight')
    } catch (error) {
        check(false, `<accentuation> spotlight failed — ${(error as Error).message.split('\n')[0]}`)
    }
}

// An id espressivo cannot place at all must degrade to "no spotlight", never to a throw.
check(resolveSpotlightIds(mpmXml, ['no-such-id']).length === 0, 'unknown ids resolve to nothing')
try {
    quiet(() => renderPerformance({ msm: msmXml, mpm: mpmXml, mpmIds: ['no-such-id'] }))
    check(true, 'an unresolvable selection renders instead of throwing')
} catch (error) {
    check(false, `unresolvable selection threw — ${(error as Error).message.split('\n')[0]}`)
}

// ---------------------------------------------------------------- 4. the sliders
// The exaggeration slider runs 1..2; computeSketchiness(stretchX) returns 1..1.5. The two
// multiply into one scalar, capped at EXPRESSION_MAX because ornamentSpread is a cliff:
// factors up to 2.2 move notes linearly, 2.3 jumps this piece from 159 s to 236 s.
console.log('\n4. exaggeration x sketchiness')
const durations: { at: string; seconds: number; notes: number }[] = []
for (const [exaggerate, sketchiness] of
    [[1, 1], [1.2, 1], [1.5, 1], [2, 1], [1, 1.5], [1.5, 1.5], [2, 1.5]] as const) {
    try {
        const midiBytes = quiet(() => renderPerformance({ msm: msmXml, mpm: mpmXml, exaggerate, sketchiness }))
        const file = read(toArrayBuffer(midiBytes))
        let notes = 0, last = 0
        for (const track of file.tracks) {
            let abs = 0
            for (const ev of track) {
                abs += ev.deltaTime
                if (ev.type === 'channel' && ev.subtype === 'noteOn' && ev.velocity > 0) {
                    notes++; last = Math.max(last, abs)
                }
            }
        }
        durations.push({ at: `${exaggerate}x/${sketchiness}`, seconds: last / 1000, notes })
        console.log(`    exaggerate ${exaggerate}, sketchiness ${sketchiness}: ${(last / 1000).toFixed(1)} s, ${notes} notes`)
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

console.log(problems.length ? `\nFAIL — ${problems.length} problem(s)` : '\nOK — espressivo matches the backend it replaces')
process.exit(problems.length ? 1 : 0)
