import { MidiFile, AnyEvent, MIDIControlEvents, NoteOnEvent, NoteOffEvent } from "midifile-ts";
import type { Travel, TravelVertex } from "./pedalTravel";

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

/**
 * One press of a pedal: from the first controller value off rest to the value's return there,
 * with every step between as the line the pedal drew.
 *
 * A switch, 0 and 127 and nothing between, reads as a two-vertex travel and the same bounds it
 * always had. A continuous controller, such as the modelled bellows of a reproducing piano,
 * reads as the whole traversal rather than its crossing of the middle.
 */
export interface PedalSpan extends Span<'sustain' | 'soft'> {
    travel: Travel;
}

export type AnySpan = NoteSpan | PedalSpan

const isNoteOn  = (e: AnyEvent): e is NoteOnEvent  => e.type === 'channel' && e.subtype === 'noteOn';
const isNoteOff = (e: AnyEvent): e is NoteOffEvent => e.type === 'channel' && e.subtype === 'noteOff';

const AT_REST = 0;

const pedalTypeOf = (controller: number): PedalSpan['type'] | undefined =>
    controller === MIDIControlEvents.SUSTAIN ? 'sustain'
        : controller === MIDIControlEvents.SOFT_PEDAL ? 'soft'
            : undefined;

/**
 * Follows one pedal on one channel. A press begins at the first value off rest and ends when the
 * value returns there; every step between is a vertex, and every label seen on the way, which
 * is how a roll's "on" and "off" perforations both reach the press however many steps lie
 * between them.
 */
class PressTracker {
    private open?: { span: PedalSpan; travel: TravelVertex[]; labels: string[] };

    constructor(
        private readonly type: PedalSpan['type'],
        private readonly idAt: (tick: number) => string,
    ) {}

    step(tick: number, ms: number, value: number, label?: string): PedalSpan | undefined {
        if (!this.open) {
            if (value === AT_REST) return undefined;
            this.open = {
                span: { type: this.type, id: this.idAt(tick), onset: tick, offset: 0, onsetMs: ms, offsetMs: 0, travel: [] },
                travel: [],
                labels: [],
            };
        }

        const { span, travel, labels } = this.open;
        travel.push({ ms: ms - span.onsetMs, position: value / 127 });
        if (label) labels.push(label);
        if (value !== AT_REST) return undefined;

        this.open = undefined;
        return { ...span, offset: tick, offsetMs: ms, travel, link: labels.join(' ') || undefined };
    }
}

type NoteOpen = Record<string, NoteSpan | undefined>;    // key = `${channel}:${pitch}`

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
    const presses = new Map<string, PressTracker>();
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

      // ========= PEDALS (CC64, CC67) =========
      if (event.subtype === 'controller') {
        const type = pedalTypeOf(event.controllerType);
        if (type) {
          const key = `${type}:${ch}`;
          const tracker = presses.get(key) ?? new PressTracker(type, (tick) => `${i}-${tick}-${type}-${ch}`);
          presses.set(key, tracker);

          const press = tracker.step(currentTime, onsetMs(currentTime), event.value, bufferedMetaText);
          if (press) resultingSpans.push(press);
          bufferedMetaText = undefined;
          continue;
        }
      }
    }
  }

  return resultingSpans.sort((a, b) => a.onset - b.onset);
};
