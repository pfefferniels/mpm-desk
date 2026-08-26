import {
  ArticulationDef,
  ensureDefaultStyle,
  insertDefinition,
  Mpm,
  requireMap,
  unwrap,
} from '../../instructions/index';
import { Alignment, type AlignedNote } from '../../alignment';
import {
  AbstractTransformer,
  generateId,
  type ScopedTransformationOptions,
} from '../Transformer';
import { v4 } from 'uuid';
import { TranslatePhysicalTimeToTicks } from '../tempo/index';
import { deriveResidual, type NoteResidual } from '../../residual';

export type ArticulationProperty =
  'relativeDuration' | 'relativeVelocity' | 'absoluteDuration' | 'absoluteDurationChange';

/** The subset of an `<articulationDef>` this transformer ever states: the four it measures. */
export type ArticulationModifiers = Partial<Record<ArticulationProperty, number>>;

/** One setter per modifier, so a caller states the name once and never the spelling. */
const setModifier: Record<ArticulationProperty, (def: ArticulationDef, value: number) => void> = {
  relativeDuration: (def, value) => def.setRelativeDuration(value),
  relativeVelocity: (def, value) => def.setRelativeVelocity(value),
  absoluteDuration: (def, value) => def.setAbsoluteDuration(value),
  absoluteDurationChange: (def, value) => def.setAbsoluteDurationChange(value),
};

const isArticulationProperty = (key: string): key is ArticulationProperty =>
  Object.hasOwn(setModifier, key);

/**
 * A fresh `<articulationDef>` of this name, stating exactly the modifiers it is given.
 *
 * A modifier left out is left unstated rather than written at its neutral value — which the
 * three transformers here depend on in both directions: `MakeDefaultArticulation` writes a def
 * that says nothing but a duration, and `StylizeArticulation` reads silence as "this def cannot
 * stand in for that articulation".
 *
 * espressivo answers a `Result` because the same factory also parses an existing element; built
 * from a name it cannot fail, since the one thing that can go wrong is a missing `@name` and
 * this writes one. Hence {@link unwrap}, which reads the failure arm as the caller bug it
 * would be rather than a case to branch on.
 */
export const makeArticulationDef = (
  name: string,
  modifiers: ArticulationModifiers,
): ArticulationDef => {
  const def = unwrap(ArticulationDef.createArticulationDef(name));

  // The value is read back off `modifiers` rather than taken from the entry: `Object.entries`
  // types an optional property as present, and a caller that states a modifier as `undefined` —
  // which is how a `MeasuredArticulation` says "not measured" — would write `undefined` into the
  // document. The walk keeps the object's own key order, which the setters serialize.
  for (const modifier of Object.keys(modifiers)) {
    if (!isArticulationProperty(modifier)) continue;
    const value = modifiers[modifier];
    if (value !== undefined) setModifier[modifier](def, value);
  }
  return def;
};

export interface ArticulationUnit {
  noteIDs: string[];
  name: string;
  aspects: Set<ArticulationProperty>;
}

export type InsertArticulationOptions = ScopedTransformationOptions & ArticulationUnit;

/**
 * What one note's articulation measured out as, before any of it is written.
 *
 * Not an `AddArticulationOptions`, because none of the four modifiers ever reaches an
 * `<articulation>`: they are averaged into the definition and the instruction is written
 * pointing at it. What the instruction takes from here is the date and the note it names.
 */
type MeasuredArticulation = ArticulationModifiers & {
  date: number;
  noteid: string;
};

/**
 * Defines the articulation of a note through the attributes relativeDuration and
 * relativeVelocity. This transformer can be applied to either all notes,
 * a selection of notes or a specific part.
 *
 * @note This transformation can only be applied after both dynamics and tempo transformation.
 */
export class InsertArticulation extends AbstractTransformer<InsertArticulationOptions> {
  name = 'InsertArticulation';
  requires = [TranslatePhysicalTimeToTicks];

  constructor(options?: InsertArticulationOptions) {
    super(
      options || {
        noteIDs: [],
        aspects: new Set(),
        name: v4(),
        scope: 'global',
      },
    );
  }

