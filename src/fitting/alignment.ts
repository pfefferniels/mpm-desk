import type { Scope } from './instructions/index';
import { Msm } from 'espressivo';
import { isDefined } from './utils';
import { PULSES_PER_QUARTER } from './ppq';
import { elementAt } from 'espressivo';
import { timeSignatureAt, type DatedTimeSignature } from './timeSignature';

/**
 * When the recording sounds an event, in the two attributes MSM states a performance in:
 * milliseconds from the start of the piece, and milliseconds to its release.
 *
 * An end rather than a duration because that is what MSM says: `Performance.perform` writes
 * `milliseconds.date` and `milliseconds.date.end` onto a note, and `readPerformanceData` reads
 * them back.
 */
export interface PerformedAttributes {
  'milliseconds.date': number;
  'milliseconds.date.end': number;
}

/**
 * What a fitted note carries beyond what MSM states.
 *
 * Only `source`, which records which reading of a passage a note came from; `MakeChoice` selects
 * on it. The reduction is deliberately not carried here, so an MSM comes out of a chain the way
 * it went in. What a fitter has left to explain comes from `deriveResidual`.
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
   * The `<staff>` the note is written on: `staff@n`, verbatim.
   *
   * Not `Mei.getStaffId`'s `@def`-before-`@n` rule. What has to be recoverable is the number the
   * MSM `<part @number>` carries, which is `staffDef@n`. Checked against the shipped
   * transcription at 476 of 476 notes, with no disagreement against `part`.
   */
  readonly staff: string;
  /**
   * The `<layer>` it is written in: `layer@def` if it has one, else `layer@n`, else `''`.
   *
   * espressivo's own identity rule (`Mei.getLayerId`), and for its reason: `@def` names a
   * `<layerDef>` and so is stable across measures where `@n` need not be. `''` means "unlayered",
   * which is a value rather than a miss.
   *
   * The layer is the one thing the conversion throws away. One MSM `<part>` is made per
   * `<staffDef>`, so the staff survives as the part number and every layer of a staff arrives
   * merged into it, which is what {@link ProcessVoices} undoes.
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
 * What identifies one row of the alignment: the note or pedal, and the take it came from.
 *
 * An `xml:id` names an event in the *score*. The alignment holds one row per `<when>`, so a
 * document with more than one reading carries every score event once per take under the same id:
 * 900 notes over 450 ids in the shipped transcription, and 107 pedals over 58. The id alone
 * identifies nothing until {@link MakeChoice} has collapsed the readings.
 *
 * Spelled once because a desk that forgets to concatenate both fields fails silently. React
 * documents duplicate keys as unsupported rather than first-one-wins, so the symptom is a note
 * lighting up under the pointer somewhere else.
 *
 * `xml:id` is an NCName and holds no `/`, so the first one separates the pair unambiguously.
 */
export const rowId = (event: Pick<AlignedNote, 'xml:id' | 'source'>): string =>
  `${event['xml:id']}/${event.source ?? ''}`;

/**
 * Used to represent a homophonized version of the score.
 */
export type ChordMap = Map<number, AlignedNote[]>;

/**
 * The score as one scope sees it: every query that filters on {@link AlignedNote.part}, with the
 * part named once instead of at each call.
 *
 * The only way to ask those four questions, which is the point of it. A desk holds an
 * {@link Alignment} and a {@link Scope} separately, and the scope it *draws* has to be the scope
 * it *writes*. Carried as an argument the two drift apart silently, plotting every chord in the
 * score while writing to one part. Bound once at the top of a desk as `msm.in(part)`, the wrong
 * scope is no longer something you can fail to type; the whole score is `msm.in('global')`.
 *
 * A window rather than a copy: each query reads `allNotes`, so a score mutated behind a view
 * answers as it now is.
 */
export class ScopedScore {
  constructor(
    private readonly score: Alignment,
    readonly scope: Scope,
  ) {}

  /** Whether this scope answers for a note. The one place a part number is compared. */
  private covers(note: AlignedNote): boolean {
    return this.scope === 'global' || note.part - 1 === this.scope;
  }

  /**
   * The notes of this scope.
   *
   * A fresh array, as {@link Alignment.allNotes} is not: a caller that sorts or splices what it
   * got back would otherwise edit the score through what reads as a query.
   */
  public notes(): AlignedNote[] {
    return this.score.allNotes.filter((note) => this.covers(note));
  }

  /**
   * A homophonized version of this scope, by date.
   *
   * The sort runs on the array `notes()` has already copied. Sorting `allNotes` itself would
   * leave the score permanently sorted by date, as a side effect of a read-only-looking query.
   */
  public chords(): ChordMap {
    return this.notes()
      .sort((a, b) => a.date - b.date)
      .reduce<ChordMap>((prev, curr) => {
        const chord = prev.get(curr.date);
        if (chord) chord.push(curr);
        else prev.set(curr.date, [curr]);
        return prev;
      }, new Map());
  }

