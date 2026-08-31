import { OrnamentDef } from 'espressivo';
import { FrameDomain, NoteOffShift } from 'espressivo';
import { Element } from 'espressivo';
import {
  clearOrnamentDraft,
  ensureDefaultStyle,
  getInstructions,
  type Instruction,
  insertDefinition,
  Mpm,
  type OrnamentDraft,
  ornamentDraftOf,
  requireMap,
  type Scope,
  scopesOf,
} from '../../instructions/index';
import { Alignment } from '../../alignment';
import { AbstractTransformer, type TransformationOptions } from '../Transformer';
import { v4 } from 'uuid';
import { dbscan, type IPoint } from '../../dbscan';
import { InsertDynamicsGradient } from './InsertDynamicsGradient';
import { InsertTemporalSpread } from './InsertTemporalSpread';
import { elementAt, zipWith } from 'espressivo';

export interface StylizeOrnamentationOptions extends TransformationOptions {
  /**
   * The epsilon for both `frame.start` and `frameLength` of the `<temporalSpread>`, in the
   * frame's own unit. The name says ticks and a saved chain holds it under that name, but
   * `InsertTemporalSpread` measures its frames off the recording, so for every frame this
   * clusters the unit is milliseconds.
   */
  tickTolerance: number;

  /**
   * Used as epsilon for transition.from and transition.to of the dynamicsGradients
   */
  gradientTolerance: number;

  /**
   * Used as epsilon for intensity of the temporalSpread
   */
  intensityTolerance: number;
}

/**
 * One `<ornament>` together with the def fields fitted onto it.
 *
 * The draft is read once, at the top of the run, because everything below reads from it and
 * nothing from the instruction: the frame, the ramp, the intensity and the note-off shift are
 * `<ornamentDef>` fields parked on the element, not `<ornament>` attributes. The instruction is
 * carried alongside for the two things only it can answer — which element this is, and what
 * `@name.ref` to write once a definition exists.
 */
interface FittedOrnament {
  instruction: Instruction<'ornament'>;
  draft: OrnamentDraft;
}

/** The two ends of a `<dynamicsGradient>`, once a caller has decided there is one. */
interface GradientValues {
  transitionFrom: number;
  transitionTo: number;
}

/**
 * One `<ornamentDef>` the tolerances call for, and the ornaments it would cover.
 *
 * A `name` of null is a group the clustering could not hold together — the noise of either
 * level. Those ornaments get a definition each rather than one between them, and the name for
 * each is the caller's to make.
 */
interface StyleGroup {
  name: string | null;
  members: FittedOrnament[];
}

/** What the Styles desk plots: a point per framed ornament, and the styles they make. */
export interface OrnamentStyles {
  /**
   * One point per ornament, in the four dimensions the clustering measures, labelled by the
   * definition it lands in. A label of -1 is an ornament that ends up with a definition to
   * itself.
   */
  points: readonly IPoint[];

  /** How many `<ornamentDef>`s these tolerances call for, the solitary ones included. */
  definitions: number;
}

/** The five values a `<temporalSpread>` is built from, with every absence already resolved. */
interface SpreadValues {
  frameStart: number;
  frameLength: number;
  frameDomain: FrameDomain;
  intensity: number;
  noteOffShift: NoteOffShift;
}

/**
 * The note-off shift as a number dbscan can measure.
 *
 * Its epsilon is zero, so all this has to do is keep the three readings apart — and put an
 * absent shift on `false`'s coordinate, which is the reading MPM gives it and the one
 * {@link StylizeOrnamentation.temporalSpreadOf} writes into the def.
 */
const noteOffShiftCoordinate = (shift: NoteOffShift | undefined): number => {
  if (shift === NoteOffShift.Monophonic) return -1;
  return shift === NoteOffShift.True ? 1 : 0;
};

/** The four dimensions {@link StylizeOrnamentation.generateClusters} measures an ornament in. */
const coordinatesOf = ({ draft }: FittedOrnament): number[] => [
  draft.frameStart as number,
  draft.frameLength as number,
  draft.intensity || 1,
  noteOffShiftCoordinate(draft.noteOffShift),
];

