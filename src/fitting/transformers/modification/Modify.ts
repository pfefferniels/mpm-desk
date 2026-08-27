import { Alignment, type PerformedAttributes } from '../../alignment';
import { AbstractTransformer, type ScopedTransformationOptions } from '../Transformer';

/**
 * What a correction is about — **the selector, not the aspect**.
 *
 * A note can be corrected by id or by a stretch of the tick grid; a recorded pedal can only be
 * corrected by id, because it has no symbolic date at all — `Alignment.serialize` says why, in
 * its note on the missing `<pedalMap>`. So `from`/`to` cannot reach a pedal, and is not asked to
 * try.
 *
 * There used to be a fourth *aspect*, `'pedal'`, which is a category error: a pedal has an onset
 * and a held length and nothing else, which are two of the three aspects below. It had no arm in
 * `transform` and only ever reached the `console.error`, so nothing on disk depends on it — and a
 * saved call still naming it lands in the same `default` arm it always did.
 */
export type ModifySelector =
  | { noteIDs: string[] }
  | { pedalIDs: string[] }
  | { from: number; to: number };

export type ModifyOptions = ScopedTransformationOptions &
  ModifySelector & {
    aspect: 'velocity' | 'onset' | 'duration';
    /** how much to add, in the aspect's own unit: velocity steps for `velocity`, milliseconds for `onset` and `duration`. */
    change: number;
  };

/**
 * Move an event without changing how long it sounds.
 *
 * `milliseconds.date.end` is an absolute release, not a length, so shifting only the start would
 * stretch or squash the event instead of displacing it. Both fields take the same delta — and
 * where the start would land before the recording begins, that delta is what survives the clamp,
 * so the length survives it too.
 */
const displace = (event: PerformedAttributes, change: number): void => {
  const applied = Math.max(change, -event['milliseconds.date']);
  event['milliseconds.date'] += applied;
  event['milliseconds.date.end'] += applied;
};

/** Move an event's release, which cannot be dragged back past its own onset. */
const restretch = (event: PerformedAttributes, change: number): void => {
  event['milliseconds.date.end'] = Math.max(
    event['milliseconds.date'],
    event['milliseconds.date.end'] + change,
  );
};

/**
 * A correction to the recording.
 *
 * One of the three calls that write no instruction into the performance — `MakeChoice` picks
 * between readings, this corrects the reading that was picked, and `InsertMetadata` says who did
 * the picking. It runs second in the chain, before the `TranslatePhysicalTimeToTicks` hinge, so
 * it works in the recording's own domain: milliseconds, which is what makes an onset or a
 * duration correction mean anything at all.
 *
 * One consequence of that position is worth knowing before correcting the *first* onset in a
 * piece: `InsertTempo` runs later and calls `shiftToFirstOnset`, which subtracts the earliest
 * onset from every event. Moving the earliest onset therefore moves the whole recording's zero
 * rather than that one note.
 */
export class Modify extends AbstractTransformer<ModifyOptions> {
  name = 'Modify';
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

  protected transform(msm: Alignment): void {
    // Read into a local, because the narrowing below is what picks the arm and TypeScript drops a
    // narrowing of `this.options` the moment it is used inside a callback.
    const options = this.options;
    const { aspect, change } = options;

    if ('pedalIDs' in options) {
      if (aspect === 'velocity') {
        // Not silently skipped: a pedal has no velocity, so a call asking for one was built
        // wrong, and it is owed the same report an unknown aspect gets.
        console.error('Modify: velocity is a property of a note, not of a pedal');
        return;
      }

      for (const id of options.pedalIDs) {
        const pedal = msm.pedals.find((p) => p['xml:id'] === id);
        if (!pedal) continue;
        if (aspect === 'onset') displace(pedal, change);
        else restretch(pedal, change);
      }
      return;
    }

    // Every note under the id, not `getByID`'s first one. Until a `MakeChoice` covering the
    // passage has collapsed them, an `xml:id` names one note of the score *per source* — and a
    // correction is about the note, so it belongs on whichever readings of it are still standing.
    // That is already what the `from`/`to` arm does, since `notesInRange` filters rather than finds.
    let notes;
    if ('noteIDs' in options) {
      const ids = new Set(options.noteIDs);
      notes = msm.allNotes.filter((note) => ids.has(note['xml:id']));
    } else {
      notes = msm.notesInRange(options.from, options.to, options.scope);
    }

    for (const note of notes) {
      switch (aspect) {
        case 'velocity':
          note.velocity = Math.max(0, note.velocity + change);
          break;
        case 'onset':
        case 'duration':
          // A score note the recording never played has no onset to correct, and both arms
          // below would write `NaN` over the non-finite value that says so.
          if (!Number.isFinite(note['milliseconds.date'])) continue;
          if (aspect === 'onset') displace(note, change);
          else restretch(note, change);
          break;
        default:
          console.error(`Unknown aspect: ${String(aspect)}`);
      }
    }
  }
}
