import {
  ArticulationDef,
  ensureDefaultStyle,
  getDefinition,
  getDefinitions,
  getInstructions,
  getStyles,
  type Instruction,
  insertDefinition,
  mapOf,
  Mpm,
  removeDefinition,
  removeInstruction,
  type Scope,
  scopesOf,
} from '../../instructions/index';
import { Alignment, type AlignedNote } from '../../alignment';
import { AbstractTransformer, type TransformationOptions } from '../Transformer';
import { dbscan, type IPoint } from '../../dbscan';
import { InsertArticulation, makeArticulationDef } from './InsertArticulation';
import { deriveResidual, type Residual } from '../../residual';
import { numberAt, zipWith } from 'espressivo';

type Articulation = Instruction<'articulation'>;

interface StylizeArticulationOptions extends TransformationOptions {
  volumeTolerance: number;
  relativeDurationTolerance: number;
}

/**
 * What an `<articulationDef>` *states* about one modifier, or `undefined` where it states
 * nothing.
 *
 * espressivo's getters cannot answer this, and deliberately so: they report what the renderer
 * will do, so a def that mentions no duration reads back as `getRelativeDuration() === 1.0` and
 * one that mentions no absolute duration as `getAbsoluteDuration() === null`. Silence is exactly
 * the distinction this transformer turns on — an articulation whose def states no relative pair
 * has no position in the clustering space, and one whose def states an absolute attribute is no
 * candidate for a shared def at all, since the defs written here carry only the relative two.
 * So the attribute is read off the element, which is the only place absence is still absence.
 */
const statedNumber = (def: ArticulationDef | null, modifier: string): number | undefined => {
  const value = def?.getXml().getAttributeValue(modifier);
  return value === null || value === undefined ? undefined : parseFloat(value);
};

/**
 * What an `<articulation>` articulates once the definition it points at has had its say.
 *
 * `absolute` records whether either absolute attribute is in force from either side. Such an
 * articulation is not a candidate for a shared definition: the defs written here carry only the
 * two relative attributes, so repointing it would silently drop the absolute one, which
 * overrides them in the renderer.
 */
interface EffectiveArticulation {
  relativeDuration?: number;
  relativeVelocity?: number;
  absolute: boolean;
}

/**
 * Merge the articulations of a document into a handful of shared definitions: cluster them by
 * what they articulate, give each cluster one `<articulationDef>`, point its members at that def
 * instead of at what they said before, and let the largest cluster become the map's
 * `defaultArticulation` so its instructions can go away entirely.
 */
export class StylizeArticulation extends AbstractTransformer<StylizeArticulationOptions> {
  name = 'StylizeArticulation';
  requires = [InsertArticulation];

  /**
   * `??`, not `||`: a tolerance of `0` is a legitimate request — it asks dbscan for exact
   * matches only, which is the same thing the fourth dimension of
   * `StylizeOrnamentation.generateClusters` already does deliberately. Under `||` it fell back
   * to the default with nothing to indicate it (issue #33), which is a bad way to answer a
   * caller who is asking for exact matches precisely because they are diagnosing this
   * transformer.
   */
  constructor(options?: Partial<StylizeArticulationOptions>) {
    super({
      volumeTolerance: options?.volumeTolerance ?? 0.01,
      relativeDurationTolerance: options?.relativeDurationTolerance ?? 0.2,
    });
  }

  /**
   * What an `<articulation>` actually articulates: what it says itself, and where it says
   * nothing, what the `<articulationDef>` its `@name.ref` names says on its behalf.
   *
   * Reading the instruction alone made this transformer a no-op in the very chain it exists
   * for (issue #25). `InsertArticulation` — the transformer it `requires`, and the only one
   * that writes `<articulation>` — folds the values it measured into a def and states no
   * modifier on the instruction at all, so both attributes read here were `undefined` for
   * all of them, `Math.abs(undefined - x)` was NaN, and `NaN <= epsilon` put every point in
   * nobody's neighbourhood: no cluster, no def, no default, nothing written. The values were
   * never lost, only moved one reference away, which is where they are read from now.
   */
  private effectiveOf(articulation: Articulation, mpm: Mpm): EffectiveArticulation {
    const def = getDefinition(mpm, 'articulationDef', articulation.nameRef);

    return {
      relativeDuration: articulation.relativeDuration ?? statedNumber(def, 'relativeDuration'),
      relativeVelocity: articulation.relativeVelocity ?? statedNumber(def, 'relativeVelocity'),
      absolute:
        (articulation.absoluteDuration ?? statedNumber(def, 'absoluteDuration')) !== undefined ||
        (articulation.absoluteDurationChange ?? statedNumber(def, 'absoluteDurationChange')) !==
          undefined,
    };
  }

