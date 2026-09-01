import { Alignment, type AlignedNote, type TimeSignature } from '../../../src/fitting/alignment';

export const PPQ = 720;
/** One quarter note, the beat these scores are built on. */
export const QUARTER = PPQ;
/** What a spec that states no signature is counted in. */
export const COMMON_TIME: TimeSignature = { numerator: 4, denominator: 4 };

const PITCH_NAMES = ['c', 'c', 'd', 'd', 'e', 'f', 'f', 'g', 'g', 'a', 'a', 'b'];
const ACCIDENTALS = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

export interface ScoreSpec {
  /** Number of beats. One note per voice per beat. */
  beats: number;
  /** Ticks per beat. Defaults to a quarter note. */
  beatTicks?: number;
  /** One signature for the whole score, from tick 0. */
  timeSignature?: TimeSignature;
  /**
   * MIDI pitch of each simultaneous voice. Several pitches make every beat a chord, which is
   * what makes `asChords`, asynchrony and the shake layer do anything at all.
   */
  pitches?: number[];
  /** Put each voice in its own MSM part rather than stacking them in part 1. */
  separateParts?: boolean;
  /** Note length as a fraction of the beat. 1 is a fully tied-over legato score. */
  gate?: number;
}

/**
 * A score MSM carrying no performance data at all — only `midi.pitch`, which is what the
 * renderer needs to sound a note. Everything expressive has to come from the MPM, so a truth
 * MPM that the renderer ignores shows up as a flat performance rather than hiding behind
 * onsets the score already carried.
 */
export const buildScore = (spec: ScoreSpec): Alignment => {
  const beatTicks = spec.beatTicks ?? QUARTER;
  const pitches = spec.pitches ?? [67];
  const gate = spec.gate ?? 1;

  const notes: AlignedNote[] = [];
  for (let beat = 0; beat < spec.beats; beat++) {
    pitches.forEach((pitch, voice) => {
      const part = spec.separateParts ? voice + 1 : 1;
      notes.push({
        'xml:id': `n${voice}_${beat}`,
        part,
        date: beat * beatTicks,
        duration: Math.round(beatTicks * gate),
        pitchname: PITCH_NAMES[pitch % 12],
        accidentals: ACCIDENTALS[pitch % 12],
        octave: Math.floor(pitch / 12) - 1,
        'midi.pitch': pitch,
      } as AlignedNote);
    });
  }

  return new Alignment(notes, [{ date: 0, ...(spec.timeSignature ?? COMMON_TIME) }]);
};

