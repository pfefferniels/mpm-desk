import { MidiFile, AnyEvent, MIDIControlEvents, NoteOnEvent, NoteOffEvent } from "midifile-ts";

/** What MIDI means by a beat when a file never says otherwise: 120 bpm */
const DEFAULT_TEMPO = 500000;

type Tempo = { atTick: number; microsecondsPerBeat: number };

/** Every setTempo of the file, in absolute ticks - they live in their own track */
function readTempoMap(file: MidiFile): Tempo[] {
    const tempos: Tempo[] = [];

    for (const track of file.tracks) {
        let atTick = 0;
        for (const event of track) {
            atTick += event.deltaTime;
            if (event.type === "meta" && event.subtype === "setTempo") {
                tempos.push({ atTick, microsecondsPerBeat: event.microsecondsPerBeat });
            }
        }
    }

    return tempos.sort((a, b) => a.atTick - b.atTick);
}

/**
 * The time a tick falls at, integrated over the tempo map.
 *
 * A tempo change only affects what comes after it, so the elapsed time is the sum
 * of each stretch at the tempo in force over that stretch. Scaling the whole tick
 * count by the tempo in force at the end instead would rewrite the history of the
 * performance every time the tempo moves - on a Welte roll, which accelerates
 * throughout, by several seconds.
 */
function midiTickToMilliseconds(ticks: number, tempos: Tempo[], ppq: number): number {
    let milliseconds = 0;
    let from = 0;
    let microsecondsPerBeat = tempos[0]?.microsecondsPerBeat ?? DEFAULT_TEMPO;

    for (const tempo of tempos) {
        if (tempo.atTick >= ticks) break;

        milliseconds += ((tempo.atTick - from) / ppq) * microsecondsPerBeat / 1000;
        from = tempo.atTick;
        microsecondsPerBeat = tempo.microsecondsPerBeat;
    }

    return milliseconds + ((ticks - from) / ppq) * microsecondsPerBeat / 1000;
}

interface Span<T extends string> {
    type: T
    id: string
    onset: number
    offset: number

    onsetMs: number
    offsetMs: number

    link?: string
}

export interface NoteSpan extends Span<'note'> {
    pitch: number;
    velocity: number;
    channel: number;
}

export type SustainSpan = Span<'sustain'>
export type SoftSpan = Span<'soft'>

export type AnySpan = NoteSpan | SustainSpan | SoftSpan

const isNoteOn  = (e: AnyEvent): e is NoteOnEvent  => e.type === 'channel' && e.subtype === 'noteOn';
const isNoteOff = (e: AnyEvent): e is NoteOffEvent => e.type === 'channel' && e.subtype === 'noteOff';

const sustainIsOn = (value: number) => value >= 64; // clearer boundary
const softIsOn    = (value: number) => value >= 64;

type SustainOpen = Record<number, SustainSpan | undefined>; // by MIDI channel 0..15
type SoftOpen    = Record<number, SoftSpan | undefined>;
type NoteOpen    = Record<string, NoteSpan | undefined>;    // key = `${channel}:${pitch}`

export const asSpans = (file: MidiFile, readLinks = false) => {
  const resultingSpans: AnySpan[] = [];

  // Read in full before anything is timed: the tempo map is usually a track of
  // its own, and the notes in later tracks are timed against all of it
  const tempoMap = readTempoMap(file);
  let bufferedMetaText: string | undefined;

  // per-track iteration is fine, but don't confuse track index with MIDI channel
  for (let i = 0; i < file.tracks.length; i++) {
    const track = file.tracks[i];
    let currentTime = 0;

    // per-track open maps (you could hoist to overall file scope if preferred)
    const sustainOpen: SustainOpen = {};
    const softOpen: SoftOpen = {};
    const noteOpen: NoteOpen = {};

    for (const event of track) {
      currentTime += event.deltaTime;

      if (event.type === 'meta' && event.subtype === 'setTempo') continue;

      if (readLinks && event.type === 'meta' && event.subtype === 'text') {
        bufferedMetaText = event.text;
        continue;
      }

      const onsetMs  = (ticks: number) => midiTickToMilliseconds(ticks, tempoMap, file.header.ticksPerBeat);
      const offsetMs = onsetMs;

      if (event.type !== 'channel') continue; // we only handle channel events below

      const ch = event.channel

      // ========= NOTES =========
      if (isNoteOn(event)) {
        const key = `${ch}:${event.noteNumber}`;
        // if a duplicate note-on arrives without off, close-and-emit or ignore; here we ignore duplicates
        if (!noteOpen[key]) {
          noteOpen[key] = {
            type: 'note',
            id: `${i}-${currentTime}-note-${ch}-${event.noteNumber}`,
            onset: currentTime,
            offset: 0,
            onsetMs: onsetMs(currentTime),
            offsetMs: 0,
            pitch: event.noteNumber,
            velocity: event.velocity,
            channel: ch,
            link: bufferedMetaText
          };
        }
        bufferedMetaText = undefined;
        continue;
      }

      if (isNoteOff(event)) {
        const key = `${ch}:${event.noteNumber}`;
        const span = noteOpen[key];
        if (span) {
          span.offset = currentTime;
          span.offsetMs = offsetMs(currentTime);
          if (bufferedMetaText && span.link) span.link += ` ${bufferedMetaText}`;
          resultingSpans.push(span);
          noteOpen[key] = undefined;
        }
        bufferedMetaText = undefined;
        continue;
      }

      // ========= SUSTAIN (CC64) =========
      if (event.subtype === 'controller' && event.controllerType === MIDIControlEvents.SUSTAIN) {
        const on = sustainIsOn(event.value);
        if (on) {
          // only start if not already down on this channel
          if (!sustainOpen[ch]) {
            sustainOpen[ch] = {
              type: 'sustain',
              id: `${i}-${currentTime}-sustain-${ch}`,
              onset: currentTime,
              offset: 0,
              onsetMs: onsetMs(currentTime),
              offsetMs: 0,
              link: bufferedMetaText
            };
          }
        } else {
          // only end if currently down
          const span = sustainOpen[ch];
          if (span) {
            span.offset = currentTime;
            span.offsetMs = offsetMs(currentTime);
            if (bufferedMetaText && span.link) span.link += ` ${bufferedMetaText}`;
            resultingSpans.push(span);
            sustainOpen[ch] = undefined;
          }
        }
        bufferedMetaText = undefined;
        continue;
      }

      // ========= SOFT PEDAL (CC67) =========
      if (event.subtype === 'controller' && event.controllerType === MIDIControlEvents.SOFT_PEDAL) {
        const on = softIsOn(event.value);
        if (on) {
          if (!softOpen[ch]) {
            softOpen[ch] = {
              type: 'soft',
              id: `${i}-${currentTime}-soft-${ch}`,
              onset: currentTime,
              offset: 0,
              onsetMs: onsetMs(currentTime),
              offsetMs: 0,
              link: bufferedMetaText
            };
          }
        } else {
          const span = softOpen[ch];
          if (span) {
            span.offset = currentTime;
            span.offsetMs = offsetMs(currentTime);
            if (bufferedMetaText && span.link) span.link += ` ${bufferedMetaText}`;
            resultingSpans.push(span);
            softOpen[ch] = undefined;
          }
        }
        bufferedMetaText = undefined;
        continue;
      }
    }
  }

  return resultingSpans.sort((a, b) => a.onset - b.onset);
};



