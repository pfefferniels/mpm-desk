/**
 * Reading instructions out of an espressivo document, and the two sweeps that ask what a
 * transformer just did to it.
 *
 * espressivo reads by index and by type — `getTempoOptionsOf(3)` — and the question here is
 * "every `<tempo>` in scope S". {@link getInstructions} is that adapter, and the `READ` table
 * below is the only thing in the whole `mpm` module that knows one instruction type from
 * another. Writing needs no such table: a transformer inserting a `<tempo>` holds a `TempoMap`
 * and calls `addTempo` on it.
 */
import { Mpm } from 'espressivo';
import { Element } from 'espressivo';
import { mapOf, scopesOf } from './scope';
import { getDefinition } from './styles';
import {
  type AnyInstruction,
  type Instruction,
  type InstructionOptions,
  type InstructionType,
  instructionTypes,
  type MapFor,
  type Scope,
} from './types';
import { PULSES_PER_WHOLE } from '../ppq';

/** `NaN`, `Infinity` and `-Infinity` as an attribute would be spelled. See {@link auditInstructions}. */
const NON_FINITE = /([\w.:]+)="(-?Infinity|NaN)"/g;

/**
 * How one instruction type is read back out of its map.
 *
 * A total mapped type over {@link InstructionType}, so a ninth type added to `OptionsOfType`
 * fails to compile here rather than falling through a `switch` at runtime.
 */
const READ: {
  readonly [K in InstructionType]: (map: MapFor<K>, index: number) => InstructionOptions<K> | null;
} = {
  tempo: (map, index) => map.getTempoOptionsOf(index),
  dynamics: (map, index) => map.getDynamicsOptionsOf(index),
  movement: (map, index) => map.getMovementOptionsOf(index),
  articulation: (map, index) => map.getArticulationOptionsOf(index),
  rubato: (map, index) => map.getRubatoOptionsOf(index),
  ornament: (map, index) => map.getOrnamentOptionsOf(index),
  accentuationPattern: (map, index) => map.getAccentuationPatternOptionsOf(index),
  asynchrony: (map, index) => map.getAsynchronyOptionsOf(index),
};

/** The snapshot for the entry at `index`, or null if it is not an instruction of that type. */
const at = <K extends InstructionType>(
  type: K,
  map: MapFor<K>,
  index: number,
  scope: Scope,
): Instruction<K> | null => {
  const options = READ[type](map, index);
  const element = map.getElement(index);
  if (options === null || element === null) return null;
  return { ...options, type, element, scope };
};

/**
 * Every instruction of a type, as snapshots, in document order. `<style>` switches are
 * excluded — `getStyles` answers those.
 *
 * Naming a type gives back that type: the caller states its intent once, in the argument, and
 * does not have to repeat it as an assertion the compiler cannot check. Naming none gives every
 * type, which is what a caller wanting the whole document asks for.
 *
 * @param type the instruction type to read; all types if omitted
 * @param scope the part to read; every scope if omitted
 */
export function getInstructions<K extends InstructionType>(
  mpm: Mpm,
  type: K,
  scope?: Scope,
): Instruction<K>[];
export function getInstructions(mpm: Mpm, type?: undefined, scope?: Scope): AnyInstruction[];
export function getInstructions(mpm: Mpm, type?: InstructionType, scope?: Scope): AnyInstruction[] {
  const scopes: Scope[] = scope !== undefined ? [scope] : scopesOf(mpm);
  const types = type ? [type] : instructionTypes;

  const result: AnyInstruction[] = [];
  for (const one of scopes) {
    for (const instructionType of types) {
      const map = mapOf(mpm, instructionType, one);
      if (!map) continue;
      for (let index = 0; index < map.size(); ++index) {
        // The one uncorrelated step: `instructionType` is a loop variable over the
        // union, so nothing ties it to the map it just produced. The pairing is
        // `mapNames`'.
        const instruction = at(instructionType, map, index, one) as AnyInstruction | null;
        if (instruction) result.push(instruction);
      }
    }
  }
  return result;
}

/**
 * The instruction with this `xml:id`, or null. It searches every map, so it cannot know which
 * type it will find — callers narrow on `.type`.
 */
export const findInstructionById = (mpm: Mpm, id: string): AnyInstruction | null => {
  for (const scope of scopesOf(mpm)) {
    for (const type of instructionTypes) {
      const map = mapOf(mpm, type, scope);
      const element = map?.getElementByID(id);
      if (!map || !element) continue;
      const found = at(type, map, map.getElementIndexOf(element), scope) as AnyInstruction | null;
      if (found) return found;
    }
  }
  return null;
};

/** Remove the instruction this snapshot stands for, wherever in the document it is. */
export const removeInstruction = (mpm: Mpm, instruction: AnyInstruction): void => {
  for (const scope of scopesOf(mpm)) {
    const map = mapOf(mpm, instruction.type, scope);
    if (!map || map.getElementIndexOf(instruction.element) < 0) continue;
    map.removeElement(instruction.element);
    return;
  }
};

/**
 * What one walk of the document says about it: what every instruction currently is, and the two
 * things that are always bugs.
 *
 * `unnamed` — an instruction with no `@xml:id` cannot be named in the work file's provenance
 * and has its span silently dropped by the bake. That happened, and cost nine `<tempo>`
 * elements.
 *
 * `nonFinite` — `String(NaN)` is `'NaN'`, and `'NaN'` is a perfectly well-formed attribute
 * value: the document stays schema-valid and says something no renderer can act on, several
 * steps after the fit that produced it. espressivo will not refuse it (its RULE E1 freezes the
 * interior at logs-and-returns), so the guard is this module's. A sweep rather than a check on the
 * way in, which is what lets writes go straight through an espressivo map.
 */
