import { AnyEvent, MidiFile } from "midifile-ts";
import { MsmNote } from "mpmify/lib/msm";

export const randomColor = () => {
    const red = Math.floor(Math.random() * 256);
    const green = Math.floor(Math.random() * 256);
    const blue = Math.floor(Math.random() * 256);
    return `rgb(${red}, ${green}, ${blue})`;
}

export const downloadAsFile = (
    content: string,
    filename: string,
    mimeType = 'text/plain') => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export const asMIDI = (notes_: MsmNote[]): MidiFile | undefined => {
    if (!notes_.length) return 

    const events: AnyEvent[] = []

    type NoteEvent = { type: 'on' | 'off', at: number, pitch: number, velocity: number }
    const notes = notes_
        .filter(note => note["midi.onset"] !== undefined && note['midi.duration'] !== undefined)
        .reduce((prev, curr) => {
            prev.push({
                type: 'on',
                at: curr["midi.onset"],
                velocity: curr["midi.velocity"],
                pitch: curr["midi.pitch"]
            })

            prev.push({
                type: 'off',
                at: curr["midi.onset"] + curr["midi.duration"],
                velocity: curr["midi.velocity"],
                pitch: curr["midi.pitch"]
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
            events.push({
                type: 'channel',
                subtype: 'noteOn',
                noteNumber: event.pitch,
                velocity: +event.velocity.toFixed(0),
                deltaTime: deltaTimeMs,
                channel: 0
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
