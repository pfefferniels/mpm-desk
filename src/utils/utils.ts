import { AnyEvent, MidiFile } from "midifile-ts";
import type { AlignedNote } from "../fitting/alignment";
import { onsetSeconds, soundedSeconds } from "../desks/noteTiming";

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

/** Whether two sets hold the same members — for a state setter that must not re-render on an equal set. */
export const setsEqual = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean => {
    if (a.size !== b.size) return false;
    for (const item of a) {
        if (!b.has(item)) return false;
    }
    return true;
};

/**
 * A few notes as an in-memory MIDI file, for a desk to audition on hover.
 *
 * One tick is one millisecond (`ticksPerBeat: 1`, `microsecondsPerBeat: 1000`), and every note-on
 * carries a text meta event holding the note's **symbolic date**. That is a desk-preview
 * convention and NOT the one `PlaybackProvider` uses — espressivo's render writes the note's
 * `xml:id` into the same slot. Both are here on purpose, and neither can read the other's.
 *
 * ## Absent physical timing means "play it as written"
 *
 * A caller that *deletes* `milliseconds.date` before calling gets the passage on the symbolic
 * grid instead of as recorded, at `date / 1000`. Several desks rely on that to preview a
 * correction against the score rather than against the roll, so the fallback is load-bearing.
 */
export const asMIDI = (
    notes_: PartialBy<AlignedNote, 'milliseconds.date' | 'milliseconds.date.end'>[],
): MidiFile | undefined => {
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
            // Seconds throughout. The alignment holds milliseconds; `noteTiming` is the one
            // place that divides, so that the thousandfold error cannot be written here.
            const at = curr["milliseconds.date"] === undefined
                ? curr.date / 1000
                : onsetSeconds(curr as AlignedNote)
            const held = curr["milliseconds.date.end"] === undefined || curr["milliseconds.date"] === undefined
                ? curr.duration / 1000
                : soundedSeconds(curr as AlignedNote)

            prev.push({
                type: 'on',
                at,
                velocity: curr.velocity,
                pitch: curr["midi.pitch"],
                date: curr.date
            })

            prev.push({
                type: 'off',
                at: at + held,
                velocity: curr.velocity,
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
