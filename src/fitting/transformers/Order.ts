import { InsertMetricalAccentuation, MergeMetricalAccentuations } from './accentuation/index';
import { InsertArticulation, MakeDefaultArticulation } from './articulation/index';
import { StylizeArticulation } from './articulation/StylizeArticulation';
import { MakeChoice } from './choice/MakeChoice';
import { InsertDynamicsInstructions } from './dynamics/index';
import { InsertMetadata } from './metadata/index';
import { Modify } from './modification/Modify';
import {
  InsertTemporalSpread,
  InsertDynamicsGradient,
  StylizeOrnamentation,
} from './ornamentation/index';
import { InsertPedal } from './pedal/InsertPedalInstructions';
import { RoundNumbers } from './rounding/RoundNumbers';
import { InsertRubato } from './rubato/InsertRubato';
import { CombineAdjacentRubatos } from './rubato/CombineAdjacentRubatos';
import {
  InsertTempo,
  TranslatePhysicalTimeToTicks,
} from './tempo/index';
import { ProcessVoices } from './voices/index';
import type { Transformer } from './Transformer';
import {
  getTransformerOrder,
  isRegistered,
  registerAlias,
  registerTransformer,
} from './TransformerRegistry';

// Register the transformers, in reduction order — which is the order a chain runs in, whatever
// order its calls were written.
//
// Nineteen of them. What is registered is decided by whether anything in the editor can reach it,
// rather than by how often a transformer is used.
//
// Not registered: `InsertAsynchrony` and `CompressOrnamentation` appear nowhere in this
// codebase at all, and `ApproximateLogarithmicTempo` is unreachable — the app aliases it to
// `InsertTempo`'s desk, because a tempo somebody draws replaces a tempo the fitter solved for.
// None of the three has a control anywhere in the editor.
//
// Kept, despite appearing in no call of the 494 that make up the reconstruction:
// `CombineAdjacentRubatos` (the rubato desk's Combine button), `StylizeArticulation` (the
// articulation Style desk) and `MakeDefaultArticulation`. Retiring a transformer that a desk can
// still reach means deleting a control, and a control nobody notices going is much harder to ask
// for back than a registry entry nobody runs. Unused is not the same as unreachable.
//
// No registered transformer `requires` an unregistered one — checked, not assumed. A saved work
// file naming one is reported as unknown rather than silently skipped; see `validate` below.
// First, and it has to be. Everything after it that takes a scope answers through `notesInPart`,
// `notesAtDate`, `notesInRange` or `asChords`, and all four filter on `note.part` — so a fitter
// running before the layout was applied would fit the wrong notes and say nothing about it.
// `requires` cannot carry this: it asserts what came *earlier*, and nothing comes earlier.
//
// Registered by position rather than with `{ before: 'MakeChoice' }`, which would have to be
// written after the anchor it names and would read as though it ran there.
registerTransformer(ProcessVoices);
registerTransformer(MakeChoice);
registerTransformer(Modify);
// The gradient before the spread, because the spread destroys what the gradient reads.
// `InsertDynamicsGradient` sorts a chord by `milliseconds.date` to find which way its ramp runs, and
// `InsertTemporalSpread` collapses every onset in the chord onto one date. Run the other way
// round, the direction is read off onsets that no longer differ and every arpeggio's ramp comes
// back reversed — a truth of 39/51.5/64 refitting as 64/51.5/39. `InsertDynamicsGradient`'s own
// doc comment says the same. See issue #32.
//
// The order carries a second weight the two transformers do not state. They share one
// `<ornament>` through `fillInAt`, which leaves a field the element already has alone — and
// espressivo's `addOrnamentV3` always writes `@scale`, at the spec's default of 0. So an
// `<ornament>` the spread wrote already has a scale, and the gradient's fitted one would be
// dropped into it silently. Gradient first, and the question does not arise.
registerTransformer(InsertDynamicsGradient);
registerTransformer(InsertTemporalSpread);
// Before `TranslatePhysicalTimeToTicks`, because `InsertTempo` calls `shiftToFirstOnset`, which
// rewrites `milliseconds.date` on every note — and the hinge below reads the physical domain in
// order to convert it. `requires` cannot carry this: it asserts that a name appears *earlier* in
// the chain, which is the opposite relation. See issue #31, the record of the same mistake made
// with another transformer.
registerTransformer(InsertTempo);
// THE HINGE. Before it the fitters work in the recording's own domain, milliseconds, and several
// of them rewrite the recorded onsets as they go. After it the question is where a recorded onset
// falls on the score grid, in ticks — which only a tempo map can answer. Everything below names it
// in `requires` for that reason.
//
// Registered, but no longer reachable from a desk: `buildChain` puts one in every chain, so this
// entry is what gives the injected call its rank and what a `requires` naming it resolves
// against. The `requires` relations below are therefore satisfied by construction — they are kept
// because they state which side of the hinge a fitter belongs on, which is worth stating whether
// or not anything can now break it.
registerTransformer(TranslatePhysicalTimeToTicks);
registerTransformer(StylizeOrnamentation);
registerTransformer(InsertRubato);
registerTransformer(CombineAdjacentRubatos);
registerTransformer(InsertDynamicsInstructions);
registerTransformer(InsertMetricalAccentuation);
registerTransformer(MergeMetricalAccentuations);
registerTransformer(InsertArticulation);
registerTransformer(StylizeArticulation);
registerTransformer(MakeDefaultArticulation);
registerTransformer(InsertPedal);
registerTransformer(InsertMetadata);
// Last, and it has to be: it restates what every call before it wrote, so anything registered
// after it would be fitting against numbers that are about to be rewritten. Injected rather than
// offered, like the hinge above — see the note on `INJECTED` in `chain.ts`.
registerTransformer(RoundNumbers);