  /**
   * The articulation one note calls for, measured against what the rest of the MPM already
   * renders it as.
   *
   * The divisor for `relativeVelocity` is the velocity the MPM prescribes at this date — the
   * renderer computes `velocity = dynamics x relativeVelocity`, so the ratio has to be taken
   * against the dynamics side of that product (issue #23). It is read directly off a residual
   * derived with articulation held out, rather than reached by taking an accumulated residual
   * back off the recording as `velocity - absoluteVelocityChange` — the same quantity, without
   * the intervening algebra.
   */
  private noteToArticulation(
    aspects: Set<ArticulationProperty>,
    note: AlignedNote,
    residual: NoteResidual | undefined,
  ): MeasuredArticulation {
    const tickDuration = residual?.tickDuration;
    const relativeDuration = tickDuration ? tickDuration / note.duration : undefined;

    // A prescribed volume of zero (or below) cannot be scaled into the performed one by any
    // multiplier, so there is no ratio to write. Leaving the attribute off says that
    // honestly; a guessed value would be silently wrong.
    const prescribed = residual?.renderedVelocity;
    const relativeVelocity =
      prescribed !== undefined && prescribed > 0 ? note.velocity / prescribed : undefined;

    // Both are absent where the recording did not place the note, and saying nothing is what
    // an absent measurement means: a `<articulation>` without them still articulates. The
    // cast is what let the subtraction typecheck against `undefined`, and `NaN - duration`
    // is `NaN`, which reached the document (issue #27) — `relativeDuration` above already
    // declined to guess in exactly this case.
    const absoluteDuration = tickDuration;
    const absoluteDurationChange =
      tickDuration === undefined ? undefined : tickDuration - note.duration;

    return {
      date: note.date,
      noteid: `#${note['xml:id']}`,
      relativeDuration: aspects.has('relativeDuration') ? relativeDuration : undefined,
      relativeVelocity: aspects.has('relativeVelocity') ? relativeVelocity : undefined,
      absoluteDuration: aspects.has('absoluteDuration') ? absoluteDuration : undefined,
      absoluteDurationChange: aspects.has('absoluteDurationChange')
        ? absoluteDurationChange
        : undefined,
    };
  }

  protected transform(msm: Alignment, mpm: Mpm): void {
    const { noteIDs, aspects, name } = this.options;
    const affectedNotes = noteIDs.map((id) => msm.getByID(id)).filter((n) => !!n);

    // What the MPM explains without any articulation is what articulation has to account
    // for. Derived here rather than read off the notes, so this does not depend on which
    // earlier transformer subtracted what.
    const residual = deriveResidual(msm, mpm, { without: ['articulation'] });

    const articulations: MeasuredArticulation[] = affectedNotes.map((note) =>
      this.noteToArticulation(aspects, note, residual.of(note)),
    );

    const avgs: ArticulationModifiers = {};
    Array.from(aspects)
      .map((aspect) => {
        return [aspect, articulations.map((a) => a[aspect]).filter((a) => a !== undefined)] as [
          ArticulationProperty,
          number[],
        ];
      })
      .forEach(([aspect, values]) => {
        if (values.length === 0) return;
        avgs[aspect] = values.reduce((acc, v) => acc + v, 0) / values.length;
      });

    insertDefinition(mpm, 'articulationDef', makeArticulationDef(name, avgs), this.options.scope);

    // A <style> switch is what puts the styleDef holding `def` in scope; without one the
    // @name.ref below resolves to nothing and the articulation is inert. If only
    // StylizeArticulation and MakeDefaultArticulation emitted it, a chain that ran neither
    // would produce definitions no renderer could reach.
    ensureDefaultStyle(mpm, 'articulation', this.options.scope);

    // One `<articulation>` per note, and no measured values on it: what the note is
    // articulated as now comes from the definition it refers to.
    //
    // Folding the notes at one date into a single instruction carrying `noteid="#a #b"` does
    // not work: `@noteid` is one reference, not a list — espressivo's `ArticulationMap`
    // strips the `#` and looks the remainder up as an id — so a folded instruction names
    // nothing and articulates nothing, and every articulation on a chord is inert
    // (issue #53). Only a render notices, since a reader here takes its own spelling back
    // apart wherever it needs to.
    //
    // The id is minted immediately before each insertion, not for the batch up front:
    // `generateId` picks the first suffix the map does not already use at that date, so a
    // batch that no longer has one entry per date has to let it see each one land.
    const map = requireMap(mpm, 'articulation', this.options.scope);
    for (const { date, noteid } of articulations) {
      map.addArticulation({
        date,
        noteid,
        nameRef: name,
        id: generateId('articulation', date, mpm),
      });
    }
  }
}
