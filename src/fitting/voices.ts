/**
 * The voices of a score, as the alignment can see them.
 *
 * A voice is one `<layer>` of one `<staff>`. It is not a part: the conversion gives one MSM part
 * per staff, so every layer of a staff arrives sharing one part, one MIDI channel and one MPM
 * scope. Deciding otherwise is what `ProcessVoices` is for; this is the vocabulary it and its desk
 * both speak.
 *
 * Plain data and no DOM, so the worker and the desk can both read it.
 */
import type { AlignedNote, Alignment } from './alignment';

export interface Voice {
  /** `staff@n`. Also the `<part @number>` its notes are in before any layout is applied. */
  staff: string;
  /** `layer@def` else `layer@n` else `''`. */
  layer: string;
  /** {@link voiceKey} of the two above — what a layout names. */
  key: string;
  /**
   * How many notes are in it, so a desk can show a nearly empty voice as nearly empty.
   *
   * Distinct `xml:id`s, not rows of the alignment. Until a `MakeChoice` has collapsed the readings
   * the alignment holds every note once per `<recording>` — twice, in the shipped transcription —
   * and a legend reporting 520 notes beside a staff showing 260 is reporting the file's shape
   * rather than the music's.
   */
  notes: number;
  /** The part it is in as the alignment stands, 1-based. */
  part: number;
}

/**
 * The name a layout knows a voice by.
 *
 * Joined with a separator rather than concatenated. espressivo's own `layersToStaffs` concatenates,
 * and that is ambiguous by its own documentation: staff 1 / layer 11 and staff 11 / layer 1 both
 * spell `111`. Two-digit `@n` is not exotic in a keyboard score.
 */
export const voiceKey = (of: Pick<AlignedNote, 'staff' | 'layer'>): string =>
  `${of.staff}/${of.layer}`;

/** What to call a voice when nothing else does. */
export const voiceLabel = (voice: Voice): string =>
  voice.layer ? `Staff ${voice.staff}, voice ${voice.layer}` : `Staff ${voice.staff}`;

/**
 * Compare two `@n` values as a reader would.
 *
 * Numerically where both parse, lexically where they do not. MEI types `staff/@n` as an integer,
 * but a document out of schema should sort oddly rather than throw.
 */
const compareN = (a: string, b: string): number => {
  const x = Number(a);
  const y = Number(b);
  if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
  return a.localeCompare(b);
};

/** Every voice the notes use, in score order: by staff, then by layer. */
export const voicesOf = (msm: Alignment): Voice[] => {
  const found = new Map<string, Voice>();
  const counted = new Map<string, Set<string>>();

  for (const note of msm.allNotes) {
    const key = voiceKey(note);
    const existing = found.get(key);
    if (!existing) {
      found.set(key, { staff: note.staff, layer: note.layer, key, notes: 0, part: note.part });
      counted.set(key, new Set());
    }
    counted.get(key)?.add(note['xml:id']);
  }

  for (const voice of found.values()) {
    voice.notes = counted.get(voice.key)?.size ?? 0;
  }

  return [...found.values()].sort(
    (a, b) => compareN(a.staff, b.staff) || compareN(a.layer, b.layer),
  );
};
