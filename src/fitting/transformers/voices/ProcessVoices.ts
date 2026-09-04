import { Alignment } from '../../alignment';
import { voiceKey } from '../../voices';
import { nameScope, type Mpm } from '../../instructions/index';
import { AbstractTransformer, type TransformationOptions } from '../Transformer';

/**
 * Which notes a move takes — **the selector, not the destination**.
 *
 * Two forms, answering different questions. A list of `xml:id`s is what a selection on a desk
 * produces; a voice over a tick range is what "the middle voice belongs to the left hand from bar
 * 9" produces, and it keeps meaning that after the notes under it have been re-selected.
 *
 * Modelled on `ModifySelector`, and nested inside a move rather than spread across the options for
 * a reason that is not tidiness: `getRange` duck-types a transformer's options at the *top level*
 * — `{from,to}`, then `{date}`, then `{noteIDs}`. Either name up there would give this call a range
 * it does not have, and put a span in the narrative for a call that writes no instruction.
 */
export type VoiceSelection =
  | { noteIDs: string[] }
  | { voice: string; from: number; to: number };

export interface VoiceMove {
  /** The `number` of the part these notes join. Names an entry of {@link ProcessVoicesOptions.parts}. */
  part: number;
  select: VoiceSelection;
}

export interface PartLayout {
  /**
   * The part's number, 1-based — so `number - 1` is the `Scope` every other call in the chain
   * names, the MIDI channel `Alignment.build` writes, and the `@number` `scope.ts` gives the MPM
   * part.
   *
   * It is the editor's to choose and this transformer's to honour. Renumbering here would silently
   * re-point the `scope` of every call already saved.
   */
  number: number;
  /** What to call it. Empty means unnamed, which is what a part has always been. */
  name: string;
  /** The voices folded into it, by {@link voiceKey} — `"1/1"`, `"1/2"`, … */
  voices: string[];
}

/** The whole layout. Not exported: what edits it speaks in `PartLayout` and `VoiceMove`. */
interface ProcessVoicesOptions extends TransformationOptions {
  parts: PartLayout[];
  moves?: VoiceMove[];
}

/** MIDI's drum channel, which a part must not be given by accident. */
const DRUM_CHANNEL = 9;
const MIDI_CHANNELS = 16;

/**
 * Which MEI voice goes into which MSM part, and what the parts are called.
 *
 * The fourth call that writes no instruction, saying how the score is laid out before the others
 * look at it. Its `created` is empty, and honestly so: a `<part>` holding no map contributes no
 * instruction to `getInstructions`, so naming one is nothing to be answerable for.
 *
 * **One call per document, edited in place.** The options are the whole layout rather than an
 * addition to it, the way `InsertMetadata`'s are the whole `<metadata>`. `set-voices` in
 * `workReducer` is the write half.
 *
 * **Empty options are the identity.** A chain with no such call leaves `note.part` exactly as
 * `asMSM` read it — the MSM part number, which is the staff — so every work file written before
 * this existed fits as it did.
 */
export class ProcessVoices extends AbstractTransformer<ProcessVoicesOptions> {
  name = 'ProcessVoices';
  requires = [];

  constructor(options?: ProcessVoicesOptions) {
    super(options ?? { parts: [] });
  }

  protected transform(msm: Alignment, mpm: Mpm): void {
    const parts = this.options.parts ?? [];
    const moves = this.options.moves ?? [];
    if (parts.length === 0 && moves.length === 0) return;

    this.report(parts, moves);

    // voice ⇒ part. A voice two parts both claim is reported above, and the last one wins — which
    // is at least a layout rather than half of two.
    const partOfVoice = new Map<string, number>();
    for (const part of parts) {
      for (const voice of part.voices) partOfVoice.set(voice, part.number);
    }

    // note ⇒ part, from the moves, which override the voice layout. Later moves win: the list is
    // ordered and the desk appends, so the most recent gesture holds.
    const partOfNote = new Map<string, number>();
    for (const move of moves) {
      if ('noteIDs' in move.select) {
        for (const id of move.select.noteIDs) partOfNote.set(id, move.part);
        continue;
      }
      const { voice, from, to } = move.select;
      // Half-open, `[from, to)`. `to` is the first tick *after* the stretch — the desk builds it
      // as the downbeat of the bar following the range — so an inclusive end would take the first
      // note of the next bar as well. It did: a move over bars 12-20 previewed twelve notes and
      // applied to thirteen.
      for (const note of msm.allNotes) {
        if (voiceKey(note) === voice && note.date >= from && note.date < to) {
          partOfNote.set(note['xml:id'], move.part);
        }
      }
    }

    // `AlignedNote.part` is readonly and stays readonly: a note does not change part, a *layout*
    // decides which part it was always in. So the notes are rebuilt rather than written through —
    // `{ ...note, part }` constructs, which `readonly` does not forbid.
    //
    // Mapped in place rather than filtered and concatenated the way `MakeChoice` does, so the array
    // stays sorted by date, which is what `NotesProvider.slice` binary-searches.
    msm.allNotes = msm.allNotes.map((note) => {
      const next = partOfNote.get(note['xml:id']) ?? partOfVoice.get(voiceKey(note)) ?? note.part;
      return next === note.part ? note : { ...note, part: next };
    });

    // The names, onto the MPM parts that will hold the instructions. Only for a part that actually
    // holds notes — an empty `<part>` in the performance describes nothing.
    const held = msm.parts();
    for (const part of parts) {
      if (!part.name || !held.has(part.number - 1)) continue;
      nameScope(mpm, part.number - 1, part.name);
    }
  }

  /**
   * What is wrong with the layout, said out loud — and nothing renumbered.
   *
   * Reported rather than repaired, the way `Modify` reports a velocity asked of a pedal. The part
   * numbers are the editor's: every other call in the chain names one as its `scope`, so a silent
   * renumber here would re-point all of them at the wrong music.
   */
  private report(parts: readonly PartLayout[], moves: readonly VoiceMove[]): void {
    const seen = new Set<number>();
    const claimedBy = new Map<string, number>();

    for (const part of parts) {
      if (!Number.isInteger(part.number) || part.number < 1) {
        console.error(
          `ProcessVoices: part number ${String(part.number)} is not a part — there is no scope ${String(part.number - 1)}`,
        );
      }
      // `Alignment.build` writes `midiChannel: number - 1` with no channel-10 skip, unlike
      // espressivo's own converter. Pre-existing, but a layout is the first thing that can make
      // ten parts.
      if (part.number - 1 === DRUM_CHANNEL) {
        console.error(
          `ProcessVoices: part ${String(part.number)} lands on MIDI channel ${String(DRUM_CHANNEL)}, which is the drum channel`,
        );
      }
      if (part.number > MIDI_CHANNELS) {
        console.error(
          `ProcessVoices: part ${String(part.number)} has no MIDI channel — there are ${String(MIDI_CHANNELS)}`,
        );
      }
      if (seen.has(part.number)) {
        console.error(`ProcessVoices: two parts are numbered ${String(part.number)}`);
      }
      seen.add(part.number);

      for (const voice of part.voices) {
        const other = claimedBy.get(voice);
        if (other !== undefined) {
          console.error(
            `ProcessVoices: voice ${voice} is claimed by parts ${String(other)} and ${String(part.number)}; the later wins`,
          );
        }
        claimedBy.set(voice, part.number);
      }
    }

    for (const move of moves) {
      if (!seen.has(move.part)) {
        console.error(`ProcessVoices: a move names part ${String(move.part)}, which the layout has no entry for`);
      }
    }
  }
}