/** Every `<ornament>` in a scope, paired with the def fields the fitters parked on its element. */
const fittedOrnamentsOf = (mpm: Mpm, scope: Scope): FittedOrnament[] =>
  getInstructions(mpm, 'ornament', scope).map((instruction) => ({
    instruction,
    draft: ornamentDraftOf(instruction.element),
  }));

/**
 * Those of them the clustering can key on. An ornament with a velocity ramp and no roll is
 * exactly what `InsertDynamicsGradient` fits, and it has no frame to be measured against.
 */
const framed = (ornaments: FittedOrnament[]): FittedOrnament[] =>
  ornaments.filter(
    ({ draft }) => draft.frameStart !== undefined && draft.frameLength !== undefined,
  );

/**
 * The ornaments each cluster label covers, in the order `Object.entries` walks them: the
 * numbered clusters ascending, then the noise. That is the order the definitions reach the
 * document in.
 */
const byLabel = (
  clusters: IPoint[],
  ornaments: FittedOrnament[],
): Record<string, FittedOrnament[]> =>
  zipWith(clusters, ornaments, (cluster, ornament) => ({ cluster, ornament })).reduce<
    Record<string, FittedOrnament[]>
  >((acc, { cluster, ornament }) => {
    (acc[cluster.label.toString()] ??= []).push(ornament);
    return acc;
  }, {});

export class StylizeOrnamentation extends AbstractTransformer<StylizeOrnamentationOptions> {
  name = 'StylizeOrnamentation';
  requires = [InsertDynamicsGradient, InsertTemporalSpread];

  /**
   * All three tolerances are read, and read with `??`. Hardcoding any of them discards the
   * caller's value, so that `new StylizeOrnamentation({ intensityTolerance: 0.9 })` clusters
   * at 0.3 (issue #33). `??` rather than `||` for the same reason as in
   * `StylizeArticulation`: `0` means "exact matches only", which is what the `noteoff.shift`
   * dimension of `generateClusters` already asks for.
   */
  constructor(options?: Partial<StylizeOrnamentationOptions>) {
    super({
      tickTolerance: options?.tickTolerance ?? 10,
      intensityTolerance: options?.intensityTolerance ?? 0.3,
      gradientTolerance: options?.gradientTolerance ?? 0.1,
    });
  }

  /**
   * The styles this transformer's tolerances would make over a scope's ornaments.
   *
   * For the Styles desk, which plots them so the tolerances can be chosen by eye. Every one of
   * the three moves a point between definitions here, because this is the same two-level
   * partition {@link transform} writes from — clustering alone would answer for two of them and
   * leave the gradient tolerance changing nothing on screen.
   */
  stylesOf(mpm: Mpm, scope: Scope): OrnamentStyles {
    const ornaments = framed(fittedOrnamentsOf(mpm, scope));

    const definitions = this.styleGroups(ornaments, scope).flatMap(({ name, members }) =>
      name === null ? members.map((member) => [member]) : [members],
    );

    // Only the shared definitions are numbered. An ornament standing alone is drawn as noise,
    // which is what it is: it shares its style with nothing.
    const labels = new Map<FittedOrnament, number>();
    let shared = 0;
    definitions.forEach((members) => {
      const label = members.length > 1 ? shared++ : -1;
      members.forEach((member) => labels.set(member, label));
    });

    return {
      points: ornaments.map((ornament, index) => ({
        index,
        value: coordinatesOf(ornament),
        label: labels.get(ornament) ?? -1,
      })),
      definitions: definitions.length,
    };
  }

  /**
   * The frame clusters, each sub-clustered by its gradient: one entry per definition the
   * tolerances call for.
   *
   * The outer clustering's noise is not sub-clustered. Ornaments whose rolls have nothing in
   * common are not to be merged on their ramps alone.
   */
  private styleGroups(ornaments: FittedOrnament[], scope: Scope): StyleGroup[] {
    return Object.entries(byLabel(this.generateClusters(ornaments), ornaments)).flatMap<StyleGroup>(
      ([label, group]) =>
        label === '-1'
          ? [{ name: null, members: group }]
          : Object.entries(byLabel(this.generateSubClusters(group), group)).map(
              ([subLabel, subgroup]) => ({
                name: subLabel === '-1' ? null : `def_${scope}_${label}_${subLabel}`,
                members: subgroup,
              }),
            ),
    );
  }

