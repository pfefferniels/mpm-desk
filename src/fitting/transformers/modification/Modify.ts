import {
  Alignment,
  redrawPress,
  type AlignedNote,
  type AlignedPedal,
  type PerformedAttributes,
} from '../../alignment';
import { releaseShifted } from '../../../performance/pedalTravel';
import { AbstractTransformer, idsOf, type ScopedTransformationOptions } from '../Transformer';
import { type Range, rangeOfNotes } from '../range';
import { expansion, type ExpansionPoint } from '../../expansion';

/**
 * What a correction is about — **the selector, not the aspect**.
 *
 * A note can be corrected by id or by a stretch of the tick grid; a recorded pedal can only be
 * corrected by id, because it has no symbolic date at all — `Alignment.serialize` says why, in
 * its note on the missing `<pedalMap>`. So `from`/`to` cannot reach a pedal, and is not asked to
 * try.
 *
 * There is no `'pedal'` aspect: a press has an onset and a release, which are two of the three
 * aspects below, and the line between them, which is `CorrectPedal`'s. A saved call naming one
 * lands in the `default` arm.
 */
export type ModifySelector =
  | { noteIDs: string[] }
  | { pedalIDs: string[] }
  | { from: number; to: number };

/**
 * What a call reaches: what one of the three selectors names, or, without one, every event of its
 * scope. That is the usual case for an expansion, which is mostly a claim about the medium — the
 * roll squeezed its whole range against a floor — rather than about a place in the music.
 *
 * The arm without a selector is written out rather than named by an interface, which would not
 * read as the plain record a saved call's options are.
 */
type ModifyReach =
  | ModifySelector
  | { noteIDs?: undefined; pedalIDs?: undefined; from?: undefined; to?: undefined };

/** What every correction states, however far it moves its events. */
type ModifyBase = ScopedTransformationOptions &
  ModifyReach & {
    /** Velocity steps, or milliseconds of onset or of duration. */
    aspect: 'velocity' | 'onset' | 'duration';
  };

/** A shift: a correction by a constant, every event moving by the same amount. */
export type ShiftOptions = ModifyBase & {
  /** How much to add, in the aspect's own unit. */
  change: number;
  points?: undefined;
};

/**
 * An expansion: a correction along a scale, where how far an event moves depends on the value it
 * was recorded at.
 */
export type ExpansionOptions = ModifyBase & {
  /**
   * Where the recorded values go, as pairs of recorded value and new value: at least two, the
   * recorded values rising. Between two points a value is mapped linearly, and beyond the
   * outermost the outermost line carries on, so the points need not span the recording.
   */
  points: ExpansionPoint[];
  change?: undefined;
};

export type ModifyOptions = ShiftOptions | ExpansionOptions;

/** Whether the call maps its events along a scale rather than shifting them by a constant. */
export const isExpansion = (options: ModifyOptions): options is ExpansionOptions =>
  options.points !== undefined;

/**
 * Move an event without changing how long it sounds.
 *
 * `milliseconds.date.end` is an absolute release, not a length, so shifting only the start would
 * stretch or squash the event instead of displacing it. Both fields take the same delta — and
 * where the start would land before the recording begins, that delta is what survives the clamp,
 * so the length survives it too.
 */
export const displace = (event: PerformedAttributes, change: number): void => {
  const applied = Math.max(change, -event['milliseconds.date']);
  event['milliseconds.date'] += applied;
  event['milliseconds.date.end'] += applied;
};

/** Move an event's release, which cannot be dragged back past its own onset. */
export const restretch = (event: PerformedAttributes, change: number): void => {
  event['milliseconds.date.end'] = Math.max(
    event['milliseconds.date'],
    event['milliseconds.date.end'] + change,
  );
};

/** Move a press's release. Where the press carries its line, the release is where the line comes down. */
export const restretchPress = (pedal: AlignedPedal, change: number): void => {
  if (pedal.travel) redrawPress(pedal, releaseShifted(pedal.travel, change));
  else restretch(pedal, change);
};