  /** The notes of this scope sounding at one score date. */
  public notesAtDate(date: number): AlignedNote[] {
    return this.score.allNotes.filter((note) => this.covers(note) && note.date === date);
  }

  /** The notes of this scope between two score dates, both ends included. */
  public notesInRange(from: number, to: number): AlignedNote[] {
    return this.score.allNotes.filter(
      (note) => this.covers(note) && note.date >= from && note.date <= to,
    );
  }
}

/**
 * What to call each part, by the `@number` it carries: 1-based, i.e. {@link AlignedNote.part}.
 *
 * Passed in rather than held on the alignment, because a part's name is the *document's*, read
 * off the `ProcessVoices` call as the title is read off `InsertMetadata`. An alignment carrying
 * it would have to take it across the worker boundary for a fact that never leaves the main
 * thread, and `deriveResidual` would have to pass one to get an answer it does not read.
 */
type PartNames = ReadonlyMap<number, string>;

/**
 * A score and a recording of it, note by note.
 *
 * Not an MSM document: `Msm` is espressivo's, and this is the thing espressivo has no name for.
 * Each note carries its symbolic `date` and `duration` in ticks *and* the `milliseconds.date` /
 * `milliseconds.date.end` / `velocity` the performance sounded it at, which is what every
 * transformer fits against. Both halves are MSM's own attributes, so {@link Alignment.serialize}
 * states the alignment as a document espressivo can read straight back, and
 * {@link Alignment.serializeScore} states only the score half.
 */
export class Alignment {
  allNotes: AlignedNote[];
  pedals: AlignedPedal[];
  /**
   * The score's time signatures, ascending by date: the whole map, not its first entry.
   *
   * A score with an anacrusis states the upbeat bar first and the metre of the piece second, so
   * one entry is one bar of it. Ask {@link Alignment.timeSignatureAt} for the one governing a
   * date; there is no single signature to be had.
   */
  timeSignatures: DatedTimeSignature[];

  /** The views {@link Alignment.in} has handed out, one per scope asked for. */
  private readonly views = new Map<Scope, ScopedScore>();

  /**
   * Builds an alignment from a finished score-to-performance alignment.
   *
   * @param notes (usually constructed from an alignment)
   * containing information about symbolic time and the
   * real (physical) time.
   */
  constructor(notes?: AlignedNote[], timeSignatures?: readonly DatedTimeSignature[]) {
    this.pedals = [];
    // Sorted into a copy, not in place. `sort` mutates its receiver, so sorting the array
    // the caller passed would reorder *their* array as a side effect of construction — which
    // would have `clone()` reorder the very score it claims to be copying.
    this.allNotes = notes ? [...notes].sort((a, b) => a['date'] - b['date']) : [];
    this.timeSignatures = timeSignatures
      ? [...timeSignatures].sort((a, b) => a.date - b.date)
      : [];
  }

  /** The signature governing `date`; see {@link timeSignatureAt}. */
  public timeSignatureAt(date: number): DatedTimeSignature | undefined {
    return timeSignatureAt(this.timeSignatures, date);
  }

  /**
   * An independent copy of this score.
   *
   * Deep, and the only kind of copy there is. A shallow one would share both arrays and every
   * note object with the original, so writing a velocity through it would write through, and
   * constructing it would re-sort the original in place.
   */
  public clone(): Alignment {
    return this.deepClone();
  }

