import type { Scope } from './instructions/index';
import { Msm } from 'espressivo';
import { isDefined } from './utils';
import { PULSES_PER_QUARTER } from './ppq';
import { elementAt } from 'espressivo';

/**
 * When the recording sounds an event, in the two attributes MSM states a performance in:
 * milliseconds from the start of the piece, and milliseconds to its release.
 *
 * An end rather than a duration because that is what MSM says — `Performance.perform` writes
 * `milliseconds.date` and `milliseconds.date.end` onto a note, and `readPerformanceData` reads
 * them back. Every caller that wanted a duration wanted `onset + duration` anyway.
 */
export interface PerformedAttributes {
  'milliseconds.date': number;
  'milliseconds.date.end': number;
}

/**
 * What a fitted note carries beyond what MSM states.
 *
 * Only `source`, which records which reading of a passage a note came from; `MakeChoice` selects
 * on it. The reduction itself is not carried here — no `tickDate`, `tickDuration` or
 * `absoluteVelocityChange` written back for the next transformer to subtract its share from.
 * What a fitter has left to explain is derived from the score, the recording and the MPM by
 * `deriveResidual`, so an MSM comes out of a chain the way it went in.
 */
type TemporaryAttributes = Partial<{
  source: string;
}>;

export type AlignedPedal = {
  'xml:id': string;
  type: 'sustain' | 'soft';
} & PerformedAttributes &
  TemporaryAttributes;

/**
 * One note of the score, together with what the recording did with it.
 */
export type AlignedNote = {
  readonly 'xml:id': string;
  readonly part: number;
  /**
   * The `<staff>` the note is written on — `staff@n`, verbatim.
   *
   * Not `Mei.getStaffId`'s `@def`-before-`@n` rule: what has to be recoverable here is the number
   * the MSM `<part @number>` carries, and that is `staffDef@n`. Checked against the shipped
   * transcription — 476 of 476 notes, no disagreement with `part`.
   */
  readonly staff: string;
  /**
   * The `<layer>` it is written in — `layer@def` if it has one, else `layer@n`, else `''`.
   *
   * espressivo's own identity rule (`Mei.getLayerId`), and for its reason: `@def` names a
   * `<layerDef>` and so is stable across measures where `@n` need not be. `''` means "unlayered",
   * which is a value rather than a miss.
   *
   * The layer is the one thing the conversion throws away. One MSM `<part>` is made per
   * `<staffDef>`, so the staff survives as the part number and every layer of a staff arrives
   * merged into it — which is what {@link ProcessVoices} exists to undo.
   */
  readonly layer: string;
  readonly date: number;
  duration: number;
  readonly pitchname: string;
  readonly accidentals: number;
  readonly octave: number;
} & PerformedAttributes & {
    'midi.pitch': number;
    velocity: number;
  } & TemporaryAttributes;

/**
 * Used to represent a homophonized version of the score.
 */
export type ChordMap = Map<number, AlignedNote[]>;

export interface TimeSignature {
  numerator: number;
  denominator: number;
}

/**
 * What to call each part, by the `@number` it carries — 1-based, i.e. {@link AlignedNote.part}.
 *
 * Passed in rather than held on the alignment, because a part's name is the *document's*: it is
 * read off the `ProcessVoices` call the way the title is read off `InsertMetadata`. An alignment
 * carrying it would have to carry it across the worker boundary for a fact that never leaves the
 * main thread, and `deriveResidual` — which renders a probe, not an artefact — would have to pass
 * one to get an answer it does not read.
 */
type PartNames = ReadonlyMap<number, string>;

/**
 * A score and a recording of it, note by note.
 *
 * Not an MSM document — `Msm` is espressivo's, and this is the thing espressivo has no name for:
 * the alignment. Each note carries its symbolic `date` and `duration` in ticks *and* the
 * `milliseconds.date` / `milliseconds.date.end` / `velocity` the performance sounded it at, which
 * is what every transformer fits against. Both halves are MSM's own attributes, so
 * {@link Alignment.serialize} states the alignment as a document espressivo can read straight
 * back, and {@link Alignment.serializeScore} states only the score half.
 */
export class Alignment {
  allNotes: AlignedNote[];
  pedals: AlignedPedal[];
  timeSignature?: TimeSignature;

