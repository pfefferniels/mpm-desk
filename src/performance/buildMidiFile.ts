/**
 * A performance, rendered as MIDI so that it can be heard.
 *
 * Everything the project holds about a performance is a list of notes with a
 * moment and a pitch, whether it came out of a MIDI file, out of the <when>
 * elements of a recording, or out of an alignment. This turns any such list into
 * something the piano can play, and puts the id of each note into the stream as
 * a text event so that whatever is on screen can light up as it sounds.
 *
 * The range is what makes it useful for checking by ear. Listening for whether
 * one bar was aligned rightly should not mean sitting through the four minutes
 * before it, so a caller may ask for any stretch of the performance and get it
 * back rebased to zero. Notes struck inside the range keep their own release
 * even where that falls beyond it: cutting a note off at the boundary would be
 * an artefact of the listening, not something the performer did.
 */

import type { MidiFile, AnyEvent } from "midifile-ts";
import type { RecordingInfo } from "../mei/parseRecordings";

/** A note to sound, and the id of whatever should light up while it sounds. */
export interface PlayableNote {
    id: string;
    pitch: number;
    onsetMs: number;
    offsetMs: number;
    velocity: number;
}

export interface PlayablePedal {
    type: "sustain" | "soft";
    onsetMs: number;
    durationMs: number;
}

/** The stretch of the performance to play, in milliseconds from its start. */
export interface PlayRange {
    fromMs: number;
    toMs: number;
}

interface AbsoluteEvent {
    absTime: number;
    event: AnyEvent;
}

/**
 * The notes and pedal movements of a performance, as a MIDI file starting at
 * the beginning of the range asked for.
 *
 * A pedal already down when the range begins is pressed again at zero rather
 * than left out, or a passage played into the sustain would be heard dry.
 */
export function midiFileOf(
    notes: Iterable<PlayableNote>,
    pedals: Iterable<PlayablePedal> = [],
    range?: PlayRange
): MidiFile {
    const from = range?.fromMs ?? 0;
    const to = range?.toMs ?? Infinity;
    const at = (ms: number) => Math.max(0, Math.round(ms - from));

    const events: AbsoluteEvent[] = [];

    // Tempo: 60 BPM = 1,000,000 µs/beat
    // With ticksPerBeat=1000, 1 tick = 1 ms
    events.push({
        absTime: 0,
        event: {
            deltaTime: 0,
            type: "meta",
            subtype: "setTempo",
            microsecondsPerBeat: 1000000,
        } as AnyEvent,
    });

    for (const note of notes) {
        if (note.onsetMs < from || note.onsetMs > to) continue;

        // Text meta event carrying the note ID (for score following)
        events.push({
            absTime: at(note.onsetMs),
            event: {
                deltaTime: 0,
                type: "meta",
                subtype: "text",
                text: note.id,
            } as AnyEvent,
        });

        events.push({
            absTime: at(note.onsetMs),
            event: {
                deltaTime: 0,
                type: "channel",
                subtype: "noteOn",
                channel: 0,
                noteNumber: note.pitch,
                velocity: note.velocity,
            } as AnyEvent,
        });

        events.push({
            absTime: at(Math.max(note.offsetMs, note.onsetMs)),
            event: {
                deltaTime: 0,
                type: "channel",
                subtype: "noteOff",
                channel: 0,
                noteNumber: note.pitch,
                velocity: 0,
            } as AnyEvent,
        });
    }

    for (const pedal of pedals) {
        if (pedal.onsetMs > to || pedal.onsetMs + pedal.durationMs < from) continue;

        const cc = pedal.type === "sustain" ? 64 : 67;

        events.push({
            absTime: at(pedal.onsetMs),
            event: {
                deltaTime: 0,
                type: "channel",
                subtype: "controller",
                channel: 0,
                controllerType: cc,
                value: 127,
            } as AnyEvent,
        });

        events.push({
            absTime: at(pedal.onsetMs + pedal.durationMs),
            event: {
                deltaTime: 0,
                type: "channel",
                subtype: "controller",
                channel: 0,
                controllerType: cc,
                value: 0,
            } as AnyEvent,
        });
    }

    // End of track
    const maxTime = events.reduce((max, e) => Math.max(max, e.absTime), 0);
    events.push({
        absTime: maxTime + 1,
        event: {
            deltaTime: 0,
            type: "meta",
            subtype: "endOfTrack",
        } as AnyEvent,
    });

    // Sort by absolute time (stable sort preserves insertion order for ties)
    events.sort((a, b) => a.absTime - b.absTime);

    // Convert to delta times
    let prevTime = 0;
    for (const e of events) {
        e.event.deltaTime = e.absTime - prevTime;
        prevTime = e.absTime;
    }

    return {
        header: {
            formatType: 0,
            trackCount: 1,
            ticksPerBeat: 1000,
        },
        tracks: [events.map((e) => e.event)],
    };
}

/**
 * A recording read out of an MEI, as MIDI.
 *
 * The pitch comes from the score rather than from the <when>, which records
 * only when a note sounded; the key of the span map is the note's own id, which
 * is what the rendered score can be found by.
 */
export function buildMidiFile(
    recording: RecordingInfo,
    pitchMap: Map<string, number>,
    range?: PlayRange
): MidiFile {
    const notes: PlayableNote[] = [];

    for (const [noteId, span] of recording.noteSpans) {
        const pitch = pitchMap.get(noteId);
        if (pitch === undefined) continue;

        notes.push({
            id: noteId,
            pitch,
            onsetMs: span.onsetMs,
            offsetMs: span.offsetMs,
            velocity: span.velocity,
        });
    }

    return midiFileOf(notes, recording.pedalEvents, range);
}
