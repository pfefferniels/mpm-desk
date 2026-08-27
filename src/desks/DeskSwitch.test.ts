/**
 * The desk registry as *data*, checked where the compiler cannot check it.
 *
 * `correspondingDesks` is a table of bare strings, and three separate lookups are built on those
 * strings without a single one of them being typed:
 *
 *  - `transformerName` is a name rather than the transformer class. It used to be the class, and
 *    only ever for its `.name` — importing fourteen classes to read fourteen strings pulled the
 *    whole fitting chain into the registry's chunk, and the registry is imported by the aspect
 *    menu, which is on screen before any desk is open. The string costs nothing to import and buys
 *    no compile-time check in return, so a typo, a rename or a retired transformer would show only
 *    as a desk that never opens for a saved call — no error, no warning, just a click that does
 *    nothing. Resolving every name against the real transformer registry is the check that was
 *    given up, put back as a test.
 *  - `App.tsx` finds the open desk by `displayName ?? aspect`, and the desk that made a saved call
 *    by `transformerName`. Both are `.find()`, which does not complain about a second match: it
 *    silently returns the first, and the later desk becomes unreachable.
 *  - `App.tsx` also redirects retired transformer names onto a current one before that second
 *    lookup, by name again — an alias that outlives the desk it points at fails the same quiet way.
 *
 * What this file deliberately never does is touch `entry.desk`. Those are `lazy()` components:
 * rendering one, or merely awaiting its loader, would import every desk module and undo exactly
 * the code splitting the registry now exists to provide. That the field is there is the assertion.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { correspondingDesks } from './DeskSwitch';
import { getTransformerOrder, isRegistered } from '../fitting/transformers/TransformerRegistry';

// The transformer registry is module-level state that `Order.ts` fills in as a side effect of
// being imported. Without this line it would be empty here — and then every name below would fail
// to resolve at once, which is why `the transformer registry is populated` runs first: it says
// "the registry never loaded" instead of letting fourteen good names look broken.
import '../fitting/transformers/Order';

/** The keys that appear more than once, so a failure can name them rather than just a count. */
const duplicates = (keys: readonly string[]): string[] => {
    const seen = new Set<string>();
    const twice = new Set<string>();
    for (const key of keys) {
        if (seen.has(key)) twice.add(key);
        seen.add(key);
    }
    return [...twice];
};

/**
 * The registry grouped the way `AspectSelect` groups it, which is by aspect.
 *
 * Written out rather than reached for through `Map.groupBy` as the menu does: the menu runs in a
 * browser and this runs in whatever Node the suite is on, and the grouping is four lines.
 */
const byAspect = (): Map<string, typeof correspondingDesks> => {
    const groups = new Map<string, typeof correspondingDesks>();
    for (const entry of correspondingDesks) {
        const group = groups.get(entry.aspect) ?? [];
        group.push(entry);
        groups.set(entry.aspect, group);
    }
    return groups;
};

/**
 * The retired names `App.tsx` maps onto a current one before it goes looking for a desk.
 *
 * Read out of `App.tsx` rather than copied into this file. `TRANSFORMER_ALIASES` is private to one
 * callback there, and widening a module's surface so a test can see in is the wrong trade; copying
 * the three strings down here would be worse still — a second, unchecked copy of precisely the
 * kind of string this whole file exists to check, stale the first time somebody adds a fourth.
 *
 * The transformer registry's own alias support cannot stand in for this table. `registerAlias`
 * records *renames*, so that an old work file still builds the right transformer; its one entry
 * maps the misspelled `TranslatePhyiscalTimeToTicks` onto `TranslatePhysicalTimeToTicks`, which
 * has no desk at all. App's table answers a different question — which desk a retired name should
 * open — and sends all three of its keys to `InsertTempo`.
 */
const readAliasTable = (): Map<string, string> => {
    const source = readFileSync('src/App.tsx', 'utf-8');
    const body = /const TRANSFORMER_ALIASES[^=]*=\s*\{(?<body>[^}]*)\}/.exec(source)?.groups?.body;
    if (body === undefined)
        throw new Error(
            'No TRANSFORMER_ALIASES object literal in src/App.tsx. If the table moved or changed ' +
                'shape, point this reader at wherever it lives now — what matters is that the ' +
                'aliases are read from the one place they are written, not copied into the test.',
        );

    const table = new Map<string, string>();
    for (const match of body.matchAll(/(?<former>\w+)\s*:\s*'(?<current>[^']*)'/g)) {
        const { former, current } = match.groups ?? {};
        if (former !== undefined && current !== undefined) table.set(former, current);
    }
    return table;
};