  /**
   * Builds an alignment from a finished score-to-performance alignment.
   *
   * @param notes (usually constructed from an alignment)
   * containing information about symbolic time and the
   * real (physical) time.
   */
  constructor(notes?: AlignedNote[], timeSignature?: TimeSignature) {
    this.pedals = [];
    // Sorted into a copy, not in place. `sort` mutates its receiver, so sorting the array
    // the caller passed would reorder *their* array as a side effect of construction — which
    // would have `clone()` reorder the very score it claims to be copying.
    this.allNotes = notes ? [...notes].sort((a, b) => a['date'] - b['date']) : [];

    if (timeSignature) {
      this.timeSignature = timeSignature;
    }
  }

  /**
   * An independent copy of this score.
   *
   * Deep, and the only kind of copy there is — both names give it. A shallow one, handing
   * `this.allNotes` to the constructor and assigning `this.pedals` across, would share both
   * arrays *and* every note object with the original: writing a velocity through it would write
   * through to the original, and constructing it would re-sort the original in place. Nothing
   * wants that.
   */
  public clone(): Alignment {
    return this.deepClone();
  }

  public deepClone(): Alignment {
    const clone = new Alignment();
    clone.allNotes = this.allNotes.map((note) => ({ ...note }));
    clone.pedals = this.pedals.map((pedal) => ({ ...pedal }));
    // Spreading an absent time signature yields `{}`, which is not a TimeSignature but
    // typechecked as one: the copy then reported `numerator` and `denominator` as undefined
    // where the original had honestly reported having no time signature at all.
    clone.timeSignature = this.timeSignature ? { ...this.timeSignature } : undefined;
    return clone;
  }