  private findConflicts(
    withinNotes: AlignedNote[],
    clusteredArticulations: Articulation[],
    meanRelativeDuration: number,
    residual: Residual,
  ) {
    const conflictList = new Set<Articulation>();

    // What every note in this cluster gets stretched to once its articulation refers to the
    // cluster's def, and so the length the conflict below has to be tested against. It is
    // the def's own figure, handed in rather than re-averaged off the instructions — which
    // by this point say nothing, having inherited what they articulate from a def. A cluster
    // whose def carries no `relativeDuration` stretches nothing and can collide with
    // nothing; averaging `undefined` in makes the mean NaN, and every comparison against
    // NaN is false, which would retire the entire conflict check without saying so.
    if (!Number.isFinite(meanRelativeDuration)) return conflictList;

    for (const articulation of clusteredArticulations) {
      const date = articulation.date;
      let targetNotes = withinNotes.filter((n) => n.date === date);
      if (articulation.noteid) {
        // `@noteid` names one note, which is what the renderer reads it as. It was
        // read as a space-separated list here for as long as `InsertArticulation`
        // wrote one; that spelling articulated nothing at all (issue #53).
        const id = articulation.noteid.replace(/^#/, '');
        targetNotes = targetNotes.filter((n) => n['xml:id'] === id);
      }

      for (const note of targetNotes) {
        // A note the residual cannot place has no position on the tick grid — no
        // `<tempo>` covers it — and an overlap is a statement about two positions. So a
        // note without one can neither run into anything nor be run into, and is passed
        // over on both sides of the test. That is what the arithmetic did by accident:
        // `undefined + duration` is NaN and every comparison against it is false.
        const tickDate = residual.of(note)?.tickDate;
        if (tickDate === undefined) continue;

        const newDuration = note.duration * meanRelativeDuration;
        const newEnd = tickDate + newDuration;
        const conflicts = withinNotes.filter((n) => {
          if (n['midi.pitch'] !== note['midi.pitch']) return false;
          const otherTickDate = residual.of(n)?.tickDate;
          if (otherTickDate === undefined) return false;

          // find notes on the same pitch, where the articulated
          // note starts before the current note and ends after it
          return tickDate < otherTickDate && newEnd > otherTickDate;
        });
        if (conflicts.length > 0) {
          conflictList.add(articulation);
        }
      }
    }

    return conflictList;
  }

  /**
   * One point per articulation, in the same order, labelled with the cluster it belongs to.
   *
   * The clustering happens in (`relativeDuration`, `relativeVelocity`) space, so an
   * articulation for which neither the instruction nor its definition names both has no
   * position in it — as has one carrying an absolute duration, which no shared def written
   * here could carry over. Such an articulation is neither evidence for a cluster nor a
   * candidate for one, so it is kept out of the distance computation entirely and returned as
   * noise, which is what it means for it to be left alone, carrying whatever it already says.
   * Feeding it in instead would have compared `undefined` coordinates, and
   * `Math.abs(NaN) <= epsilon` puts it in nobody's neighbourhood while still counting as a
   * point.
   */
  /**
   * The clusters this transformer would form over a document's articulations.
   *
   * For the Style desk, which plots them so a tolerance can be chosen by eye rather than by
   * trying a value and looking at the result. It exists because the desk otherwise had to
   * reimplement {@link effectiveOf} — and the whole point of that method is that an articulation's
   * effective value may live on the `<articulationDef>` it names rather than on the instruction,
   * which is exactly the sort of thing a second implementation gets wrong.
   */
  clustersOf(articulations: readonly Articulation[], mpm: Mpm): IPoint[] {
    return this.generateClusters(articulations.map((a) => this.effectiveOf(a, mpm)));
  }

  generateClusters(effective: EffectiveArticulation[]): IPoint[] {
    const coordinates: number[][] = [];
    const placed: number[] = [];
    effective.forEach(({ relativeDuration, relativeVelocity, absolute }, index) => {
      if (relativeDuration === undefined || relativeVelocity === undefined) return;
      if (absolute) return;
      coordinates.push([relativeDuration, relativeVelocity]);
      placed.push(index);
    });

    const points: IPoint[] = effective.map((_, index) => ({ index, value: [], label: -1 }));
    dbscan(coordinates, {
      epsilons: [this.options.relativeDurationTolerance, this.options.volumeTolerance],
    }).forEach((point, i) => {
      const index = numberAt(placed, i, 'the clustered articulations');
      points[index] = { ...point, index };
    });

    return points;
  }

  /**
   * Drop the definitions this scope's articulations no longer point at.
   *
   * Only those: a def that nothing referred to before is not this transformer's to remove, and
   * one that is still referred to — by a conflicting articulation that kept its own reference,
   * by a style's `defaultArticulation`, or from another scope — is still doing its job.
   * Without this, merging leaves the styleDef holding both the def a cluster came from and the
   * def it was merged into, saying the same thing twice.
   */
  private removeMergedDefs(mpm: Mpm, scope: Scope, previouslyReferenced: Set<string>) {
    if (previouslyReferenced.size === 0) return;

    const referenced = new Set<string>();
    for (const one of scopesOf(mpm)) {
      for (const articulation of getInstructions(mpm, 'articulation', one)) {
        referenced.add(articulation.nameRef);
      }
      for (const style of getStyles(mpm, 'articulation', one)) {
        if (style.defaultArticulation !== undefined) referenced.add(style.defaultArticulation);
      }
    }

    getDefinitions(mpm, 'articulationDef', scope)
      .filter((def) => previouslyReferenced.has(def.getName()) && !referenced.has(def.getName()))
      .forEach((def) => removeDefinition(mpm, 'articulationDef', def));
  }

  protected transform(msm: Alignment, mpm: Mpm): void {
    // Where each note actually fell, under everything the MPM explains apart from
    // articulation — which is what this step is deciding. Derived once: it does not vary by
    // scope, and each call renders the document.
    const residual = deriveResidual(msm, mpm, { without: ['articulation'] });

    for (const scope of scopesOf(mpm)) {
      // The scope's own `<articulationMap>`, which is where the repointing below is
      // written. A scope without one has nothing to cluster — every step in the body is a
      // no-op on an empty set of articulations — and asking for it would create an empty
      // map in a scope that never had one.
      const map = mapOf(mpm, 'articulation', scope);
      if (!map) continue;

      // Find clusters
      const articulations = getInstructions(mpm, 'articulation', scope);
      const effective = articulations.map((a) => this.effectiveOf(a, mpm));
      const points = this.generateClusters(effective);

      // Taken before anything is rewritten: what these articulations inherited from is
      // the only thing this transformer can orphan.
      const previouslyReferenced = new Set(articulations.map((a) => a.nameRef));

      const clusters: [string, IPoint[]][] = Object.entries(Object.groupBy(points, (p) => p.label))
        .filter(([label]) => label !== '-1')
        .map(([label, cluster = []]) => [label, cluster]);

      const defs = new Map<string, ArticulationDef>(
        clusters.map(([label, cluster]): [string, ArticulationDef] => {
          // every point in a labelled cluster came through `placed`, so it carries the two
          // coordinates `generateClusters` measured; the unplaced ones stay at label -1 and
          // were filtered out above.
          const relativeDuration =
            cluster.reduce((acc, p) => acc + numberAt(p.value, 0, 'an articulation point'), 0) /
            cluster.length;
          const relativeVelocity =
            cluster.reduce((acc, p) => acc + numberAt(p.value, 1, 'an articulation point'), 0) /
            cluster.length;

          return [
            label,
            makeArticulationDef(`def_${label}`, {
              relativeDuration,
              relativeVelocity,
            }),
          ];
        }),
      );

      for (const def of defs.values()) insertDefinition(mpm, 'articulationDef', def, scope);

      const labeledArticulations = zipWith(points, articulations, (point, articulation) => ({
        point,
        articulation,
      })).reduce<Record<number, Articulation[]>>((acc, { point, articulation }) => {
        if (point.label === -1) return acc;
        (acc[point.label] ??= []).push(articulation);
        return acc;
      }, {});

      const conflictList = [];
      for (const [label, cluster] of Object.entries(labeledArticulations)) {
        const meanRelativeDuration = defs.get(label)?.getRelativeDuration();
        if (meanRelativeDuration === undefined) continue;
        conflictList.push(
          ...this.findConflicts(msm.allNotes, cluster, meanRelativeDuration, residual),
        );
      }

      for (const { point, articulation } of zipWith(
        points,
        articulations,
        (point, articulation) => ({ point, articulation }),
      )) {
        if (conflictList.includes(articulation)) continue;
        if (point.label === -1) continue;

        // What it articulates is the cluster's def from here on, so the two values it
        // states itself are removed rather than left to override it: a key carried as
        // `undefined` takes the attribute off, one left out leaves it alone.
        map.updateArticulationAt(map.getElementIndexOf(articulation.element), {
          nameRef: `def_${point.label}`,
          relativeDuration: undefined,
          relativeVelocity: undefined,
        });
      }

      // Find default articulation
      const bestCluster = clusters.reduce<[string, IPoint[]] | undefined>(
        (prev, curr) => (!prev || curr[1].length > prev[1].length ? curr : prev),
        undefined,
      );

      if (bestCluster) {
        const defName = `def_${bestCluster[0]}`;
        getInstructions(mpm, 'articulation', scope)
          .filter((a) => a.nameRef === defName)
          .forEach((a) => removeInstruction(mpm, a));

        ensureDefaultStyle(mpm, 'articulation', scope, { defaultArticulation: defName });
      } else if (defs.size > 0) {
        // if no best cluster could be determined, but there
        // are clusters, insert a default style switch
        ensureDefaultStyle(mpm, 'articulation', scope);
      }

      this.removeMergedDefs(mpm, scope, previouslyReferenced);
    }
  }
}