/**
 * A correction to the recording.
 *
 * One of the four calls that write no instruction into the performance — `MakeChoice` picks
 * between readings, this and `CorrectPedal` correct the reading that was picked, and
 * `InsertMetadata` says who did the picking. It runs before the `TranslatePhysicalTimeToTicks` hinge, so
 * it works in the recording's own domain: milliseconds, which is what makes an onset or a
 * duration correction mean anything at all.
 *
 * ## By a constant, or along a scale
 *
 * A correction says where the recorded values go, in one of two ways.
 *
 * A **shift** states a `change`, added to every event alike: at this place the pianist played
 * softer, earlier or longer than the roll shows.
 *
 * An **expansion** states `points`, which map a whole range of values onto another, so that an
 * event moves by an amount that depends on where it was. That is a statement about the medium
 * rather than about a place: a Welte roll cannot sound softer than its floor, so wherever the
 * playing went below it the roll squeezes the soft end together, and only stretching the range
 * back open undoes that. `[[35, 20], [54, 46]]` takes the roll's floor of 35 to 20 and its
 * loudest note of 54 to 46, and everything between along the line, so a note is moved further the
 * softer it was recorded.
 *
 * A shift is the expansion whose line neither stretches nor squeezes: `change: -6` is
 * `[[35, 29], [54, 48]]`. Until November 2026 the two were two transformers, and an expansion was
 * an `Expand` call; a file saved then is read as this one (`src/model/Work.ts`).
 *
 * ## The aspects
 *
 * For `velocity` the value is the velocity. For `onset` it is the time of the attack, and the
 * event moves without changing its length; an expansion measures it in milliseconds from the
 * first note's onset — the zero every desk shows, rather than the start of the roll, whose leader
 * is no part of the performance. For `duration` it is the length, and the release moves. A roll
 * played at the wrong speed would want an expansion of both, with the same points.
 *
 * One consequence of the call's position is worth knowing before correcting the *first* onset in
 * a piece: `InsertTempo` runs later and calls `shiftToFirstOnset`, which subtracts the earliest
 * onset from every event. Moving the earliest onset therefore moves the whole recording's zero
 * rather than that one note.
 *
 * ## Which events
 *
 * With a selector, the events it names — a pedal only by its id. Without one, every note of the
 * scope, and for the two timing aspects of a global call every pedal as well: a stretch of the
 * recording's time that left the pedalling where it was would take the pedal off the notes it
 * holds.
 *
 * ## Among themselves
 *
 * Every expansion runs before every shift, whatever order the calls were made in
 * ({@link Modify.precedence}), so a correction by hand is made on the scale that has been opened
 * rather than being stretched along with it. Two expansions of one aspect apply one after the
 * other.
 *
 * ## What follows an expansion
 *
 * The guides of the dynamics curve are set on the expanded scale, so the editor moves them with
 * an expansion of velocity when one is added or taken away (`src/model/guides.ts`), and the desks
 * draw where an event was before it as a grey ghost, by running the map backwards
 * (`useCorrectionDeltas`).
 */
export class Modify extends AbstractTransformer<ModifyOptions> {
  readonly name = 'Modify';
  requires = [];

  constructor(options?: ModifyOptions) {
    super(
      options || {
        scope: 'global',
        aspect: 'velocity',
        change: 0,
        from: 0,
        to: 0,
      },
    );
  }

  /** An expansion first, then a shift: see the note on the class. */
  override precedence(): number {
    return isExpansion(this.options) ? 0 : 1;
  }

  /**
   * A press has no symbolic date, so a correction made by `pedalIDs` is about no place in the
   * score, and neither is one without a selector.
   */
  range(msm: Alignment): Range | undefined {
    const options = this.options;
    if ('from' in options && options.from !== undefined && options.to !== undefined)
      return { from: options.from, to: options.to };
    if ('noteIDs' in options && options.noteIDs) return rangeOfNotes(options.noteIDs, msm);
    return undefined;
  }

  /** What it corrects: the presses or the notes it names, every reading of each. */
  override evidence(msm: Alignment): string[] {
    const { notes, pedals } = this.events(msm);
    return idsOf([...notes, ...pedals]);
  }