  generateClusters(ornaments: FittedOrnament[]): IPoint[] {
    return dbscan(ornaments.map(coordinatesOf), {
      epsilons: [
        this.options.tickTolerance,
        this.options.tickTolerance,
        this.options.intensityTolerance,
        0,
      ],
    });
  }

  generateSubClusters(ornaments: FittedOrnament[]): IPoint[] {
    const points = ornaments.map(({ draft }) => {
      return [draft.transitionFrom || 0, draft.transitionTo || 0];
    });
    return dbscan(points, {
      epsilons: [this.options.gradientTolerance, this.options.gradientTolerance],
    });
  }

  protected transform(_msm: Alignment, mpm: Mpm): void {
    for (const scope of scopesOf(mpm)) {
      const ornaments = fittedOrnamentsOf(mpm, scope);
      const filteredOrnaments = framed(ornaments);

      // An ornament can carry a velocity ramp and no roll — that is exactly what
      // `InsertDynamicsGradient` fits. Clustering keys on the frame, so those fall out here
      // and would be left pointing at `neutralArpeggio`, a name no definition ever carries.
      // They get definitions of their own, keyed on the only thing they have.
      const gradientOnly = ornaments.filter(
        ({ draft }) =>
          draft.frameStart === undefined &&
          draft.frameLength === undefined &&
          draft.transitionFrom !== undefined &&
          draft.transitionTo !== undefined,
      );

      if (filteredOrnaments.length === 0 && gradientOnly.length === 0) continue;

      // Which ornaments this run actually gave a definition to. The cleanup below is
      // restricted to these: an ornament that was skipped keeps its draft, so it still
      // describes something, rather than being emptied out while pointing at a definition
      // that does not exist. Keyed by element rather than by instruction, since an
      // instruction is a snapshot and the element is what survives being rewritten.
      const defined = new Set<Element>();

      for (const { name, members } of this.styleGroups(filteredOrnaments, scope)) {
        if (name === null) {
          members.forEach((ornament) => this.defineAndName(mpm, scope, ornament, defined));
          continue;
        }

        const def = this.mergedDef(members, name);
        if (!def) continue;

        insertDefinition(mpm, 'ornamentDef', def, scope);
        members.forEach((ornament) => this.nameAfter(mpm, ornament, def, defined));
      }

      this.defineGradientOnly(mpm, scope, gradientOnly, defined);

      ensureDefaultStyle(mpm, 'ornament', scope);

      // The working fields move into the definition, so they come off the instruction —
      // but only for the ornaments that got one. Testing `name.ref` for truthiness instead
      // would be true of an ornament that merely *arrived* carrying a reference:
      // `InsertDynamicsGradient` writes `neutralArpeggio`, a name no definition ever has.
      // Those would be stripped of the gradient they were fitted with and left pointing at
      // nothing.
      defined.forEach((element) => clearOrnamentDraft(element));
    }
  }

