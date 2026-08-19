/**
 * One-off migration: bake MakeChoice + Modify into the MEI.
 *
 * Reads a multi-recording MEI plus its info.json, runs the real mpmify
 * MakeChoice/Modify transformers over the derived MSM, and writes back an MEI
 * that carries a single <recording> with all edits already applied. The
 * corresponding calls are stripped from info.json.
 *
 * Needs the mpm-renderer backend on :8080 for the MEI -> MSM conversion.
 *
 * Usage:
 *   node_modules/.bin/vite-node scripts/bakeMei.ts -- [--write] [--mei path] [--info path]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { MSM, MPM, MakeChoice, Modify, compareTransformers } from 'mpmify'
import type { MsmNote, MsmPedal, Transformer } from 'mpmify'

const BACKEND = process.env.MPM_BACKEND_URL ?? 'http://localhost:8080'
const BAKE_IDX = '_bakeidx'

const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(`--${name}`)
const opt = (name: string, fallback: string) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const meiPath = opt('mei', 'public/transcription.mei')
const infoPath = opt('info', 'public/info.json')
const write = flag('write')

const { DOMParser, XMLSerializer } = new JSDOM().window

const convertMeiToMsm = async (mei: string): Promise<string> => {
    const response = await fetch(`${BACKEND}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ mei }),
    })
    if (!response.ok) throw new Error(`MEI to MSM conversion failed: ${response.status} ${response.statusText}`)
    const payload = await response.json() as { msm?: unknown }
    if (typeof payload.msm !== 'string') throw new Error('conversion returned no msm payload')
    return payload.msm
}

/** MSM entities keep a back-reference to the <when> element they came from. */
type TracedNote = MsmNote & { [BAKE_IDX]?: number }
type TracedPedal = MsmPedal & { [BAKE_IDX]?: number }

const warnings: string[] = []

/**
 * Mirrors src/utils/asMSM.ts, but tags every note/pedal with the index of the
 * <when> element it was derived from.
 */
const buildMSM = (meiDoc: Document, msmDoc: Document, indexOfWhen: Map<Element, number>) => {
    const discardedNoteMap = new Map<string, string>()
    const notesByKey = new Map<string, Element>()
    const originalNotes: Element[] = []

    for (const note of msmDoc.querySelectorAll('note')) {
        const key = `${note.getAttribute('date')}-${note.getAttribute('midi.pitch')}`
        const candidate = notesByKey.get(key)
        if (candidate) {
            if (+(note.getAttribute('duration') || 0) > +(candidate.getAttribute('duration') || 0)) {
                originalNotes[originalNotes.indexOf(candidate)] = note
                notesByKey.set(key, note)
                const discardedId = candidate.getAttribute('xml:id')
                const keptId = note.getAttribute('xml:id')
                if (discardedId && keptId) discardedNoteMap.set(discardedId, keptId)
            } else {
                const discardedId = note.getAttribute('xml:id')
                const keptId = candidate.getAttribute('xml:id')
                if (discardedId && keptId) discardedNoteMap.set(discardedId, keptId)
            }
        } else {
            notesByKey.set(key, note)
            originalNotes.push(note)
        }
    }

    const whensByRefId = new Map<string, Element[]>()
    for (const when of meiDoc.querySelectorAll('when[data]')) {
        for (const token of (when.getAttribute('data') || '').split(/\s+/)) {
            if (!token.startsWith('#')) continue
            const refId = token.slice(1)
            const list = whensByRefId.get(refId) ?? []
            list.push(when)
            whensByRefId.set(refId, list)
        }
    }

    for (const [discardedId, keptId] of discardedNoteMap) {
        const whens = whensByRefId.get(discardedId) || []
        for (const when of whens) {
            const currentData = when.getAttribute('data') || ''
            when.setAttribute('data', currentData.replace(`#${discardedId}`, `#${keptId}`))
        }
        if (whens.length) {
            whensByRefId.set(keptId, (whensByRefId.get(keptId) || []).concat(whens))
            whensByRefId.delete(discardedId)
        }
    }

    const msmNotes: TracedNote[] = []
    for (const note of originalNotes) {
        const noteId = note.getAttribute('xml:id')
        const whens = noteId ? (whensByRefId.get(noteId) || []) : []
        if (whens.length === 0) continue

        for (const when of whens) {
            const source = when.closest('recording')?.getAttribute('source') || undefined
            const absolute = when.getAttribute('absolute')?.replace('ms', '')
            const duration = when.querySelector('extData[type="duration"]')?.textContent?.replace('ms', '')
            const velocity = when.querySelector('extData[type="velocity"]')?.textContent
            if (!absolute || !duration || !velocity) continue

            msmNotes.push({
                part: Number(note.closest('part')?.getAttribute('number')),
                'xml:id': noteId!,
                date: Number(note.getAttribute('date')),
                duration: Number(note.getAttribute('duration')),
                pitchname: note.getAttribute('pitchname') || '',
                octave: Number(note.getAttribute('octave')),
                accidentals: Number(note.getAttribute('accidentals')),
                'midi.pitch': Number(note.getAttribute('midi.pitch')),
                'midi.onset': +absolute / 1000,
                'midi.duration': +duration / 1000,
                'midi.velocity': +velocity,
                source,
                [BAKE_IDX]: indexOfWhen.get(when) ?? -1,
            } as TracedNote)
        }
    }

    const msmPedals: TracedPedal[] = []
    Array.from(meiDoc.querySelectorAll('when[type="sustain"], when[type="soft"]')).forEach((when, index) => {
        const absolute = when.getAttribute('absolute')?.replace('ms', '')
        const duration = when.querySelector('extData[type="duration"]')?.textContent?.replace('ms', '')
        if (!absolute || !duration) return

        const type = when.getAttribute('type') === 'sustain' ? 'sustain' : 'soft'
        const source = when.closest('recording')?.getAttribute('source') || undefined
        const pedalOnset = +absolute / 1000
        const closest = msmNotes
            .filter(n => typeof n['midi.onset'] === 'number' && n['midi.onset'] >= pedalOnset)
            .sort((a, b) => a['midi.onset'] - b['midi.onset'])[0]

        msmPedals.push({
            'xml:id': closest ? `${type}-${closest.date}` : `pedal-${index}`,
            'midi.onset': pedalOnset,
            'midi.duration': +duration / 1000,
            type,
            source,
            [BAKE_IDX]: indexOfWhen.get(when) ?? -1,
        } as TracedPedal)
    })

    const timeSignature = msmDoc.querySelector('timeSignature')
    const msm = new MSM(msmNotes, {
        numerator: Number(timeSignature?.getAttribute('numerator') || 4),
        denominator: Number(timeSignature?.getAttribute('denominator') || 4),
    })
    msm.pedals = msmPedals
    return msm
}

