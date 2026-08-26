import {
  AccentuationPatternDef,
  getDefinitions,
  getInstructions,
  insertDefinition,
  mapOf,
  Mpm,
  removeDefinition,
  unwrap,
} from '../../instructions/index';
import { Alignment } from '../../alignment';
import { AbstractTransformer, type ScopedTransformationOptions } from '../Transformer';
import { InsertMetricalAccentuation } from './InsertMetricalAccentuation';
import { elementAt } from 'espressivo';

interface MergeMetricalAccentuationsOptions extends ScopedTransformationOptions {
  names: string[];
  into: string;
}

/** One accentuation's four numbers while they are being averaged, before they are a def. */
interface MergedAccentuation {
  beat: number;
  value: number;
  transitionFrom: number;
  transitionTo: number;
}

export class MergeMetricalAccentuations extends AbstractTransformer<MergeMetricalAccentuationsOptions> {
  name = 'MergeMetricalAccentuations';
  requires = [InsertMetricalAccentuation];

  constructor(options?: MergeMetricalAccentuationsOptions) {
    super(
      options || {
        names: [],
        into: '',
        scope: 'global',
      },
    );
  }

  protected transform(_: Alignment, mpm: Mpm): void {
    const allDefs = getDefinitions(mpm, 'accentuationPatternDef', this.options.scope);
    if (allDefs.length <= 1) return;

    const toMerge = allDefs.filter((a) => this.options.names.includes(a.getName()));
    if (toMerge.length <= 1) return;

    const mergedPattern = this.mergePatterns(toMerge, this.options.into);

    // Remove first, then insert. The merged pattern is a fresh definition rather than one of
    // the originals mutated in place, so the two steps do not interfere: removing the
    // originals cannot take the merged one with it.
    toMerge.forEach((def) => removeDefinition(mpm, 'accentuationPatternDef', def));
    insertDefinition(mpm, 'accentuationPatternDef', mergedPattern, this.options.scope);

    // Repoint the instructions at the merged def. A scope with no `<metricalAccentuationMap>`
    // has no instructions to repoint, and asking for its map would only create an empty one.
    const map = mapOf(mpm, 'accentuationPattern', this.options.scope);
    if (!map) return;

    for (const instruction of getInstructions(mpm, 'accentuationPattern', this.options.scope)) {
      if (!this.options.names.includes(instruction.accentuationPatternDefName)) continue;
      map.updateAccentuationPatternAt(map.getElementIndexOf(instruction.element), {
        accentuationPatternDefName: this.options.into,
      });
    }
  }

  /**
   * The running mean of the patterns' accentuations, beat by beat, as a new definition named
   * `into`. Beats the first pattern does not have are not introduced: the prototype decides
   * the beat structure, and the rest only move its values.
   *
   * The mean is taken over plain records and the definition is built once, at the end, from
   * the numbers that come out. espressivo's `AccentuationPatternDef` has no setter for one
   * accentuation's value — the alternatives were to `removeAccentuation`/`addAccentuation`
   * per pattern per beat, which rewrites the element n times to keep an intermediate nobody
   * reads, or to write through the `<accentuation>` element's attributes, which edits the
   * document behind the def's own tuple list and leaves the two disagreeing. Doing the
   * arithmetic outside the document avoids both, and keeps it literally the expression it was.
   */
  private mergePatterns(patterns: AccentuationPatternDef[], into: string): AccentuationPatternDef {
    if (patterns.length <= 1) {
      throw new Error('Cannot merge less than two patterns');
    }

    const prototype = elementAt(patterns, 0, 'the patterns to merge');
    const rest = patterns.slice(1);
    const children: MergedAccentuation[] = prototype
      .getAllAccentuations()
      .map(({ key: [beat, value, transitionFrom, transitionTo] }) => ({
        beat,
        value,
        transitionFrom,
        transitionTo,
      }));

    let n = 1;
    for (const pattern of rest) {
      for (const {
        key: [beat, value, transitionFrom, transitionTo],
      } of pattern.getAllAccentuations()) {
        const merged = children.find((a) => a.beat === beat);
        if (!merged) continue;

        merged.value = (merged.value * n + value) / (n + 1);
        merged.transitionFrom = (merged.transitionFrom * n + transitionFrom) / (n + 1);
        merged.transitionTo = (merged.transitionTo * n + transitionTo) / (n + 1);
      }
      n++;
    }

    const mergedDef = unwrap(AccentuationPatternDef.fromNameLength(into, prototype.getLength()));
    for (const child of children) {
      mergedDef.addAccentuation(child.beat, child.value, child.transitionFrom, child.transitionTo);
    }
    return mergedDef;
  }
}