  /**
   * One definition for a cluster of ornaments: each value the mean of the group's.
   *
   * Averaged from the drafts themselves rather than from the clustering's coordinate vectors.
   * Reading those vectors by position — `point[3]` and `point[4]` for the two `transition.*` —
   * reads the gradient one place short, because `generateClusters` builds a **four**-dimensional
   * point ending in the note-off shift: `transitionFrom` comes back as the note-off shift and
   * `transitionTo` as `transitionFrom`, which turns every clustered crescendo into its own
   * mirror image — a truth of 39/51.5/64 refitting as 64/51.5/39. Read the draft by name and
   * the two cannot come apart.
   */
  private mergedDef(ornaments: FittedOrnament[], name: string): OrnamentDef | null {
    const mean = (of: (draft: OrnamentDraft) => number | undefined) => {
      const values = ornaments
        .map(({ draft }) => of(draft))
        .filter((value): value is number => value !== undefined);
      if (values.length === 0) return undefined;
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };

    const transitionFrom = mean((draft) => draft.transitionFrom);
    const transitionTo = mean((draft) => draft.transitionTo);

    // Neither the unit nor the note-off shift is a number to average. `generateClusters` keys
    // on the note-off shift with an epsilon of zero, so the group is uniform in it and the
    // first ornament speaks for all.
    const first = elementAt(ornaments, 0, 'the ornament cluster').draft;

    return this.buildDef(
      name,
      // Only if the group actually carries one. Defaulting the two ends to zero would
      // describe a ramp nobody measured.
      transitionFrom !== undefined && transitionTo !== undefined
        ? { transitionFrom, transitionTo }
        : undefined,
      this.temporalSpreadOf({
        frameStart: mean((draft) => draft.frameStart),
        frameLength: mean((draft) => draft.frameLength),
        noteOffShift: first.noteOffShift,
        frameDomain: first.frameDomain,
        // `?? 1`, not `|| 1`: an intensity of 0 is a legal value, not a missing one.
        intensity: mean((draft) => draft.intensity ?? 1),
      }),
    );
  }

  /**
   * The `<temporalSpread>` a draft describes — as the five values espressivo builds one from —
   * or nothing where it describes no roll.
   *
   * Every field a spread needs is optional on the draft, so this is the one place that says
   * what each absence means. The frame's two ends *are* the roll: an ornament with no frame is
   * a velocity ramp and nothing else, and writing a `<temporalSpread>` for it would describe a
   * roll that was never measured. A frame of `NaN` describes one just as little — that is the
   * "unusable frame" `defineAndName` refuses to write a definition for, and it asks here rather
   * than deciding again on its own.
   *
   * The other three have a reading when absent, and writing that reading down says exactly what
   * silence would have said: MPM reads a missing `@time.unit` as ticks, a missing
   * `@noteoff.shift` as false and a missing `@intensity` as 1. `false` is also the reading
   * `generateClusters` already gives the shift, coding absent and `false` onto the same
   * coordinate — so within a cluster the two are indistinguishable by construction and the def
   * has to pick the one dbscan saw. Naming all three costs the document nothing: espressivo
   * omits each attribute again when it holds the default.
   */
  private temporalSpreadOf(
    draft: Pick<
      OrnamentDraft,
      'frameStart' | 'frameLength' | 'noteOffShift' | 'frameDomain' | 'intensity'
    >,
  ): SpreadValues | undefined {
    const frameStart = draft.frameStart;
    const frameLength = draft.frameLength;

    if (frameStart === undefined || frameLength === undefined) return undefined;
    if (isNaN(frameStart) || isNaN(frameLength)) return undefined;

    return {
      frameStart,
      frameLength,
      noteOffShift: draft.noteOffShift ?? NoteOffShift.False,
      frameDomain: draft.frameDomain ?? FrameDomain.Ticks,
      intensity: draft.intensity ?? 1,
    };
  }

  /**
   * The `<ornamentDef>` a name and these two transformers make.
   *
   * The gradient is set before the spread because each setter appends its child as it goes, and
   * `<dynamicsGradient>` precedes `<temporalSpread>` in a def. `createOrnamentDef` answers a
   * `Result`: a name it refuses is no definition, and the caller then leaves the ornament
   * unnamed rather than pointing it at one that was never written.
   */
  private buildDef(
    name: string,
    gradient: GradientValues | undefined,
    spread: SpreadValues | undefined,
  ): OrnamentDef | null {
    const built = OrnamentDef.createOrnamentDef(name);
    if (!built.ok) return null;

    const def = built.value;
    if (gradient) {
      def.setDynamicsGradientValues(gradient.transitionFrom, gradient.transitionTo);
    }
    if (spread) {
      def.setTemporalSpreadValues(
        spread.frameStart,
        spread.frameLength,
        spread.frameDomain,
        spread.intensity,
        spread.noteOffShift,
      );
    }
    return def;
  }