  /**
   * Attach arbitrary extra keys to one note.
   *
   * The keys are by definition not in `AlignedNote`, so the write goes through an index signature
   * the type does not have. That cast is the whole of the untypedness and it stays here.
   */
  public addCustomInfo(scoreId: string, info: Record<string, unknown>): void {
    const target = this.allNotes.find((note) => note['xml:id'] === scoreId);
    if (!target) return;

    const bag = target as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(info)) {
      bag[key] = value;
    }
  }

  /**
   * Deletes the silence before the first note is being played
   */
  public shiftToFirstOnset(): void {
    const notesWithOnset = this.allNotes.filter((n) => isDefined(n['milliseconds.date']));
    // `Math.min()` of nothing is `Infinity`, and only the note shift at the bottom was
    // guarded against it: the pedal loop subtracted it unconditionally and left every pedal
    // onset at `-Infinity`. A score with no recorded onset has no first onset to shift to.
    if (notesWithOnset.length === 0) return;
    // Folded rather than spread, for the reason given on `lastDate`.
    const min = notesWithOnset.reduce((acc, n) => Math.min(acc, n['milliseconds.date']), Infinity);
    if (!min) return;

    // A pedal already down before the first note starts at zero and keeps its release, which
    // is the same subtraction as every other event's — the clamp only moves the start.
    this.pedals.forEach((p) => {
      p['milliseconds.date.end'] -= min;
      p['milliseconds.date'] = Math.max(0, p['milliseconds.date'] - min);
    });

    notesWithOnset.forEach((n) => {
      n['milliseconds.date'] -= min;
      n['milliseconds.date.end'] -= min;
    });
  }

  /**
   * The alignment as an MSM document: the score, and the recording stated in the three
   * attributes MSM keeps a performance in.
   *
   * No `<pedalMap>`. MSM's `<pedal>` is `date`/`state`/`date.end` in ticks, and a recorded
   * pedal has no symbolic date at all — that is the whole reason `getRange` has to derive one
   * from the residual. So there is nothing valid to write, and a written one would be read by
   * nobody: `GenericMap.indexElements` skips a map child with no `@date`, and even an
   * indexed `<pedal>` reaches no renderer, since pedalling sounds through MPM's `<movement>`
   * instructions. The pedals live here, which is where `InsertPedal`, `deriveResidual` and
   * `tickTimes` read them.
   */
  public serialize(names?: PartNames): string | undefined {
    return this.build(true, names);
  }

  /**
   * The alignment as a *score*: symbolic dates and durations plus `midi.pitch`, and nothing
   * the performance put there.
   *
   * This is what goes to espressivo when a residual is derived. The recording states itself in
   * the same attributes a render writes, so a document carrying both is ambiguous about which
   * timing it means, and the whole point of the residual is to keep the recording and the
   * rendering apart.
   */
  public serializeScore(names?: PartNames): string | undefined {
    return this.build(false, names);
  }

  /**
   * Build the document through espressivo, which owns MSM.
   *
   * Nothing here spells an element or an attribute name. `createMsm` fixes the root and the
   * global `<dated>`; `makePart` fixes a part's; `addNote` and friends put each entry in its
   * map through `addToMap`, which is what keeps a map ascending by `@date`. Building a literal
   * and handing it to an XML serializer instead would keep a private table of how MSM is
   * spelled next to a library that owns the format, where the two can silently drift apart.
   *
   * @param performed whether to carry the recording — `velocity`, `milliseconds.date` and
   * `milliseconds.date.end` — as well as the score.
   * @param names what to call each part, by the `@number` it carries — which is `note.part`,
   * 1-based. A part nothing names keeps `part<index>`, the string this has always written, so a
   * document with no layout serializes as it did before.
   */
  private build(performed: boolean, names?: PartNames) {
    // Not an error, and it used to say it was. A score whose `<performance>` is still empty is
    // where every project now starts — the alignment desk is what fills it — and an editor
    // opening one wrote this to the console four times before anybody had done anything wrong.
    // The `undefined` is the report; every caller already reads it as one.
    if (this.allNotes.length === 0) return;

    // A fixed root id, because the chain is compared run against run and `createMsm` mints a
    // random UUID for a null one.
    const msm = Msm.createMsm('aligned performance', 'aligned', PULSES_PER_QUARTER);
    const global = msm.getGlobal();
    if (!global) return;

    msm.addTimeSignature(global, {
      date: 0,
      numerator: this.timeSignature?.numerator ?? 4,
      denominator: this.timeSignature?.denominator ?? 4,
    });
    // TODO: derive from FormalAlterations
    msm.addSection({
      date: 0,
      dateEnd: elementAt(this.allNotes, this.allNotes.length - 1, 'the aligned notes').date,
    });

    // One `<part>` per part the notes actually use, ascending. `@number` is the part index
    // plus one and `@midi.channel` is the index itself, which is the numbering
    // `notesInPart` and `MPM`'s `requireMap` both assume.
    // An MSM cannot hold one `xml:id` twice, and until a `MakeChoice` has collapsed the readings
    // this alignment does: `asMSM` makes one note per `<when>`, so a transcription carrying two
    // recordings holds every note once per recording — 926 notes over 463 ids in the shipped one.
    // Nothing noticed while the raw conversion was what got rendered; a document built from here
    // and played would sound every note twice.
    //
    // First wins, which is what every reader downstream already assumes: `renderedVelocities` and
    // `computeTickTimes` both key by id.
    const written = new Set<string>();

    for (const part of [...this.parts()].sort((a, b) => a - b)) {
      const element = Msm.makePart({
        name: names?.get(part + 1) ?? `part${String(part)}`,
        number: part + 1,
        midiChannel: part,
        midiPort: 0,
      });
      msm.addPart(element);
      // Explicit, and load-bearing beyond stating the instrument: espressivo suppresses the
      // program change it would otherwise derive from `@name` when a part has a
      // `<programChangeMap>` (meico-ts `Msm.ts:931`), and that derivation is a *fuzzy* name
      // match — without this line a part named "melody" renders as GM 53, Voice Oohs, and one
      // named "accompaniment" as GM 21, Accordion. See `tests/fitting/alignment/serialize.test.ts`.
      msm.addProgramChange(element, { date: 0, value: 0 });

      for (const note of this.allNotes.filter((n) => n.part === part + 1)) {
        if (written.has(note['xml:id'])) continue;
        written.add(note['xml:id']);
        msm.addNote(element, {
          id: note['xml:id'],
          date: note.date,
          duration: note.duration,
          midiPitch: note['midi.pitch'],
          pitchname: note.pitchname,
          accidentals: note.accidentals,
          octave: note.octave,
          ...(performed && {
            velocity: note.velocity,
            millisecondsDate: note['milliseconds.date'],
            millisecondsDateEnd: note['milliseconds.date.end'],
          }),
        });
      }
    }

    // `createMsm` and `makePart` open every map the format defines; a fitted alignment fills
    // two of them. Twice, because the sweep walks one snapshot: a `<miscMap>` left empty by
    // the removal of its own `<tupletSpanMap>` is not revisited on that pass.
    msm.deleteEmptyMaps();
    msm.deleteEmptyMaps();

    return msm.writeMsm() ?? undefined;
  }

  /**
   * Returns all notes present at a given score date in a given
   * part.
   * @param tstamp score date
   * @param part if "global", all parts will be considered
   * @returns array of aligned notes
   */
  public notesAtDate(tstamp: number, part: Scope): AlignedNote[] {
    return this.allNotes.filter((note) => {
      return typeof part === 'number'
        ? note.date === tstamp && note.part === part + 1 // a specific part
        : note.date === tstamp; // consider all parts
    });
  }

  /** The note with this `xml:id`, or `undefined`. */
  public getByID(id: string): AlignedNote | undefined {
    return this.allNotes.find((note) => {
      return note['xml:id'] === id;
    });
  }

  /**
   * Generates a homophonized version of the score.
   *
   * The sort runs on a copy. Sorting `this.allNotes` itself — which is what the `'global'`
   * branch would otherwise hold — would leave the score permanently sorted by date, as a side
   * effect of a read-only-looking query.
   */
  public asChords(part: Scope = 'global'): ChordMap {
    const notes = (
      part === 'global' ? [...this.allNotes] : this.allNotes.filter((n) => n.part - 1 === part)
    ).sort((a, b) => a.date - b.date);

    return notes.reduce<ChordMap>((prev, curr) => {
      const chord = prev.get(curr.date);
      if (chord) chord.push(curr);
      else prev.set(curr.date, [curr]);
      return prev;
    }, new Map());
  }

  /**
   * Returns the last date, at which a note is present.
   * @returns score date in ticks
   */
  public lastDate(): number {
    // `Math.max()` of nothing is -Infinity, which every comparison downstream reads as a
    // date before the start of the piece. An empty score ends where it begins.
    if (this.allNotes.length === 0) return 0;

    // Folded rather than spread: `Math.max(...dates)` passes one argument per note, which
    // past roughly 100k of them is a `RangeError` rather than a slowdown, and it allocates
    // a throwaway array of every date to get there.
    let last = -Infinity;
    for (const note of this.allNotes) {
      if (note.date > last) last = note.date;
    }
    return last;
  }

  public get end(): number {
    if (this.allNotes.length === 0) return 0;
    let end = -Infinity;
    for (const note of this.allNotes) {
      const noteEnd = note.date + note.duration;
      if (noteEnd > end) end = noteEnd;
    }
    return end;
  }

  /**
   * Returns the last note
   * @returns the aligned note
   */
  public lastNote(): AlignedNote | undefined {
    // Hoisted out of the predicate. `lastDate()` is itself a walk over every note, and
    // calling it from inside `find` ran that walk once per note the `find` visited — so
    // reading the last note of a 450-note score cost 200k comparisons.
    const lastDate = this.lastDate();
    return this.allNotes.find((n) => n.date === lastDate);
  }

  public parts(): Set<number> {
    return new Set(this.allNotes.map((note) => note.part - 1));
  }

  /**
   * The readings in hand, by the `@source` their notes and pedals were recorded under.
   *
   * Pedals count as well as notes: a take that differs from another only in its pedalling is
   * still a take, and `MakeChoice` selects pedals on the same attribute.
   *
   * An event the MEI wrote outside any `<recording>` names no reading and is left out. `asMSM`
   * reads the source off the `<recording>` a `<when>` sits in and every take the alignment desk
   * writes has one, so that is a fallback rather than a case.
   *
   * Read this off the alignment as *loaded*, not off one a chain has run over: `MakeChoice`
   * discards the variants it did not prefer, so a fitted alignment reports one reading as soon
   * as a choice has been made.
   */
  public sources(): Set<string> {
    return new Set(
      [...this.allNotes, ...this.pedals].flatMap((event) => (event.source ? [event.source] : [])),
    );
  }

  /**
   * The notes of one part, or of the whole score.
   *
   * Both branches answer with a fresh array. Handing back `this.allNotes` itself would let a
   * caller that sorts or splices what it got back edit the score through what reads as a
   * query.
   */
  public notesInPart(part: Scope): AlignedNote[] {
    return part === 'global'
      ? [...this.allNotes]
      : this.allNotes.filter((n) => n.part - 1 === part);
  }

  public notesInRange(from: number, to: number, scope: Scope): AlignedNote[] {
    return this.notesInPart(scope).filter((note) => {
      return note.date >= from && note.date <= to;
    });
  }
}