// The class name was misspelled, and the misspelling reached saved work files.
registerAlias('TranslatePhyiscalTimeToTicks', 'TranslatePhysicalTimeToTicks');

/**
 * This function is meant to be passed to Array.sort()
 *
 * A name the registry has never seen sorts *after* everything known rather than before it:
 * `indexOf` answers -1, which taken as a rank would place an unregistered transformer ahead of
 * the chain it depends on. `validate` reports the name separately, so the ordering here only has
 * to be the least surprising of the two possible wrong answers.
 */
export const compareTransformers = (a: Transformer, b: Transformer): number => {
  const currentOrder = getTransformerOrder();
  const rank = (name: string) => {
    const index = currentOrder.indexOf(name);
    return index === -1 ? currentOrder.length : index;
  };
  const aIndex = rank(a.name);
  const bIndex = rank(b.name);

  if (aIndex === bIndex) {
    if (
      'from' in a.options &&
      'from' in b.options &&
      typeof a.options.from === 'number' &&
      typeof b.options.from === 'number'
    ) {
      return a.options.from - b.options.from;
    }
  }

  return aIndex - bIndex;
};

export interface ValidationMessage {
  index: number;
  message: string;
}

export const validate = (chain: Transformer[]): ValidationMessage[] => {
  const messages: ValidationMessage[] = [];
  const done: string[] = [];
  for (const t of chain) {
    // An unregistered name cannot be rebuilt from a saved work file and is dropped by the
    // pipeline, so the chain would run without it and say nothing. Report it instead.
    if (!isRegistered(t.name)) {
      messages.push({
        index: chain.indexOf(t),
        message: `Transformer ${t.name} is not registered, so it cannot be ordered, saved or run`,
      });
    }
    for (const required of t.requires) {
      const instance = new required();
      if (!done.includes(instance.name)) {
        messages.push({
          index: chain.indexOf(t),
          message: `Transformer ${t.name} requires ${instance.name} to be present in the chain`,
        });
      }
    }
    done.push(t.name);
  }
  return messages;
};