  /**
   * Definitions for the ornaments that carry a ramp and no roll.
   *
   * Same shape as the framed path, one dimension shorter: sub-cluster on the gradient alone,
   * give each cluster one definition holding the mean, and leave the noise points with a
   * definition each. Without this the whole family reached the document as `@name.ref`
   * pointing at nothing — well-formed, and silent.
   */
  private defineGradientOnly(
    mpm: Mpm,
    scope: Scope,
    ornaments: FittedOrnament[],
    defined: Set<Element>,
  ) {
    if (ornaments.length === 0) return;

    const clusters = byLabel(this.generateSubClusters(ornaments), ornaments);

    for (const [label, group] of Object.entries(clusters)) {
      if (label === '-1') {
        group.forEach((ornament) => this.defineAndName(mpm, scope, ornament, defined));
        continue;
      }

      const sums = group.reduce(
        (acc, { draft }) => ({
          from: acc.from + (draft.transitionFrom as number),
          to: acc.to + (draft.transitionTo as number),
        }),
        { from: 0, to: 0 },
      );

      const def = this.buildDef(
        `def_${scope}_gradient_${label}`,
        {
          transitionFrom: sums.from / group.length,
          transitionTo: sums.to / group.length,
        },
        undefined,
      );
      if (!def) continue;

      insertDefinition(mpm, 'ornamentDef', def, scope);
      group.forEach((ornament) => this.nameAfter(mpm, ornament, def, defined));
    }
  }

  /**
   * The definition one ornament asks for, on its own — the shape a cluster of size one gets.
   *
   * Pure: naming happens where inserting does. Stamping `ornament["name.ref"] = defName` here,
   * before the callers have decided whether to insert the definition at all, would leave every
   * skipped one naming a definition that was never written.
   */
  private asDef({ draft }: FittedOrnament): OrnamentDef | null {
    // `transitionTo` is compared against undefined rather than tested for truth. Zero is a
    // legal end for a ramp — and it is the end of `InsertDynamicsGradient`'s own default
    // crescendo, `{ from: -1, to: 0 }` — so a truthiness test would drop the gradient from
    // every crescendo fitted by default.
    const gradient =
      draft.transitionFrom !== undefined && draft.transitionTo !== undefined
        ? { transitionFrom: draft.transitionFrom, transitionTo: draft.transitionTo }
        : undefined;

    return this.buildDef(`def_${v4()}`, gradient, this.temporalSpreadOf(draft));
  }

  /**
   * Insert the definition and point the ornament at it — the two halves that must not come
   * apart. An ornament whose frame did not survive translation gets neither: it keeps whatever
   * `@name.ref` it already had rather than gaining a dangling one.
   */
  private defineAndName(mpm: Mpm, scope: Scope, ornament: FittedOrnament, defined: Set<Element>) {
    const { draft } = ornament;
    const hasFrame = draft.frameStart !== undefined && draft.frameLength !== undefined;

    // Having no frame and having an unusable one are different. A gradient-only ornament has
    // nothing to check; one whose frame failed translation must not be given a definition.
    // Which frames are unusable is `temporalSpreadOf`'s to say, so it is asked rather than
    // second-guessed here.
    if (hasFrame && this.temporalSpreadOf(draft) === undefined) {
      console.error('skipping ornament with an unusable frame', ornament.instruction.id);
      return;
    }

    const def = this.asDef(ornament);
    if (!def) return;

    insertDefinition(mpm, 'ornamentDef', def, scope);
    this.nameAfter(mpm, ornament, def, defined);
  }

  /**
   * Point an ornament at the definition just written for it, and record that this run is the
   * one that defined it — which is what licenses taking the draft back off afterwards.
   */
  private nameAfter(mpm: Mpm, ornament: FittedOrnament, def: OrnamentDef, defined: Set<Element>) {
    const map = requireMap(mpm, 'ornament', ornament.instruction.scope);
    map.updateOrnamentAt(map.getElementIndexOf(ornament.instruction.element), {
      nameRef: def.getName(),
    });
    defined.add(ornament.instruction.element);
  }
}
