/**
 * The names used here for what espressivo already models, and nothing else.
 *
 * There is no record model here. `Add<X>Options` is the exact set of attributes espressivo's
 * `add<X>` writes, and `get<X>OptionsOf` reads an element back into one, so an instruction's
 * shape is espressivo's answer and this file only says which of its types goes with which name.
 *
 * Three things are this module's own:
 *
 * - **`Scope`.** The alignment names a part `'global'` or by index; espressivo names it with a `Global`
 *   or `Part` object. `document.ts` converts.
 * - **The element names.** MPM calls the element `<tempo>` and the map it lives in `tempoMap`,
 *   and the questions here are asked in element names. {@link mapNames} is that one-line pairing,
 *   `satisfies`-checked against espressivo's `MapKind`, so a map it renames stops compiling
 *   here rather than failing at runtime.
 * - **{@link Instruction}**, the result of a query: espressivo's options for an element,
 *   together with the element they were read from.
 */
import type { AddArticulationOptions } from 'espressivo';
import type { AddAsynchronyOptions } from 'espressivo';
import type { AddDynamicsOptions } from 'espressivo';
import type { AddAccentuationPatternOptions } from 'espressivo';
import type { AddMovementOptions } from 'espressivo';
import type { AddOrnamentOptions } from 'espressivo';
import type { AddRubatoOptions } from 'espressivo';
import type { AddTempoOptions } from 'espressivo';
import type { MapKind, MapOfKind } from 'espressivo';
import type { AccentuationPatternDef } from 'espressivo';
import type { ArticulationDef } from 'espressivo';
import type { OrnamentDef } from 'espressivo';
import type { StyleKind } from 'espressivo';
import type { Element } from 'espressivo';

/**
 * A part can be specified as either a given part number or global. Used by the alignment and
 * the MPM alike.
 */
export type Scope = number | 'global';

// ── instructions ──────────────────────────────────────────────────

/** The espressivo options record each instruction type is written from and read back into. */
export interface OptionsOfType {
  tempo: AddTempoOptions;
  dynamics: AddDynamicsOptions;
  movement: AddMovementOptions;
  articulation: AddArticulationOptions;
  rubato: AddRubatoOptions;
  ornament: AddOrnamentOptions;
  accentuationPattern: AddAccentuationPatternOptions;
  asynchrony: AddAsynchronyOptions;
}

export type InstructionType = keyof OptionsOfType;

/**
 * What a given instruction type is written from — so a caller states the type once.
 *
 * Not `OptionsOf`, which `Transformer.ts` already uses for the options of a *transformer*.
 */
export type InstructionOptions<K extends InstructionType> = OptionsOfType[K];

export const instructionTypes = [
  'articulation',
  'asynchrony',
  'dynamics',
  'movement',
  'ornament',
  'rubato',
  'tempo',
  'accentuationPattern',
] as const satisfies readonly InstructionType[];

/**
 * One instruction as it stands in the document: everything it says, plus where it is.
 *
 * A **snapshot**, not a live view — the result of a query, the way a row is the result of a
 * `SELECT`. Under mpm-ts these records *were* the document and assigning to one edited it,
 * which made a value that looks like data silently not be. Reading is reading; writing is a
 * call on the espressivo map, which says at the call site that the document changed.
 *
 * `element` is the identity that survives the snapshot — what `removeInstruction` finds the
 * instruction by, and what the ornament draft hangs off. Do not read attributes off it
 * directly; that is what the options are for.
 */
export type Instruction<K extends InstructionType> = InstructionOptions<K> & {
  readonly type: K;
  readonly element: Element;
  readonly scope: Scope;
};

/** Any instruction, as a union over the types — not an intersection of all of them. */
export type AnyInstruction = { [K in InstructionType]: Instruction<K> }[InstructionType];

/** Which `<dated>` map each instruction type lives in. */
export const mapNames = {
  articulation: 'articulationMap',
  asynchrony: 'asynchronyMap',
  dynamics: 'dynamicsMap',
  movement: 'movementMap',
  ornament: 'ornamentationMap',
  rubato: 'rubatoMap',
  tempo: 'tempoMap',
  accentuationPattern: 'metricalAccentuationMap',
} as const satisfies Record<InstructionType, MapKind>;

/** The espressivo map class an instruction type is written through. */
export type MapFor<K extends InstructionType> = MapOfKind[(typeof mapNames)[K]];

// ── definitions ───────────────────────────────────────────────────

/** The espressivo class each definition type is. */
export interface DefOfType {
  articulationDef: ArticulationDef;
  ornamentDef: OrnamentDef;
  accentuationPatternDef: AccentuationPatternDef;
}

export type DefinitionType = keyof DefOfType;
export type DefOf<T extends DefinitionType> = DefOfType[T];

export const definitionTypes = [
  'ornamentDef',
  'articulationDef',
  'accentuationPatternDef',
] as const satisfies readonly DefinitionType[];

/**
 * The style kind each definition type belongs to. espressivo names the `<header>` collection
 * from this (`collectionNameOfKind`), so `articulationStyles` is never spelled out here.
 */
export const styleKinds = {
  articulationDef: 'articulation',
  ornamentDef: 'ornamentation',
  accentuationPatternDef: 'metricalAccentuation',
} as const satisfies Record<DefinitionType, StyleKind>;

/** A `<style>` switch: which `<styleDef>` is in force from a date. */
export interface Style {
  'xml:id': string;
  date: number;
  'name.ref': string;
  defaultArticulation?: string;
}

/**
 * The `<styleDef>` every definition written here goes into. No more than one style per
 * collection is ever written, and the `<style>` switches emitted all name this one.
 */
export const DEFAULT_STYLE_NAME = 'performance_style';
