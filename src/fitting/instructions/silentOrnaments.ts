/**
 * Which `<ornament>`s the renderer passes over.
 *
 * An ornament carries no performance data of its own. The roll and the ramp live on the
 * `<ornamentDef>` its `@name.ref` points at, so an ornament whose reference reaches no definition
 * is well-formed, plainly visible in the markup, and silent. That is the state both fitters leave
 * their ornaments in: `InsertTemporalSpread` and `InsertDynamicsGradient` write
 * `@name.ref="neutralArpeggio"` and park the fitted values on the element as a draft (see
 * `ornamentDraft.ts`), and `StylizeOrnamentation` is what turns those into definitions and
 * repoints the ornaments at them. Until it has run, an arpeggiation desk shows a fit that changes
 * nothing in the sound.
 */
import { Mpm } from 'espressivo';
import { getInstructions } from './read';
import { mapOf, scopesOf } from './scope';
import type { Instruction, Scope } from './types';

/**
 * The ornaments in scope that reach no definition, in document order.
 *
 * The question is put to espressivo rather than answered here. Resolution takes three steps —
 * a `@name.ref`, a `<style>` switch in force at the ornament's position, and a def that style
 * knows — and `OrnamentationMap.getOrnamentDataOf` is the reader the renderer itself agrees with
 * (`apply` walks past exactly the entries it answers null for). Restating those three conditions
 * would be a second copy of the rule, free to drift from it, and the one thing this must not do
 * is call an ornament silent that sounds.
 *
 * @param scope the part to ask about; the whole document if omitted
 */
export const silentOrnaments = (mpm: Mpm, scope?: Scope): Instruction<'ornament'>[] => {
  const scopes: Scope[] = scope !== undefined ? [scope] : scopesOf(mpm);

  return scopes.flatMap((one) => {
    const map = mapOf(mpm, 'ornament', one);
    if (!map) return [];
    return getInstructions(mpm, 'ornament', one).filter(
      ({ element }) => map.getOrnamentDataOf(map.getElementIndexOf(element)) === null,
    );
  });
};
