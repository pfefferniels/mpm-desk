import { AnyEvent, MidiFile } from "midifile-ts";
import { MsmNote } from "mpmify/lib/msm";
import { Range } from "../tempo/Tempo";

export const randomColor = () => {
    const red = Math.floor(Math.random() * 256);
    const green = Math.floor(Math.random() * 256);
    const blue = Math.floor(Math.random() * 256);
    return `rgb(${red}, ${green}, ${blue})`;
}

function interpolateColor(color1: [number, number, number], color2: [number, number, number], factor: number): [number, number, number] {
    return [
        color1[0] + factor * (color2[0] - color1[0]),
        color1[1] + factor * (color2[1] - color1[1]),
        color1[2] + factor * (color2[2] - color1[2])
    ];
}

export function numberToColor(num: number, range: Range): string {
    // Ensure the number is within the specified range
    if (num < range.start) {
        num = range.start
    }
    else if (num > range.end) {
        num = range.end
    }

    // Normalize the number to a value between 0 and 1 within the specified range
    const normalized = (num - range.start) / (range.end - range.start);

    // Define the three colors: green, gray, and red in HSL
    const green: [number, number, number] = [120, 100, 50]; // Green
    const gray: [number, number, number] = [0, 0, 50];     // Gray
    const red: [number, number, number] = [0, 100, 50];    // Red

    let color: [number, number, number];
    if (normalized <= 0.5) {
        // Interpolate between green and gray
        const factor = normalized / 0.5;
        color = interpolateColor(green, gray, factor);
    } else {
        // Interpolate between gray and red
        const factor = (normalized - 0.5) / 0.5;
        color = interpolateColor(gray, red, factor);
    }

    // Convert to HSL color string
    return `hsl(${color[0]}, ${color[1]}%, ${color[2]}%)`;
}


export const downloadAsFile = (
    content: string | ArrayBuffer,
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