interface InstructionAudit {
  readonly fingerprints: Map<string, string>;
  readonly unnamed: string[];
  readonly nonFinite: string[];
}

/**
 * One pass over every instruction, answering the three questions `AbstractTransformer.run` asks
 * after a transformer has run.
 *
 * One pass and not three, because each of them is a full walk of the document and `run` is
 * called once per transformer in the chain.
 */
export const auditInstructions = (mpm: Mpm): InstructionAudit => {
  const fingerprints = new Map<string, string>();
  const unnamed: string[] = [];
  const nonFinite: string[] = [];

  for (const instruction of getInstructions(mpm)) {
    const xml = instruction.element.toXML();

    if (instruction.id === undefined) {
      unnamed.push(`<${instruction.type}> at ${String(instruction.date)}`);
    } else {
      fingerprints.set(instruction.id, xml);
    }

    // Read off the serialized text, not off the parsed options, and not for free: the
    // attributes that most need this are the ones a fitter computes, and two of those —
    // `@bpm` and `@volume` — may hold a style-relative NAME as well as a number, so
    // espressivo reads `bpm="NaN"` back as the string `'NaN'` and a test on the parsed value
    // sees a perfectly ordinary string. The text says what the document says.
    for (const [, name, value] of xml.matchAll(NON_FINITE)) {
      nonFinite.push(`<${instruction.type} @${name}>="${value}"`);
    }
  }

  return { fingerprints, unnamed, nonFinite };
};

/**
 * Every instruction in the document, by `xml:id`, as the text of its element.
 *
 * What `AbstractTransformer.run` diffs to find out what a transformer did. Comparing the
 * serialized element rather than a set of ids catches an instruction that was *changed* as well
 * as one that was added.
 */
export const fingerprintInstructions = (mpm: Mpm): Map<string, string> =>
  auditInstructions(mpm).fingerprints;

/**
 * The instructions in force at a date: those exactly at it, plus the last one before it where
 * that instruction is still running.
 *
 * A **set**, in the sense that no instruction is named twice. Without that, one can be named
 * three times: an instruction exactly at the date is pushed by the filter and again as
 * `ongoing`, and a looping rubato covering the date qualifies on more than one count. Every
 * caller takes `[0]`, so nothing goes visibly wrong — but "the instructions in force at a date"
 * is a set to anyone reading the name (issue #47).
 *
 * Deduplicated by `element`, not by the snapshot: {@link getInstructions} builds a fresh object
 * per call, so two readings of one instruction are equal in every field and identical in none.
 * The element is what survives a snapshot, and it is the identity here.
 *
 * `articulation`, `ornament` and `asynchrony` have no branch: they are instantaneous, so being in
 * force at a date and being *at* it are the same thing, and the filter has already answered. That
 * is a statement about MPM, not an omission.
 *
 * @param beatDenominator the note value one beat of an `<accentuationPatternDef>` is worth, as a
 * time-signature denominator. An MPM document does not carry the metre — the score does — so a
 * caller that knows it has to say, and 4 is the assumption rather than the truth. Spelling the
 * conversion `* 720 * 4 / 4` instead hides the denominator's place in the arithmetic as a
 * cancelling `4 / 4` (issue #42).
 */
export const instructionsEffectiveAtDate = <K extends InstructionType>(
  mpm: Mpm,
  date: number,
  type: K,
  scope?: Scope,
  beatDenominator = 4,
): Instruction<K>[] => {
  const scopes: Scope[] = scope !== undefined ? [scope] : scopesOf(mpm);

  const seen = new Set<Element>();
  const result: Instruction<K>[] = [];
  const take = (instruction: Instruction<K>) => {
    if (seen.has(instruction.element)) return;
    seen.add(instruction.element);
    result.push(instruction);
  };

  for (const one of scopes) {
    const instructions = getInstructions(mpm, type, one);
    for (const instruction of instructions) {
      if (instruction.date === date) take(instruction);
    }

    const ongoing = instructions
      .slice()
      .reverse()
      .find((i) => i.date <= date);
    if (!ongoing) continue;

    // `Instruction<K>` for a generic `K` is not a discriminated union, so `.type` does not
    // narrow it. Widening to the union first is what makes the three arms readable.
    const running = ongoing as AnyInstruction;

    if (running.type === 'tempo' || running.type === 'dynamics' || running.type === 'movement') {
      take(ongoing);
    } else if (running.type === 'rubato') {
      // `@frameLength` is optional on the instruction — absent, the `rubatoDef` it names
      // supplies one. Reading that would mean resolving the def here; treating absence as
      // a zero-length frame gives the same reading as the arithmetic on an absent one,
      // which is `NaN` and so falls through the same way.
      if (running.loop || date < running.date + (running.frameLength ?? 0)) take(ongoing);
    } else if (running.type === 'accentuationPattern') {
      const def = getDefinition(mpm, 'accentuationPatternDef', running.accentuationPatternDefName);
      // `@length` is in beats, and a beat is `4 * ppq / denominator` ticks — the same
      // conversion espressivo's `MetricalAccentuationMap` makes when it renders the pattern.
      if (def && date < running.date + (def.getLength() * PULSES_PER_WHOLE) / beatDenominator) {
        take(ongoing);
      }
    }
  }
  return result;
};