  public deepClone(): Alignment {
    const clone = new Alignment();
    clone.allNotes = this.allNotes.map((note) => ({ ...note }));
    clone.pedals = this.pedals.map((pedal) => ({ ...pedal }));
    clone.timeSignatures = this.timeSignatures.map((signature) => ({ ...signature }));
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
   * No `<pedalMap>`. MSM's `<pedal>` is `date`/`state`/`date.end` in ticks and a recorded pedal
   * has no symbolic date, which is why `getRange` derives one from the residual. So there is
   * nothing valid to write, and a written one would be read by nobody: `GenericMap.indexElements`
   * skips a map child with no `@date`, and even an indexed `<pedal>` reaches no renderer, since
   * pedalling sounds through MPM's `<movement>` instructions. The pedals live on the class, where
   * `InsertPedal`, `deriveResidual` and `tickTimes` read them.
   */
  public serialize(names?: PartNames): string | undefined {
    return this.build(true, names);
  }

  /**
   * The alignment as a *score*: symbolic dates and durations plus `midi.pitch`, and nothing the
   * performance put there.
   *
   * What goes to espressivo when a residual is derived. The recording states itself in the same
   * attributes a render writes, so a document carrying both is ambiguous about which timing it
   * means, and the residual exists to keep the recording and the rendering apart.
   */
  public serializeScore(names?: PartNames): string | undefined {
    return this.build(false, names);
  }

  /**
   * Build the document through espressivo, which owns MSM.
   *
   * Nothing here spells an element or an attribute name. `createMsm` fixes the root and the
   * global `<dated>`, `makePart` fixes a part's, and `addNote` and friends go through
   * `addToMap`, which keeps a map ascending by `@date`. Building a literal instead would keep a
   * private table of how MSM is spelled beside the library that owns the format.
   *
   * @param performed whether to carry the recording (`velocity`, `milliseconds.date` and
   * `milliseconds.date.end`) as well as the score.
   * @param names what to call each part, by the `@number` it carries, which is `note.part`,
   * 1-based. A part nothing names keeps `part<index>`.
   */
  private build(performed: boolean, names?: PartNames) {
    // Not an error. A score whose `<performance>` is still empty is where every project starts,
    // the alignment desk being what fills it. The `undefined` is the report, and every caller
    // reads it as one.
    if (this.allNotes.length === 0) return;

    // A fixed root id, because the chain is compared run against run and `createMsm` mints a
    // random UUID for a null one.
    const msm = Msm.createMsm('aligned performance', 'aligned', PULSES_PER_QUARTER);
    const global = msm.getGlobal();
    if (!global) return;

    // The whole map, so a rendering counts bars the way the score does. espressivo positions a
    // note in an accentuation pattern by the bar length it derives from these entries, and
    // stating only the first would put an anacrusis's metre over the whole piece. A score that
    // states none is published in common time, the assumption every fitter counts beats under.
    const signatures =
      this.timeSignatures.length > 0
        ? this.timeSignatures
        : [{ date: 0, numerator: 4, denominator: 4 }];
    for (const { date, numerator, denominator } of signatures) {
      msm.addTimeSignature(global, { date, numerator, denominator });
    }
    // TODO: derive from FormalAlterations
    msm.addSection({
      date: 0,
      dateEnd: elementAt(this.allNotes, this.allNotes.length - 1, 'the aligned notes').date,
    });

    // One `<part>` per part the notes actually use, ascending. `@number` is the part index plus
    // one and `@midi.channel` is the index itself, the numbering `notesInPart` and `MPM`'s
    // `requireMap` both assume.
    //
    // An MSM cannot hold one `xml:id` twice, and until a `MakeChoice` has collapsed the readings
    // this alignment does: `asMSM` makes one note per `<when>`, so a transcription carrying two
    // recordings holds every note once per recording (926 notes over 463 ids in the shipped one),
    // and a document built from it would sound every note twice.
    //
    // First wins, which every reader downstream assumes: `renderedVelocities` and
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
      // Load-bearing beyond stating the instrument: espressivo suppresses the program change it
      // would otherwise derive from `@name` when a part has a `<programChangeMap>` (meico-ts
      // `Msm.ts:931`), and that derivation is a *fuzzy* name match. Without this line a part
      // named "melody" renders as GM 53, Voice Oohs, and "accompaniment" as GM 21, Accordion.
      // See `tests/fitting/alignment/serialize.test.ts`.
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
   * The score as one scope sees it; see {@link ScopedScore} for why every part-sensitive query
   * lives there and none of them here.
   *
   * Cached per scope, so `msm.in(part)` is reference-stable for as long as the alignment is. The
   * desks memoise on what this returns, and a fresh view per render would defeat all of them.
   */
  public in(scope: Scope): ScopedScore {
    const known = this.views.get(scope);
    if (known) return known;

    const view = new ScopedScore(this, scope);
    this.views.set(scope, view);
    return view;
  }

  /** The note with this `xml:id`, or `undefined`. */
  public getByID(id: string): AlignedNote | undefined {
    return this.allNotes.find((note) => {
      return note['xml:id'] === id;
    });
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
   * reads the source off the `<recording>` a `<when>` sits in, and every take the alignment desk
   * writes has one.
   *
   * Read off the alignment as *loaded*, never off one a chain has run over: `MakeChoice` discards
   * the variants it did not prefer, so a fitted alignment reports one reading as soon as a choice
   * has been made.
   */
  public sources(): Set<string> {
    return new Set(
      [...this.allNotes, ...this.pedals].flatMap((event) => (event.source ? [event.source] : [])),
    );
  }

  /**
   * How many score notes are here on more than one reading; see {@link rowId}.
   *
   * Score notes rather than rows, so a note with three rows counts once. The count goes into a
   * sentence naming the work left, so it counts the work.
   *
   * Read off the alignment as a chain *left* it, the opposite way round from
   * {@link Alignment.sources}: it answers whether the readings still stand side by side, which a
   * `MakeChoice` settles. Zero on a document that only ever held one take.
   *
   * What it is for: a desk fitting from the recording measures one row at a time, and a note on
   * several readings carries a velocity and an onset per take under the one id, with nothing
   * saying which row is on screen. `deriveResidual` refuses such an alignment, so this also says
   * whether there is a residual to be had; `DeskSwitch` greys out the desks that plot one until
   * it reaches zero.
   */
  public unchosenNotes(): number {
    const rows = new Map<string, number>();
    for (const note of this.allNotes) {
      rows.set(note['xml:id'], (rows.get(note['xml:id']) ?? 0) + 1);
    }
    return [...rows.values()].filter((count) => count > 1).length;
  }
}