interface Call { id: string; name: string; options: Record<string, unknown>; created: string[] }

const buildTransformers = (calls: Call[]): Transformer[] => {
    const transformers: Transformer[] = []
    for (const call of calls) {
        let t: Transformer | null = null
        if (call.name === 'MakeChoice') t = new MakeChoice()
        else if (call.name === 'Modify') t = new Modify()
        if (!t) continue
        t.id = call.id
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        t.options = call.options as any
        t.created = call.created ?? []
        transformers.push(t)
    }
    return transformers.sort(compareTransformers)
}

const main = async () => {
    const mei = readFileSync(meiPath, 'utf-8')
    const info = JSON.parse(readFileSync(infoPath, 'utf-8'))

    const meiDoc = new DOMParser().parseFromString(mei, 'application/xml')
    const performance = meiDoc.querySelector('performance')
    if (!performance) throw new Error('MEI has no <performance> element')

    const recordings = Array.from(performance.querySelectorAll('recording'))
    const whenEls = Array.from(performance.querySelectorAll('when'))
    const indexOfWhen = new Map(whenEls.map((when, i) => [when, i]))

    console.log(`MEI:  ${recordings.length} recording(s), ${whenEls.length} <when> elements`)
    for (const rec of recordings) {
        console.log(`      ${rec.getAttribute('source')}: ${rec.querySelectorAll('when').length} whens`)
    }

    const msmDoc = new DOMParser().parseFromString(await convertMeiToMsm(mei), 'application/xml')
    const msm = buildMSM(meiDoc, msmDoc, indexOfWhen)
    console.log(`MSM:  ${msm.allNotes.length} notes, ${msm.pedals.length} pedals (before baking)`)

    const calls: Call[] = (info.creation?.argumentations ?? []).flatMap((a: { calls?: Call[] }) => a.calls ?? [])
    const transformers = buildTransformers(calls)
    console.log(`Baking ${transformers.filter(t => t.name === 'MakeChoice').length} MakeChoice + ` +
        `${transformers.filter(t => t.name === 'Modify').length} Modify`)

    // capture pre-bake values so we can report what actually changed
    const before = new Map<number, { v: number; o: number; d: number }>()
    for (const note of msm.allNotes as TracedNote[]) {
        before.set(note[BAKE_IDX]!, {
            v: note['midi.velocity'], o: note['midi.onset'], d: note['midi.duration'],
        })
    }
    for (const pedal of msm.pedals as TracedPedal[]) {
        before.set(pedal[BAKE_IDX]!, { v: NaN, o: pedal['midi.onset'], d: pedal['midi.duration'] })
    }

    const mpm = new MPM()
    const log = console.log
    console.log = () => { }   // MakeChoice logs every removed variant
    transformers.forEach(t => t.run(msm, mpm))
    console.log = log

    console.log(`MSM:  ${msm.allNotes.length} notes, ${msm.pedals.length} pedals (after baking)`)

    // ---- which <when> elements survive, and with what values ----
    const survivors = new Map<number, TracedNote | TracedPedal>()
    for (const note of msm.allNotes as TracedNote[]) {
        const idx = note[BAKE_IDX]
        if (idx === undefined || idx < 0) { warnings.push(`note ${note['xml:id']} lost its <when> back-reference`); continue }
        if (survivors.has(idx)) warnings.push(`<when> #${idx} claimed by two notes`)
        survivors.set(idx, note)
    }
    for (const pedal of msm.pedals as TracedPedal[]) {
        const idx = pedal[BAKE_IDX]
        if (idx === undefined || idx < 0) { warnings.push(`pedal ${pedal['xml:id']} lost its <when> back-reference`); continue }
        survivors.set(idx, pedal)
    }

    const tally = (indices: Iterable<number>) => {
        const counts = new Map<string, number>()
        for (const i of indices) {
            const source = whenEls[i].closest('recording')?.getAttribute('source') ?? 'unknown'
            counts.set(source, (counts.get(source) ?? 0) + 1)
        }
        return counts
    }

    console.log('Surviving whens by recording:')
    for (const [source, count] of tally(survivors.keys())) console.log(`      ${source}: ${count}`)
    console.log('Dropped whens by recording:')
    for (const [source, count] of tally(whenEls.map((_, i) => i).filter(i => !survivors.has(i)))) {
        console.log(`      ${source}: ${count}`)
    }

    let velocityChanged = 0, onsetChanged = 0, durationChanged = 0
    for (const [idx, entity] of survivors) {
        const prev = before.get(idx)
        if (!prev) continue
        if ('midi.velocity' in entity && (entity as TracedNote)['midi.velocity'] !== prev.v) velocityChanged++
        if (entity['midi.onset'] !== prev.o) onsetChanged++
        if (entity['midi.duration'] !== prev.d) durationChanged++
    }
    console.log(`Value changes: velocity ${velocityChanged}, onset ${onsetChanged}, duration ${durationChanged}`)

    if (!write) {
        console.log('\n(dry run — pass --write to rewrite the files)')
        if (warnings.length) console.log('WARNINGS:\n  ' + warnings.join('\n  '))
        return
    }

    // ---- rewrite the MEI ----
    const chosenSource = tally(survivors.keys()).entries().reduce(
        (best, entry) => (entry[1] > best[1] ? entry : best), ['unknown', -1] as [string, number]
    )[0]
    const target = recordings.find(r => r.getAttribute('source') === chosenSource)!

    for (const [idx, entity] of survivors) {
        const when = whenEls[idx]
        const prev = before.get(idx)

        if ('midi.velocity' in entity) {
            const el = when.querySelector('extData[type="velocity"]')
            if (el) el.textContent = String(Math.round((entity as TracedNote)['midi.velocity']))
        }
        if (prev && entity['midi.onset'] !== prev.o) {
            when.setAttribute('absolute', `${Math.round(entity['midi.onset'] * 1000)}ms`)
            if (when.querySelector('extData[type="onsetTicks"]')) {
                warnings.push(`<when> #${idx}: onset changed, extData onsetTicks left untouched`)
            }
        }
        if (prev && entity['midi.duration'] !== prev.d) {
            const el = when.querySelector('extData[type="duration"]')
            if (el) el.textContent = `${Math.round(entity['midi.duration'] * 1000)}ms`
            if (when.querySelector('extData[type="durationTicks"]')) {
                warnings.push(`<when> #${idx}: duration changed, extData durationTicks left untouched`)
            }
        }

        // pull survivors from other recordings into the single target recording
        if (when.closest('recording') !== target) target.appendChild(when)
    }

    for (const [when, idx] of indexOfWhen) if (!survivors.has(idx)) when.remove()
    for (const rec of recordings) if (rec !== target) rec.remove()

    // drop manifestations that no longer back a recording
    for (const manifestation of Array.from(meiDoc.querySelectorAll('manifestation'))) {
        if (manifestation.getAttribute('xml:id') !== chosenSource) manifestation.remove()
    }

    // XMLSerializer drops the XML declaration and runs the processing
    // instructions together, so restore the original prolog verbatim.
    const prolog = mei.slice(0, mei.indexOf('<mei'))
    const serialized = new XMLSerializer().serializeToString(meiDoc)
    writeFileSync(meiPath, prolog + serialized.slice(serialized.indexOf('<mei')))
    console.log(`\nwrote ${meiPath} — single recording "${chosenSource}", ${survivors.size} whens`)

    // ---- strip the baked calls from info.json ----
    const bakedNames = new Set(['MakeChoice', 'Modify'])
    let removedCalls = 0, removedArgs = 0
    info.creation.argumentations = (info.creation.argumentations as { calls?: Call[] }[]).filter(a => {
        const kept = (a.calls ?? []).filter(c => !bakedNames.has(c.name))
        removedCalls += (a.calls ?? []).length - kept.length
        a.calls = kept
        if (kept.length === 0) { removedArgs++; return false }
        return true
    })
    writeFileSync(infoPath, JSON.stringify(info, null, 2) + '\n')
    console.log(`wrote ${infoPath} — removed ${removedCalls} calls, ${removedArgs} now-empty argumentations`)

    if (warnings.length) console.log('\nWARNINGS:\n  ' + warnings.join('\n  '))
}

main().catch(err => { console.error(err); process.exit(1) })
