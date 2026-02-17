import { AnyEvent, MidiFile } from "midifile-ts";
import { MsmNote } from "mpmify/lib/msm";

export const downloadAsFile = (
    content: string | ArrayBuffer | Blob,
    filename: string,
    mimeType = 'text/plain') => {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

export const asMIDI = (notes_: PartialBy<MsmNote, 'midi.onset' | 'midi.duration'>[]): MidiFile | undefined => {
    if (!notes_.length) return

    const events: AnyEvent[] = []

    type NoteEvent = {
        type: 'on' | 'off',
        at: number,
        pitch: number,
        velocity: number,
        date: number
    }

    const notes = notes_
        .reduce((prev, curr) => {
            prev.push({
                type: 'on',
                at: curr["midi.onset"] === undefined ? (curr.date / 1000) : curr["midi.onset"],
                velocity: curr["midi.velocity"],
                pitch: curr["midi.pitch"],
                date: curr.date
            })

            prev.push({
                type: 'off',
                at: (curr["midi.onset"] === undefined ? (curr.date / 1000) : curr["midi.onset"]) + (curr["midi.duration"] || (curr.duration / 1000)),
                velocity: curr["midi.velocity"],
                pitch: curr["midi.pitch"],
                date: curr.date + curr.duration
            })

            return prev
        }, [] as NoteEvent[])
        .sort((a, b) => a.at - b.at)

    const initialTime = notes[0].at
    for (const note of notes) note.at -= initialTime

    let currentTime = 0
    events.push({
        type: 'meta',
        subtype: 'setTempo',
        microsecondsPerBeat: 1000,
        deltaTime: 0
    })
    for (const event of notes) {
        const deltaTimeMs = (event.at - currentTime) * 1000

        if (event.type === 'on') {
            if (event.velocity > 0) {
                events.push({
                    type: 'channel',
                    subtype: 'noteOn',
                    noteNumber: event.pitch,
                    velocity: +event.velocity.toFixed(0),
                    deltaTime: deltaTimeMs,
                    channel: 0
                })
            }

            events.push({
                type: 'meta',
                subtype: 'text',
                text: event.date.toString(),
                deltaTime: 0
            })
        }
        else if (event.type === 'off') {
            events.push({
                type: 'channel',
                subtype: 'noteOff',
                noteNumber: event.pitch,
                velocity: +event.velocity.toFixed(0),
                deltaTime: deltaTimeMs,
                channel: 0
            })
        }

        currentTime = event.at
    }

    return {
        header: {
            ticksPerBeat: 1,
            formatType: 0,
            trackCount: 1
        },
        tracks: [events]
    }
}
