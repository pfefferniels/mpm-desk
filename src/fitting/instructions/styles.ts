/**
 * `<style>` switches and the `<styleDef>`s they name.
 *
 * The definitions themselves are espressivo's own classes — `ArticulationDef`, `OrnamentDef`,
 * `AccentuationPatternDef` — built by the caller and adopted here, so the object the caller
 * holds and the one the document serializes are one thing.
 *
 * What is this module's is the convention: one `<styleDef>` per collection, named
 * {@link DEFAULT_STYLE_NAME}, and one `<style date="0">` switch per map that names it.
 */
import { Mpm } from 'espressivo';
import { collectionNameOfKind, type AnyStyle } from 'espressivo';
import { Attribute, Element } from 'espressivo';
import { headerOf, requireElement, requireMap, mapOf, scopesOf } from './scope';
import {
  DEFAULT_STYLE_NAME,
  type DefOf,
  type DefinitionType,
  type InstructionType,
  type Scope,
  type Style,
  styleKinds,
} from './types';
import { v4 } from 'uuid';

/**
 * The `<styleDef>` definitions of `definitionType` are written into, created on demand.
 * There is only one per collection.
 */
const styleDef = (
  mpm: Mpm,
  definitionType: DefinitionType,
  scope: Scope,
  create: boolean,
): AnyStyle | null => {
  const header = headerOf(mpm, scope, create);
  if (!header) return null;

  const collection = collectionNameOfKind(styleKinds[definitionType]);
  if (collection === null) return null;

  const existing = header.getStyleDef(collection, DEFAULT_STYLE_NAME);
  if (existing || !create) return existing;
  return header.addStyleDef(collection, DEFAULT_STYLE_NAME);
};

const styleAt = (element: Element): Style => ({
  'xml:id': element.getAttributeValue('xml:id') ?? '',
  date: parseFloat(element.getAttributeValue('date') ?? '0'),
  'name.ref': element.getAttributeValue('name.ref') ?? '',
  defaultArticulation: element.getAttributeValue('defaultArticulation') ?? undefined,
});

/**
 * Add a `<style>` switch to an instruction map.
 *
 * It goes in *before* anything else at its date, so the style is in force for the instructions
 * that share it. Appended to the end of the map regardless of date, a switch leaves meico's
 * backwards scan for the style in force finding nothing, and every `@name.ref` in that map
 * unresolvable.
 */
export const insertStyle = (
  mpm: Mpm,
  style: Style,
  instructionType: InstructionType,
  scope: Scope,
): Style => {
  const map = requireMap(mpm, instructionType, scope);
  const index = map.addStyleSwitch(style.date, style['name.ref'], style['xml:id']);
  const element = requireElement(map, index, 'style switch');
  if (style.defaultArticulation !== undefined) {
    element.addAttribute(new Attribute('defaultArticulation', style.defaultArticulation));
  }
  return styleAt(element);
};

/**
 * The `<style date="0">` switch that puts this module's own `<styleDef>` in scope for a map,
 * creating it only if the map has none.
 *
 * A `<style>` switch is what makes a `@name.ref` resolvable: without one in the map, meico's
 * backwards scan finds no style and every definition the header holds is unreachable. Six
 * transformers need one, and having each write the same literal itself is a latent duplicate,
 * since neither this module nor espressivo's `addStyleSwitch` deduplicates. Asking for the
 * switch rather than inserting one makes that unrepresentable, and lets the second caller amend
 * what the first wrote instead of shadowing it.
 *
 * @param extras fields to set on the switch, whether it was just created or already there.
 * `defaultArticulation` is the only one any caller has ever needed.
 */
export const ensureDefaultStyle = (
  mpm: Mpm,
  instructionType: InstructionType,
  scope: Scope,
  extras: Pick<Style, 'defaultArticulation'> = {},
): Style => {
  const map = requireMap(mpm, instructionType, scope);
  const existing = map
    .getAllElements()
    .find(
      (entry) =>
        entry.value.getLocalName() === 'style' &&
        entry.key === 0 &&
        entry.value.getAttributeValue('name.ref') === DEFAULT_STYLE_NAME,
    )?.value;

  const element =
    existing ??
    requireElement(map, map.addStyleSwitch(0, DEFAULT_STYLE_NAME, v4()), 'style switch');

  if (extras.defaultArticulation !== undefined) {
    const attribute = element.getAttribute('defaultArticulation');
    if (attribute) attribute.setValue(extras.defaultArticulation);
    else element.addAttribute(new Attribute('defaultArticulation', extras.defaultArticulation));
  }

  return styleAt(element);
};

export const getStyles = (mpm: Mpm, instructionType: InstructionType, scope: Scope): Style[] => {
  const map = mapOf(mpm, instructionType, scope);
  if (!map) return [];
  return map
    .getAllElements()
    .filter((entry) => entry.value.getLocalName() === 'style')
    .map((entry) => styleAt(entry.value));
};

/**
 * Put a definition into the `<styleDef>` of its collection, replacing any of the same name.
 */
export const insertDefinition = <T extends DefinitionType>(
  mpm: Mpm,
  type: T,
  definition: DefOf<T>,
  scope: Scope,
): void => {
  const style = styleDef(mpm, type, scope, true);
  if (!style) return;
  // `AnyStyle` is a union of seven `Style<K>`; `addDef` is typed per kind. The kind and the
  // def come from the same `type`, which is what makes this sound.
  (style as { addDef(def: unknown): void }).addDef(definition);
};

export const getDefinitions = <T extends DefinitionType>(
  mpm: Mpm,
  type: T,
  scope?: Scope,
): DefOf<T>[] => {
  const scopes: Scope[] = scope !== undefined ? [scope] : scopesOf(mpm);
  const collection = collectionNameOfKind(styleKinds[type]);
  if (collection === null) return [];

  const result: DefOf<T>[] = [];
  for (const one of scopes) {
    const styles = headerOf(mpm, one, false)?.getAllStyleDefs(collection);
    if (!styles) continue;
    for (const style of styles.values()) {
      for (const def of style.getAllDefs().values()) result.push(def as DefOf<T>);
    }
  }
  return result;
};

/** The first definition of this type with this name, in any scope. */
export const getDefinition = <T extends DefinitionType>(
  mpm: Mpm,
  type: T,
  name: string,
): DefOf<T> | null => getDefinitions(mpm, type).find((def) => def.getName() === name) ?? null;

/**
 * Remove the definition this object stands for.
 *
 * Found by element identity rather than by name: a caller may have renamed the definition
 * through its setter, which leaves espressivo's by-name index keyed on the old name.
 */
export const removeDefinition = <T extends DefinitionType>(
  mpm: Mpm,
  type: T,
  definition: DefOf<T>,
): void => {
  const collection = collectionNameOfKind(styleKinds[type]);
  if (collection === null) return;

  for (const scope of scopesOf(mpm)) {
    const styles = headerOf(mpm, scope, false)?.getAllStyleDefs(collection);
    if (!styles) continue;
    for (const style of styles.values()) {
      for (const [key, def] of style.getAllDefs()) {
        if (def.getXml() !== definition.getXml()) continue;
        style.removeDef(key);
        return;
      }
    }
  }
};
