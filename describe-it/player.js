/* Playback transport: schedules notes through the sampled piano, and a hummed line with them. */
/* global window, setInterval, clearInterval */
import { createPiano } from './piano.js';
import { createVoice } from './voice.js';

const LOOKAHEAD_MS = 1200;
const TICK_MS = 50;
const LEAD_IN_S = 0.08;

/**
 * Creates the transport. Times are in milliseconds.
 *
 * @typedef {{ ms: number, end: number, pitch: number, velocity: number, pan?: number }} Key
 * @param {object} listeners
 * @param {() => void} listeners.onChange playback started or stopped
 * @param {() => void} listeners.onEnd playback reached the end of the range
 * @param {(done: number, total: number) => void} listeners.onLoading sample loading progress
 */
export function createPlayer({ onChange, onEnd, onLoading }) {
  let audio = null;
  let piano = null;
  let voice = null;
  let output = null;
  let run = null;
  let timer = 0;
  let loading = false;

  const open = () => {
    if (audio) return true;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return false;
    audio = new Context();
    // The samples are recorded loud; without a limiter chords clip.
    const limiter = audio.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 4;
    limiter.connect(audio.destination);
    output = audio.createGain();
    output.gain.value = 0.5;
    output.connect(limiter);
    piano = createPiano(audio);
    voice = createVoice(audio);
    return true;
  };

  const position = () => run.from + (audio.currentTime - run.startedAt) * 1000;
  const timeOf = (ms) => run.startedAt + (ms - run.from) / 1000;

  const schedule = () => {
    if (!run) return;
    const now = position();
    if (now >= run.until) {
      halt();
      onEnd();
      return;
    }
    while (run.next < run.keys.length && run.keys[run.next].ms < now + LOOKAHEAD_MS) {
      const key = run.keys[run.next++];
      const when = timeOf(key.ms);
      if (when < audio.currentTime - 0.03) continue;
      piano.strike({ ...key, when: Math.max(when, audio.currentTime), off: timeOf(Math.min(key.end, run.until)) }, output);
    }
  };

  const queue = (keys) => {
    const now = Math.max(position(), run.from);
    run.keys = keys.filter((key) => key.ms >= now - 20 && key.ms < run.until);
    run.next = 0;
  };

  const halt = () => {
    if (!run) return;
    clearInterval(timer);
    piano.hush();
    voice.hush();
    run = null;
    onChange();
  };

  return {
    /**
     * Plays `keys` (a `Key[]` sorted by `ms`) from `from` to `until`; resolves to whether it started.
     * `line` is a sung line on the same clock (`lineOf` in voice.js), hummed along; `exaggerate`
     * is how much more than the piano its loudness moves.
     */
    async play(keys, { from, until, line, exaggerate }) {
      if (!open()) return false;
      halt();
      if (audio.state === 'suspended') audio.resume();
      if (!keys.length || loading) return false;
      if (!piano.ready(keys)) {
        loading = true;
        try {
          await piano.load(keys, onLoading);
        } catch {
          return false;
        } finally {
          loading = false;
        }
      }
      run = { from, until, startedAt: audio.currentTime + LEAD_IN_S, keys: [], next: 0 };
      queue(keys);
      if (line && line.length) voice.hum(line, timeOf, output, { exaggerate });
      timer = setInterval(schedule, TICK_MS);
      schedule();
      onChange();
      return true;
    },

    /** Swaps the notes being played, keeping the playback position. */
    replace(keys) {
      if (!run) return;
      piano.hush();
      queue(keys);
      schedule();
      // Retry once missing samples have loaded.
      if (!piano.ready(keys)) piano.load(keys).then(() => run && this.replace(keys), () => undefined);
    },

    stop: halt,

    /** Opens the audio output, which browsers allow only from a user's gesture. */
    unlock() {
      if (open() && audio.state === 'suspended') audio.resume();
    },

    get unlocked() {
      return Boolean(audio) && audio.state === 'running';
    },

    get playing() {
      return Boolean(run);
    },

    get loading() {
      return loading;
    },

    /** Audible position in ms (latency-compensated); undefined when stopped. */
    position() {
      if (!run) return undefined;
      return position() - (audio.outputLatency || audio.baseLatency || 0) * 1000;
    },
  };
}
