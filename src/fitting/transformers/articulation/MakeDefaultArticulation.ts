import {
  ensureDefaultStyle,
  getInstructions,
  insertDefinition,
  Mpm,
} from '../../instructions/index';
import { Alignment, type AlignedNote } from '../../alignment';
import { AbstractTransformer, type ScopedTransformationOptions } from '../Transformer';
import { TranslatePhysicalTimeToTicks } from '../tempo/index';
import { deriveResidual } from '../../residual';
import { makeArticulationDef } from './InsertArticulation';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface MakeDefaultArticulationOptions extends ScopedTransformationOptions {}

/**
 * This transformer sets the default articulation for all notes.
 */
export class MakeDefaultArticulation extends AbstractTransformer<MakeDefaultArticulationOptions> {
  name = 'MakeDefaultArticulation';
  requires = [TranslatePhysicalTimeToTicks];

  constructor(options?: MakeDefaultArticulationOptions) {
    super(
      options || {
        scope: 'global',
      },
    );
  }

  protected transform(msm: Alignment, mpm: Mpm): void {
    // collect notes that have no articulation
    //
    // From this transformer's own scope. The articulations below are read per-scope and the
    // definition it writes is inserted per-scope; candidate notes taken from the whole score
    // would have a part-scoped call average the other parts' notes into this part's
    // `relativeDuration`, and then publish that as the part's default (issue #44).
    const notes: AlignedNote[] = msm.notesInPart(this.options.scope);
    for (const articulation of getInstructions(mpm, 'articulation', this.options.scope)) {
      if (articulation.noteid) {
        // One reference, the way the renderer reads it, and not a space-separated list —
        // see issue #53.
        const noteId = articulation.noteid.slice(1);
        const toDelete = notes.findIndex((n) => n['xml:id'] === noteId);
        if (toDelete !== -1) {
          notes.splice(toDelete, 1);
        }
      } else {
        // An <articulation> without @noteid applies to every note at its date. The splice
        // takes from the outer `notes`: an inner array of the same name would shadow it,
        // so the splice would take from the list it had just built and leave the notes in
        // `notes`, where they would count towards the default.
        for (const note of msm.notesAtDate(articulation.date, this.options.scope)) {
          const toDelete = notes.indexOf(note);
          if (toDelete !== -1) {
            notes.splice(toDelete, 1);
          }
        }
      }
    }

    if (notes.length === 0) return;

    // Held out rather than read off the score: these are the notes nothing else articulates,
    // so what articulation has to explain for them is whatever the rest of the MPM does not.
    // That includes any `defaultArticulation` a previous step left in the map — this one is
    // about to replace it, so measuring against it would be measuring against itself.
    const residual = deriveResidual(msm, mpm, { without: ['articulation'] });

    // Every rejection here has to be explicit, because the arithmetic hides two of them.
    // `undefined / duration` is NaN, which an `!isNaN` filter does catch — but a note of
    // zero duration (a grace note) gives Infinity, which it does not, and one such note
    // makes the mean Infinity. And when the filter empties the list, `0 / 0` makes the mean
    // NaN. Either way an unusable number reaches `relativeDuration` and is written out.
    const relativeDurations = notes
      .map((note) => {
        const tickDuration = residual.of(note)?.tickDuration;
        if (tickDuration === undefined || note.duration === 0) return undefined;
        return tickDuration / note.duration;
      })
      .filter((ratio): ratio is number => ratio !== undefined && Number.isFinite(ratio));

    // Nothing measurable is not the same as a default articulation of zero: say nothing.
    if (relativeDurations.length === 0) return;

    const mean = relativeDurations.reduce((acc, curr) => acc + curr, 0) / relativeDurations.length;

    const def = makeArticulationDef('default articulation', { relativeDuration: mean });
    insertDefinition(mpm, 'articulationDef', def, this.options.scope);

    ensureDefaultStyle(mpm, 'articulation', this.options.scope, {
      defaultArticulation: def.getName(),
    });
  }
}
