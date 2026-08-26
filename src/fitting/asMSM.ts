import { Alignment, AlignedNote, AlignedPedal } from "./alignment"
import { v4 } from "uuid";

/**
 * Enrich a converted MSM with the performance data encoded in the MEI.
 *
 * @param mei the source MEI, whose `<performance>` holds the onsets, durations and velocities
 * @param msmXml the same MEI converted to MSM — see `utils/espressivo.convertMei`
 */
export const asMSM = (mei: string, msmXml: string) => {
    const msmDoc = new DOMParser().parseFromString(msmXml, 'application/xml')

    // Enrich the official MSM with performance information
    const meiDoc = new DOMParser().parseFromString(mei, 'application/xml')

    const discardedNoteMap = new Map<string, string>()

    // O(N) duplicate detection using a Map keyed by "date-midiPitch"
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

    // Pre-index all when[data] elements by referenced ID for O(1) lookup
    const whensByRefId = new Map<string, Element[]>()
    for (const when of meiDoc.querySelectorAll('when[data]')) {
        const data = when.getAttribute('data') || ''
        for (const token of data.split(/\s+/)) {
            if (token.startsWith('#')) {
                const refId = token.slice(1)
                let list = whensByRefId.get(refId)
                if (!list) {
                    list = []
                    whensByRefId.set(refId, list)
                }
                list.push(when)
            }
        }
    }

    // Reassign performance data from discarded duplicate notes to the longer note
    for (const [discardedId, keptId] of discardedNoteMap) {
        const whens = whensByRefId.get(discardedId) || []
        for (const when of whens) {
            console.warn(`Duplicate onset: reassigning performance data from #${discardedId} to #${keptId}`)
            const currentData = when.getAttribute('data') || ''
            when.setAttribute('data', currentData.replace(`#${discardedId}`, `#${keptId}`))
        }
        // Update index: move entries from discardedId to keptId
        if (whens.length) {
            const existing = whensByRefId.get(keptId) || []
            whensByRefId.set(keptId, existing.concat(whens))
            whensByRefId.delete(discardedId)
        }
    }

    // Collect notes with performance data
    const msmNotes: AlignedNote[] = []
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
                'xml:id': note.getAttribute('xml:id') || v4(),
                'date': Number(note.getAttribute('date')),
                'duration': Number(note.getAttribute('duration')),
                'pitchname': note.getAttribute('pitchname') || '',
                'octave': Number(note.getAttribute('octave')),
                'accidentals': Number(note.getAttribute('accidentals')),
                'midi.pitch': Number(note.getAttribute('midi.pitch')),

                // performance stuff. the MEI states both in milliseconds already, and MSM wants
                // an absolute release rather than a length
                'milliseconds.date': +absolute,
                'milliseconds.date.end': +absolute + (+duration),
                velocity: +velocity,
                source
            })
        }
    }

    const msmPedals = Array
        .from(meiDoc.querySelectorAll('when[type="sustain"], when[type="soft"]')).map((when, index) => {
            const absolute = when.getAttribute('absolute')?.replace('ms', '')
            const duration = when.querySelector('extData[type="duration"]')?.textContent?.replace('ms', '')
            if (!absolute || !duration) return null

            const type = when.getAttribute('type') === 'sustain' ? 'sustain' : 'soft'
            const source = when.closest('recording')?.getAttribute('source') || undefined

            // find the closest following MSM note by onset (>= pedalOnset)
            const pedalOnset = +absolute
            const followingNotes = msmNotes.filter(n => typeof n['milliseconds.date'] === 'number' && n['milliseconds.date'] >= pedalOnset)
            const closest = followingNotes.sort((a, b) => (a['milliseconds.date'] - b['milliseconds.date']))[0]
            const xmlId = closest ? `${type}-${closest.date}` : `pedal-${index}`

            const msmPedal: AlignedPedal = {
                'xml:id': xmlId,
                'milliseconds.date': pedalOnset,
                'milliseconds.date.end': pedalOnset + (+duration),
                'type': type,
                source
            }
            return msmPedal
        })
        .filter((pedal) => pedal !== null) as AlignedPedal[]

    const timeSignature = msmDoc.querySelector('timeSignature')
    const newMSM = new Alignment(msmNotes, {
        numerator: Number(timeSignature?.getAttribute('numerator') || 4),
        denominator: Number(timeSignature?.getAttribute('denominator') || 4)
    })
    newMSM.pedals = msmPedals

    return newMSM
}
