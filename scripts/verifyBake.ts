/**
 * Verifies that the baked MEI is equivalent to running MakeChoice + Modify over
 * the original one.
 *
 *   reference = asMSM(original MEI) -> MakeChoice + Modify from original info.json
 *   actual    = asMSM(baked MEI)    (no MakeChoice/Modify left to run)
 *
 * Both note sets must match on id, onset, duration and velocity. Same for pedals.
 *
 * Usage:
 *   node_modules/.bin/vite-node scripts/verifyBake.ts -- \
 *     --original-mei <path> --original-info <path> [--mei path]
 */
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { MSM, MPM, MakeChoice, Modify, compareTransformers } from 'mpmify'
import type { MsmNote, MsmPedal, Transformer } from 'mpmify'

const BACKEND = process.env.MPM_BACKEND_URL ?? 'http://localhost:8080'

const argv = process.argv.slice(2)
const opt = (name: string, fallback: string) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const originalMeiPath = opt('original-mei', '')
const originalInfoPath = opt('original-info', '')
const bakedMeiPath = opt('mei', 'public/transcription.mei')

if (!originalMeiPath || !originalInfoPath) {
    console.error('need --original-mei and --original-info')
    process.exit(2)
}

const { DOMParser } = new JSDOM().window

const convertMeiToMsm = async (mei: string): Promise<string> => {
    const response = await fetch(`${BACKEND}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ mei }),
    })
    if (!response.ok) throw new Error(`MEI to MSM conversion failed: ${response.status} ${response.statusText}`)
    return (await response.json() as { msm: string }).msm
}

/** Faithful copy of src/utils/asMSM.ts, minus the console noise. */
const asMSM = (meiDoc: Document, msmDoc: Document) => {
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
                const d = candidate.getAttribute('xml:id'), k = note.getAttribute('xml:id')
                if (d && k) discardedNoteMap.set(d, k)
            } else {
                const d = note.getAttribute('xml:id'), k = candidate.getAttribute('xml:id')
                if (d && k) discardedNoteMap.set(d, k)
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
            when.setAttribute('data', (when.getAttribute('data') || '').replace(`#${discardedId}`, `#${keptId}`))
        }
        if (whens.length) {
            whensByRefId.set(keptId, (whensByRefId.get(keptId) || []).concat(whens))
            whensByRefId.delete(discardedId)
        }
    }

    const msmNotes: MsmNote[] = []
    for (const note of originalNotes) {
        const noteId = note.getAttribute('xml:id')
        for (const when of (noteId ? whensByRefId.get(noteId) || [] : [])) {
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
                source: when.closest('recording')?.getAttribute('source') || undefined,
            } as MsmNote)
        }
    }

    const msmPedals: MsmPedal[] = []
    Array.from(meiDoc.querySelectorAll('when[type="sustain"], when[type="soft"]')).forEach((when, index) => {
        const absolute = when.getAttribute('absolute')?.replace('ms', '')
        const duration = when.querySelector('extData[type="duration"]')?.textContent?.replace('ms', '')
        if (!absolute || !duration) return
        const type = when.getAttribute('type') === 'sustain' ? 'sustain' : 'soft'
        const pedalOnset = +absolute / 1000
        const closest = msmNotes
            .filter(n => typeof n['midi.onset'] === 'number' && n['midi.onset'] >= pedalOnset)
            .sort((a, b) => a['midi.onset'] - b['midi.onset'])[0]
        msmPedals.push({
            'xml:id': closest ? `${type}-${closest.date}` : `pedal-${index}`,
            'midi.onset': pedalOnset,
            'midi.duration': +duration / 1000,
            type,
            source: when.closest('recording')?.getAttribute('source') || undefined,
        } as MsmPedal)
    })

    const ts = msmDoc.querySelector('timeSignature')
    const msm = new MSM(msmNotes, {
        numerator: Number(ts?.getAttribute('numerator') || 4),
        denominator: Number(ts?.getAttribute('denominator') || 4),
    })
    msm.pedals = msmPedals
    return msm
}

const load = async (meiPath: string) => {
    const mei = readFileSync(meiPath, 'utf-8')
    const meiDoc = new DOMParser().parseFromString(mei, 'application/xml')
    const msmDoc = new DOMParser().parseFromString(await convertMeiToMsm(mei), 'application/xml')
    return asMSM(meiDoc, msmDoc)
}

const noteKey = (n: MsmNote) => `${n['xml:id']}|${n.date}|${n['midi.pitch']}`
const noteValue = (n: MsmNote) =>
    `${n['midi.onset'].toFixed(6)}|${n['midi.duration'].toFixed(6)}|${n['midi.velocity']}`
const pedalKey = (p: MsmPedal) => `${p.type}|${p['midi.onset'].toFixed(6)}`
const pedalValue = (p: MsmPedal) => `${p['midi.duration'].toFixed(6)}`

const main = async () => {
    // reference: original MEI with the transformers applied at runtime
    const reference = await load(originalMeiPath)
    const info = JSON.parse(readFileSync(originalInfoPath, 'utf-8'))
    const calls = (info.creation?.argumentations ?? [])
        .flatMap((a: { calls?: { id: string; name: string; options: unknown; created: string[] }[] }) => a.calls ?? [])

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
    transformers.sort(compareTransformers)

    const log = console.log
    console.log = () => { }
    transformers.forEach(t => t.run(reference, new MPM()))
    console.log = log

    // actual: baked MEI, read as-is
    const actual = await load(bakedMeiPath)

    console.log(`reference: ${reference.allNotes.length} notes, ${reference.pedals.length} pedals`)
    console.log(`baked:     ${actual.allNotes.length} notes, ${actual.pedals.length} pedals`)

    const problems: string[] = []

    const refNotes = new Map(reference.allNotes.map(n => [noteKey(n), n]))
    const actNotes = new Map(actual.allNotes.map(n => [noteKey(n), n]))
    if (refNotes.size !== reference.allNotes.length) problems.push('reference note keys are not unique')
    if (actNotes.size !== actual.allNotes.length) problems.push('baked note keys are not unique')

    for (const [key, ref] of refNotes) {
        const act = actNotes.get(key)
        if (!act) { problems.push(`missing note ${key}`); continue }
        if (noteValue(ref) !== noteValue(act)) {
            problems.push(`note ${key}: expected ${noteValue(ref)}, got ${noteValue(act)}`)
        }
    }
    for (const key of actNotes.keys()) if (!refNotes.has(key)) problems.push(`unexpected note ${key}`)

    const refPedals = new Map(reference.pedals.map(p => [pedalKey(p), p]))
    const actPedals = new Map(actual.pedals.map(p => [pedalKey(p), p]))
    for (const [key, ref] of refPedals) {
        const act = actPedals.get(key)
        if (!act) { problems.push(`missing pedal ${key}`); continue }
        if (pedalValue(ref) !== pedalValue(act)) {
            problems.push(`pedal ${key}: expected ${pedalValue(ref)}, got ${pedalValue(act)}`)
        }
    }
    for (const key of actPedals.keys()) if (!refPedals.has(key)) problems.push(`unexpected pedal ${key}`)

    if (problems.length) {
        console.log(`\nFAIL — ${problems.length} mismatch(es):`)
        problems.slice(0, 40).forEach(p => console.log('  ' + p))
        if (problems.length > 40) console.log(`  … and ${problems.length - 40} more`)
        process.exit(1)
    }
    console.log('\nOK — baked MEI is equivalent to original + MakeChoice + Modify')
}

main().catch(err => { console.error(err); process.exit(1) })
