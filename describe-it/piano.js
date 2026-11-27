/* Sampled piano on the Web Audio API: Salamander samples, played as `@tonejs/piano` plays them. */
/* global fetch */

/** Recorded layers (of 16) used per layer count; `velocitiesMap` in `@tonejs/piano`. */
const LAYERS = {
  1: [8],
  2: [6, 12],
  3: [1, 7, 15],
  4: [1, 5, 10, 15],
  5: [1, 4, 8, 12, 16],
  6: [1, 3, 7, 10, 13, 16],
  7: [1, 3, 6, 9, 11, 13, 16],
  8: [1, 3, 5, 7, 9, 11, 13, 16],
  9: [1, 3, 5, 7, 9, 11, 13, 15, 16],
  10: [1, 2, 3, 5, 7, 9, 11, 13, 15, 16],
  11: [1, 2, 3, 5, 7, 9, 11, 13, 14, 15, 16],
  12: [1, 2, 3, 4, 5, 7, 9, 11, 13, 14, 15, 16],
  13: [1, 2, 3, 4, 5, 7, 9, 11, 12, 13, 14, 15, 16],
  14: [1, 2, 3, 4, 5, 6, 7, 9, 11, 12, 13, 14, 15, 16],
  15: [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16],
  16: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
};

// Tone's `Sampler` settings: +3 dB, and a 0.4 s exponential release.
const LEVEL = 10 ** (3 / 20);
const RELEASE = 0.4;
const DAMPING = Math.log(RELEASE + 1) / Math.log(200);

const HUSH = 0.2;

/** Nearest sampled key: every third key from A0 to C8, so at most a semitone away. */
const sampledKey = (pitch) => Math.min(108, Math.max(21, 3 * Math.round(pitch / 3)));

const fileOf = (key, layer) => `${['C', 'Ds', 'Fs', 'A'][(key % 12) / 3]}${Math.floor(key / 12) - 1}v${layer}.mp3`;

/** Layer and gain for a velocity: per band the gain rises from 0.5 to 1.5, without crossfade. */
const layerOf = (velocity, layers) => {
  const force = Math.min(Math.max(velocity, 0), 127) / 127;
  const scaled = force * (layers.length - 0.01) - 0.5;
  const index = Math.max(Math.round(scaled), 0);
  return { layer: layers[index], gain: layers.length === 1 ? force : 1 + scaled - index };
};

/**
 * Creates a sampled piano on an audio context.
 *
 * - `load(keys, onProgress?)` fetches the samples for `{ pitch, velocity }` keys; cached.
 * - `ready(keys)` tells whether their samples are loaded.
 * - `strike({ pitch, velocity, when, off, pan }, destination)` plays a note; `when` and `off` are
 *   context times in seconds. A note whose sample is not loaded is skipped.
 * - `hush(when?)` fades out all playing and scheduled notes.
 *
 * @param {AudioContext} audio
 * @param {{ url?: string, velocities?: number }} [options] sample base URL with trailing slash,
 *   and the number of velocity layers (1 to 16)
 */
export function createPiano(audio, { url = 'piano/', velocities = 3 } = {}) {
  const layers = LAYERS[velocities];
  if (!layers) throw new RangeError(`A piano has 1 to 16 velocity layers, not ${velocities}`);
  const buffers = new Map();
  const fetches = new Map();
  const voices = new Set();

  const fileFor = ({ pitch, velocity }) => fileOf(sampledKey(pitch), layerOf(velocity, layers).layer);
  const filesFor = (keys) => [...new Set(keys.map(fileFor))];

  const fetchSample = async (file) => {
    try {
      const response = await fetch(url + file);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      buffers.set(file, await audio.decodeAudioData(await response.arrayBuffer()));
    } catch (cause) {
      fetches.delete(file);
      throw new Error(`The piano sample ${url}${file} could not be loaded: ${cause.message}`, { cause });
    }
  };

  const load = async (keys, onProgress) => {
    const files = filesFor(keys);
    let done = 0;
    onProgress?.(done, files.length);
    await Promise.all(
      files.map(async (file) => {
        if (!fetches.has(file)) fetches.set(file, fetchSample(file));
        await fetches.get(file);
        onProgress?.(++done, files.length);
      }),
    );
  };

  const ready = (keys) => filesFor(keys).every((file) => buffers.has(file));

  /** Tone's release: exponential, then linear over the last tenth of the time. */
  const damp = ({ source, envelope }, level, off) => {
    envelope.gain.setTargetAtTime(0, off, DAMPING);
    envelope.gain.setValueAtTime(level * Math.exp((-0.9 * RELEASE) / DAMPING), off + 0.9 * RELEASE);
    envelope.gain.linearRampToValueAtTime(0, off + RELEASE);
    source.stop(off + RELEASE);
  };

  const strike = ({ pitch, velocity, when = audio.currentTime, off, pan }, destination) => {
    const key = sampledKey(pitch);
    const { gain } = layerOf(velocity, layers);
    const buffer = buffers.get(fileFor({ pitch, velocity }));
    if (!buffer) return;

    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 2 ** ((pitch - key) / 12);
    // Gain is 0 until `when`, so a voice hushed before it starts stays silent.
    const envelope = audio.createGain();
    envelope.gain.setValueAtTime(0, 0);
    envelope.gain.setValueAtTime(gain * LEVEL, when);
    source.connect(envelope);
    let output = envelope;
    if (pan) {
      output = audio.createStereoPanner();
      output.pan.value = pan;
      envelope.connect(output);
    }
    output.connect(destination);

    const voice = { source, envelope };
    voices.add(voice);
    source.onended = () => {
      voices.delete(voice);
      output.disconnect();
    };
    source.start(when);
    if (Number.isFinite(off)) damp(voice, gain * LEVEL, Math.max(off, when));
  };

  const hush = (when = audio.currentTime) => {
    for (const { source, envelope } of voices) {
      envelope.gain.cancelScheduledValues(when);
      envelope.gain.setTargetAtTime(0, when, HUSH / 8);
      source.stop(when + HUSH);
    }
  };

  return { load, ready, strike, hush };
}