  /** The notes and the pedals the call is about. */
  private events(msm: Alignment): { notes: AlignedNote[]; pedals: AlignedPedal[] } {
    const options = this.options;

    if ('noteIDs' in options && options.noteIDs) {
      // Every note under the id, not `getByID`'s first one. Until a `MakeChoice` covering the
      // passage has collapsed them, an `xml:id` names one note of the score *per source* — and a
      // correction is about the note, so it belongs on whichever readings of it are still
      // standing. That is already what the `from`/`to` arm does, since `notesInRange` filters
      // rather than finds.
      const ids = new Set(options.noteIDs);
      return { notes: msm.allNotes.filter((note) => ids.has(note['xml:id'])), pedals: [] };
    }
    if ('pedalIDs' in options && options.pedalIDs) {
      // Every press under the id, for the reason the note arm gives.
      const ids = new Set(options.pedalIDs);
      return { notes: [], pedals: msm.pedals.filter((pedal) => ids.has(pedal['xml:id'])) };
    }
    if ('from' in options && options.from !== undefined && options.to !== undefined) {
      return { notes: msm.in(options.scope).notesInRange(options.from, options.to), pedals: [] };
    }
    return {
      notes: msm.in(options.scope).notes(),
      // A pedal has no velocity, and belongs to no part.
      pedals: options.aspect !== 'velocity' && options.scope === 'global' ? msm.pedals : [],
    };
  }

  protected transform(msm: Alignment): void {
    // Read into a local, because the narrowing below is what picks the arm and TypeScript drops a
    // narrowing of `this.options` the moment it is used inside a callback.
    const options = this.options;
    const { aspect } = options;

    // The map of an expansion; a shift has none, and adds its `change` as it stands.
    let map: ((value: number) => number) | undefined;
    if (isExpansion(options)) {
      const drawn = expansion(options.points);
      if (!drawn) {
        console.error(
          `Modify: ${JSON.stringify(options.points)} draws no map — it needs two points or more, ` +
            'of finite numbers, with the recorded values rising',
        );
        return;
      }
      map = drawn;
    }
    const change = isExpansion(options) ? 0 : options.change;

    if (aspect === 'velocity' && 'pedalIDs' in options && options.pedalIDs) {
      // Not silently skipped: a pedal has no velocity, so a call asking for one was built
      // wrong, and it is owed the same report an unknown aspect gets.
      console.error('Modify: velocity is a property of a note, not of a pedal');
      return;
    }

    const { notes, pedals } = this.events(msm);

    switch (aspect) {
      case 'velocity':
        for (const note of notes)
          note.velocity = Math.max(0, map ? map(note.velocity) : note.velocity + change);
        return;

      case 'onset': {
        // What an expansion measures from: the first note's onset among all of them, as
        // `shiftToFirstOnset` will take it.
        const zero = msm.allNotes.reduce(
          (first, note) =>
            Number.isFinite(note['milliseconds.date']) ? Math.min(first, note['milliseconds.date']) : first,
          Infinity,
        );
        if (map && !Number.isFinite(zero)) return;
        for (const event of [...notes, ...pedals]) {
          const onset = event['milliseconds.date'];
          // A score note the recording never played has no onset to correct, and `displace` would
          // write `NaN` over the non-finite value that says so.
          if (!Number.isFinite(onset)) continue;
          displace(event, map ? zero + map(onset - zero) - onset : change);
        }
        return;
      }

      case 'duration':
        for (const note of notes) {
          const length = note['milliseconds.date.end'] - note['milliseconds.date'];
          if (!Number.isFinite(length)) continue;
          restretch(note, map ? map(length) - length : change);
        }
        for (const pedal of pedals) {
          const length = pedal['milliseconds.date.end'] - pedal['milliseconds.date'];
          if (!Number.isFinite(length)) continue;
          restretchPress(pedal, map ? map(length) - length : change);
        }
        return;

      default:
        console.error(`Unknown aspect: ${String(aspect)}`);
    }
  }
}
