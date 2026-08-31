/**
 * The exclusivity rule as the picker states it.
 *
 * The rule itself is espressivo's — `dated.getMapOfKind(kind) ?? globalMaps[kind]` — and it is
 * not visible in anything the editor draws: two scopes are offered, one of them silently wins.
 * What is checked here is that the lock says which one, in both directions, and that it never
 * closes the door on a map that is already there.
 */
import { describe, expect, it } from 'vitest';
import { createMpm, requireMap } from '../fitting/instructions/index';
import type { Mpm, Scope } from '../fitting/instructions/index';
import { lockedScopes, type PartOption } from './scopeLock';

const PARTS: PartOption[] = [
    { scope: 0, label: 'Right hand' },
    { scope: 1, label: 'Left hand' },
];

/** A document whose named scopes each hold one `<tempo>`. */
const withTempoIn = (...scopes: Scope[]): Mpm => {
    const mpm = createMpm();
    for (const scope of scopes)
        requireMap(mpm, 'tempo', scope).addTempo({
            id: `tempo_${String(scope)}`,
            date: 0,
            bpm: 120,
            beatLength: 0.25,
        });
    return mpm;
};

describe('the scope lock', () => {
    it('locks nothing while the desk writes no map', () => {
        expect(lockedScopes(withTempoIn('global'), [], PARTS).locked.size).toBe(0);
    });

    it('locks nothing while nothing is set either way', () => {
        const lock = lockedScopes(createMpm(), ['tempo'], PARTS);

        expect(lock.locked.size).toBe(0);
        expect(lock.holding).toEqual([]);
    });

    it('locks every part once the global map is the one set', () => {
        const { locked, holding } = lockedScopes(withTempoIn('global'), ['tempo'], PARTS);

        expect(locked.has('global')).toBe(false);
        // The note in full, in each direction. It is short enough to pin, and short is the point:
        // it says which scope took the option and leaves the rule to MPM.
        expect(locked.get(0)).toBe('global is already set');
        expect(locked.get(1)).toBe(locked.get(0));
        expect(holding).toEqual(['global']);
    });

    it('locks Global once a part is the one set, and names the part', () => {
        const { locked, holding } = lockedScopes(withTempoIn(1), ['tempo'], PARTS);

        // The part's own name, as the picker shows it — `Part 2` is what the label falls back to,
        // not what the note should say once the voice layout has named the part.
        expect(locked.get('global')).toBe('Left hand is already set');
        // The other part is free: two parts with their own maps shadow nothing of each other's.
        expect(locked.has(0)).toBe(false);
        expect(locked.has(1)).toBe(false);
        // Where a picker stranded on Global belongs: the part that holds the map, not the free
        // part that happens to come first.
        expect(holding).toEqual([1]);
    });

    it('names every part that is set, and agrees with them', () => {
        const { locked } = lockedScopes(withTempoIn(0, 1), ['tempo'], PARTS);

        expect(locked.get('global')).toBe('Right hand and Left hand are already set');
    });

    it('leaves both open where a document already holds both, and locks the empty part', () => {
        // Not reachable from the editor, which is exactly why it is here: a file written
        // elsewhere can hold both maps, and locking the scope that holds one would leave the
        // calls to remove unreachable.
        const { locked } = lockedScopes(withTempoIn('global', 0), ['tempo'], PARTS);

        expect(locked.has('global')).toBe(false);
        expect(locked.has(0)).toBe(false);
        // The global map is still what part two performs, so its own map would still shadow it.
        expect(locked.get(1)).toBe('global is already set');
    });

    it('reads only the types the desk writes', () => {
        expect(lockedScopes(withTempoIn('global'), ['dynamics'], PARTS).locked.size).toBe(0);
    });
});
