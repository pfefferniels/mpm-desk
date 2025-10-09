import { MSM } from "mpmify"
import { MsmNote, MsmPedal } from "mpmify/lib/msm";
import { v4 } from "uuid";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const asMSM = async (mei: string, _voicesAsParts: boolean = false) => {
    const response = await fetch(`http://localhost:8080/convert`, {
        method: 'POST',
        body: JSON.stringify({
            mei
        })
    })
    if (!response.ok) {
        throw new Error(`Failed to convert MEI to MSM: ${response.statusText}`)
    }

    const json = await response.json()
    const msmDoc = new DOMParser().parseFromString(json.msm, 'application/xml')

    // console.log('All elements', msmDoc.querySelectorAll('*'))

    // Enrich the official MSM with performance information
    const meiDoc = new DOMParser().parseFromString(mei, 'application/xml')

    const originalNotes = msmDoc.querySelectorAll('note')
    const msmNotes: MsmNote[] = []
    for (const note of originalNotes) {
        const noteId = note.getAttribute('xml:id')
        console.log('trying selector', `when[data~="#${noteId}"]`)
        const whens = meiDoc.querySelectorAll(`when[data~="#${noteId}"]`)
        if (!whens) continue

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

                // performance stuff
                'midi.onset': +absolute / 1000,
                'midi.duration': +duration / 1000,
                'midi.velocity': +velocity,
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

            const msmPedal: MsmPedal = {
                'xml:id': `pedal-${index}`,
                'midi.onset': +absolute / 1000,
                'midi.duration': +duration / 1000,
                'type': type,
            }
            return msmPedal
        })
        .filter((pedal) => pedal !== null) as MsmPedal[]

    const timeSignature = msmDoc.querySelector('timeSignature')
    const newMSM = new MSM(msmNotes, {
        numerator: Number(timeSignature?.getAttribute('numerator') || 4),
        denominator: Number(timeSignature?.getAttribute('denominator') || 4)
    })
    newMSM.pedals = msmPedals

    console.log('newmsm', newMSM)
    return newMSM
}
