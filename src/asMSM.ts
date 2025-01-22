import { MSM } from "mpmify"
import { loadVerovio } from "./loadVerovio.mts"
import { MsmNote, MsmPedal } from "mpmify/lib/msm";

const qstampToTstamp = (qstamp: number, ppq: number = 720) => {
    return Math.round(qstamp * ppq)
}

type MEINote = {
    index: number;
    id: string;
    qstamp: number;
    pnum: number;
    duration: number;
    part: number;

    // the following parameters are optional:
    // they are useful for visualizing and 
    // further processing an alignment, but not
    // strictly necessary
    pname?: string;
    accid?: number;
    octave?: number;
};

// transform timemap to notes array
const allNotes = async (mei: string): Promise<MEINote[]> => {
    const tk = await loadVerovio()
    tk.loadData(mei)
    const timemap = tk.renderToTimemap()

    const scoreDOM = new DOMParser().parseFromString(mei, 'application/xml')

    const result: MEINote[] = []
    let index = 0
    for (const event of timemap) {
        if (!event.on) continue
        for (const on of event.on) {
            const midiValues = tk.getMIDIValuesForElement(on)
            const offTime = timemap.find((event) => event.off && event.off.includes(on))?.qstamp || 0

            // using query selector with [*|id='...'] does not work 
            // yet with JSDOM, therefore this workaround
            const noteEl = Array.from(scoreDOM.querySelectorAll('note')).find(el => el.getAttribute('xml:id') === on)
            if (!noteEl) continue

            const staff = noteEl.closest('staff')
            if (!staff) continue

            // ignore the note if its tied
            if (scoreDOM.querySelector(`tie[endid='#${on}']`)) {
                continue
            }

            if (Number(staff.getAttribute('n')) === 1) {
                // console.log('times for', noteEl?.getAttribute('pname'))
                // console.log(this.vrvToolkit.getTimesForElement(on))
            }

            result.push({
                index: index,
                id: on,
                qstamp: event.qstamp,
                octave: Number(noteEl?.getAttribute('oct') || 0),
                pname: noteEl?.getAttribute('pname') || '',
                accid: Array.from(noteEl?.getAttribute('accid.ges') || noteEl?.getAttribute('accid') || '').reduce((acc, curr) => {
                    if (curr === 'f') return acc - 1
                    else if (curr === 's') return acc + 1
                    return acc
                }, 0),
                pnum: midiValues.pitch,
                duration: offTime - event.qstamp,
                part: Number(staff.getAttribute('n'))
            })
            index += 1
        }
    }

    return result
}

export const asMSM = async (mei: string) => {
    const scoreDOM = new DOMParser().parseFromString(mei, 'application/xml')

    const msmNotes = (await allNotes(mei)).reduce((acc, note) => {
        const when = scoreDOM.querySelector(`when[data~="#${note.id}"]`)
        if (!when) return acc

        const absolute = when.getAttribute('absolute')?.replace('ms', '')
        const duration = when.querySelector('extData[type="duration"]')?.textContent?.replace('ms', '')
        const velocity = when.querySelector('extData[type="velocity"]')?.textContent
        if (!absolute || !duration || !velocity) return acc

        acc.push({
            'part': note.part,
            'xml:id': note.id,
            'date': qstampToTstamp(note.qstamp),
            'duration': qstampToTstamp(note.duration),
            'pitchname': note.pname!,
            'octave': note.octave!,
            'accidentals': note.accid!,
            'midi.pitch': note.pnum,
            relativeVolume: 0,

            // performance stuff
            'midi.onset': +absolute / 1000,
            'midi.duration': +duration / 1000,
            'midi.velocity': +velocity
        })
        return acc;
    }, [] as MsmNote[])

    const msmPedals = Array
        .from(scoreDOM.querySelectorAll('when[type="sustain"], when[type="soft"]')).map((when, index) => {
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

    const newMSM = new MSM(msmNotes, { numerator: 4, denominator: 4 })
    newMSM.pedals = msmPedals
    return newMSM
}

