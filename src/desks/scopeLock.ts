/**
 * Which scopes the open desk may not write into, and which scope is set instead.
 *
 * MPM does not merge a part's map with the global map of the same type. espressivo resolves a
 * part's maps as `dated.getMapOfKind(kind) ?? globalMaps[kind]` (`Performance.resolvePartMaps`),
 * so whichever of the two exists is the only one that part performs — one part-local `<tempo>`
 * and that part stops following every global one. Offering both scopes once one of them is set is
 * therefore offering a write that something else already overrides.
 *
 * The rule is symmetric: **a scope is locked while it holds nothing of what the desk writes and
 * the other kind of scope does**. Global goes out as soon as a part has its own map, a part as
 * soon as `<global>` has one. A scope already holding instructions is never locked, that being
 * where the calls to remove are, and a document written elsewhere can hold both at once.
 *
 * The note against a locked option names the scope that took it and stops there. What shadowing
 * is, and that a map is per instruction type, is MPM.
 *
 * Greying the options guards only the move between them, which is why {@link ScopeLock.holding}
 * is here too: a picker left sitting on a locked scope makes the same mistake silently.
 *
 * Which types a desk writes is `writes` in `DeskSwitch.tsx`; a desk that declares none locks
 * nothing.
 */
import { getInstructions } from '../fitting/instructions/index';
import type { InstructionType, Mpm, Scope } from '../fitting/instructions/index';

/** A part the scope picker offers. */
export interface PartOption {
    /** The part's index, as the alignment numbers them — `Part 1` is `0`. */
    scope: number;
    /** What the voice layout calls it, or `Part n` where nothing has named it. */
    label: string;
}

/** What the exclusivity rule says about the document in hand. */
export interface ScopeLock {
    /**
     * Scope ⇒ the note that stands against it, saying which scope is set in its place. Empty
     * while every scope is free.
     */
    readonly locked: ReadonlyMap<Scope, string>;
    /**
     * The scopes that already hold what the desk writes, `<global>` first — so the first of them
     * is where a picker stranded on a locked scope belongs. Never empty while `locked` is not:
     * a scope is locked only because another one holds the map.
     */
    readonly holding: readonly Scope[];
}

/** Nothing locked: no desk that writes a map is open, or no document is loaded yet. */
export const NO_SCOPE_LOCK: ScopeLock = { locked: new Map(), holding: [] };

/** `Part 1`, `Part 1 and Part 2`, `Part 1, Part 2 and Part 3`. */
const listed = (names: readonly string[]): string => {
    const last = names.at(-1);
    if (last === undefined) return '';
    return names.length === 1 ? last : `${names.slice(0, -1).join(', ')} and ${last}`;
};

const agree = (count: number, one: string, several: string): string => (count === 1 ? one : several);

/** What the picker may do, for the document in hand and the types the open desk writes. */
export const lockedScopes = (
    mpm: Mpm,
    writes: readonly InstructionType[],
    parts: readonly PartOption[],
): ScopeLock => {
    if (writes.length === 0) return NO_SCOPE_LOCK;

    const typesIn = (scope: Scope) =>
        writes.filter((type) => getInstructions(mpm, type, scope).length > 0);

    const inGlobal = typesIn('global');
    const inParts = parts.map((part) => ({ ...part, types: typesIn(part.scope) }));
    const setParts = inParts.filter((part) => part.types.length > 0);

    const locked = new Map<Scope, string>();

    if (inGlobal.length === 0 && setParts.length > 0) {
        const labels = setParts.map((part) => part.label);
        locked.set('global', `${listed(labels)} ${agree(labels.length, 'is', 'are')} already set`);
    }

    if (inGlobal.length > 0)
        for (const part of inParts)
            if (part.types.length === 0) locked.set(part.scope, 'global is already set');

    const holding: Scope[] = inGlobal.length > 0 ? ['global'] : [];
    holding.push(...setParts.map((part) => part.scope));

    return { locked, holding };
};