describe('the desk registry', () => {
    it('holds desks at all', () => {
        // Every assertion below quantifies over this list, so an empty one would make the whole
        // file pass without reading anything.
        expect(correspondingDesks.length).toBeGreaterThan(0);
    });

    it('gives every entry an aspect and a desk', () => {
        for (const entry of correspondingDesks) {
            // The aspect is the menu's row label and, for a desk that shares its aspect with
            // nobody, the key it is selected by — an empty one is a row that cannot be read or
            // clicked, which the `string` type is perfectly happy with.
            expect(entry.aspect, `an entry has no aspect: ${JSON.stringify(entry.aspect)}`)
                .toBeTruthy();
            // Present, not resolved: see the note at the top about `lazy()`.
            expect(entry.desk, `the ${entry.aspect} entry has no desk`).toBeDefined();
        }
    });

    describe('the transformer each desk claims', () => {
        it('is a registry that actually loaded', () => {
            // Guards the side-effect import above, so that a missing `Order` import reads as one
            // failure with a plain cause rather than as every name in the table having rotted.
            expect(getTransformerOrder().length).toBeGreaterThan(0);
        });

        it('is a registered transformer, for every desk that claims one', () => {
            const claimed = correspondingDesks.flatMap((entry) =>
                entry.transformerName === undefined
                    ? []
                    : [{ aspect: entry.aspect, name: entry.transformerName }],
            );

            // Several desks carry no transformer — metadata, narrative, markup — so the list is a
            // subset of the registry, but it is not supposed to be an empty one.
            expect(claimed.length).toBeGreaterThan(0);

            for (const { aspect, name } of claimed)
                expect(
                    isRegistered(name),
                    `the ${aspect} desk claims "${name}", which no transformer is registered under`,
                ).toBe(true);
        });

        it('is claimed by only one desk', () => {
            // `focusCall` finds the desk for a saved call by this name. Two desks claiming one
            // transformer makes "jump to the desk that made this call" answer whichever of them
            // happens to be written first here.
            expect(
                duplicates(
                    correspondingDesks.flatMap((entry) =>
                        entry.transformerName === undefined ? [] : [entry.transformerName],
                    ),
                ),
            ).toEqual([]);
        });
    });

    describe('the key a desk is selected by', () => {
        it('is unique across the registry', () => {
            // `displayName ?? aspect` is what `focusCall` puts into `selectedDesk`, and the same
            // expression is what has to come back out of the `.find()` that reads it.
            expect(duplicates(correspondingDesks.map((entry) => entry.displayName ?? entry.aspect)))
                .toEqual([]);
        });

        it('picks exactly one desk, for every key the aspect menu can emit', () => {
            // The lookup in `App.tsx` is a disjunction — `displayName === key || aspect === key` —
            // so uniqueness of `displayName ?? aspect` is not on its own enough: a display name
            // that collides with some *other* entry's aspect is ambiguous too, and only this
            // reading of the two fields together catches it.
            //
            // What the menu can emit is likewise read off `AspectSelect`: an aspect with one desk
            // is a row that sends the aspect, an aspect with several is a row that expands into
            // one child per display name.
            const emitted = [...byAspect()].flatMap(([aspect, entries]) =>
                entries.length === 1
                    ? [aspect]
                    : entries.flatMap((entry) =>
                          entry.displayName === undefined ? [] : [entry.displayName],
                      ),
            );

            expect(emitted.length).toBeGreaterThan(0);

            for (const key of emitted) {
                const matched = correspondingDesks.filter(
                    (entry) => entry.displayName === key || entry.aspect === key,
                );
                expect(
                    matched.length,
                    `the menu offers "${key}", which App resolves to ${String(matched.length)} desks`,
                ).toBe(1);
            }
        });

        it('exists for every desk that shares its aspect with another', () => {
            // `AspectSelect` renders a shared aspect as an expandable row and skips any child
            // without a `displayName`, so such a desk is in the registry and unreachable from the
            // menu — present in the list, absent from the UI, no error either way.
            for (const [aspect, entries] of byAspect()) {
                if (entries.length === 1) continue;
                for (const entry of entries)
                    expect(
                        entry.displayName,
                        `${String(entries.length)} desks share the ${aspect} aspect, so each needs a displayName to be listed`,
                    ).toBeDefined();
            }
        });
    });

    describe('the retired names App.tsx redirects', () => {
        const aliases = readAliasTable();

        it('are read from App.tsx, not assumed', () => {
            // The parse is the weak link — if it silently matched nothing, the two tests below
            // would quantify over an empty table and pass having checked no alias at all.
            expect(aliases.size).toBeGreaterThan(0);
        });

        it('each point at a transformer some desk claims', () => {
            for (const [former, current] of aliases) {
                const entry = correspondingDesks.find(
                    ({ transformerName }) => transformerName === current,
                );
                expect(
                    entry,
                    `"${former}" is redirected to "${current}", which no desk claims — a saved ` +
                        'call under the old name would open nothing',
                ).toBeDefined();
            }
        });

        it('are not names a desk still claims', () => {
            // App maps the name *before* it looks for a desk, so a retired name that some desk
            // had taken up again would be redirected away from its own desk every time — the one
            // failure here that would survive a green run of every other test in this file.
            const claimed = correspondingDesks.flatMap((entry) =>
                entry.transformerName === undefined ? [] : [entry.transformerName],
            );
            for (const former of aliases.keys())
                expect(
                    claimed,
                    `"${former}" is aliased away, but a desk claims it`,
                ).not.toContain(former);
        });
    });
});
