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
import { correspondingDesks, type DocumentFacts } from './DeskSwitch';
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

/** The desk `App` opens for a key the aspect menu emits, by the lookup `App` itself uses. */
const deskNamed = (key: string) =>
    correspondingDesks.find((entry) => entry.displayName === key || entry.aspect === key);

/**
 * A document every desk has work to do for: two takes with a base text chosen between them, the
 * shipped transcription's note count, and a tempo drawn over it. The figures are the shipped
 * reconstruction's; only their being above zero is load-bearing.
 *
 * `unchosen: 0` is what the chosen base text amounts to here — `readings` counts what the document
 * arrived with and stays at two for good, so it is the unchosen count that says a choice has been
 * made. A fixture that left it standing would grey out eight of the desks below.
 */
const FITTED: DocumentFacts = { readings: 2, aligned: 476, tempos: 9, unchosen: 0 };

/**
 * The desks whose subject is what the recording did, by the key the menu emits for each.
 *
 * Written out rather than derived from `unavailable` being present, which would make the test say
 * "the desks that are gated are gated". Adding a desk to this list is the assertion.
 */
const PLOTS_THE_RECORDING = [
    'corrections',
    'Temporal Spread',
    'Dynamics Gradient',
    'tempo',
    'rubato',
    'dynamics',
    'Metrical Accentuation',
    'Articulation',
    'pedalling',
];

/**
 * The desks that fit *from* the recording, which is the narrower thing: they measure one row of the
 * alignment at a time, so a note carrying a row per take gives them two answers under one id and no
 * way to say which is on screen.
 *
 * The corrections desk plots the recording and is deliberately not here. It edits the takes rather
 * than fitting from them, as the alignment desk and Base Text do, and a document with a choice
 * still to make is the document those three are for.
 */
const FITS_THE_RECORDING = PLOTS_THE_RECORDING.filter((aspect) => aspect !== 'corrections');

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

    describe('the help a desk offers', () => {
        it('says what every desk shows', () => {
            // `help` is required, so the compiler already refuses a desk without the field. What it
            // cannot refuse is an empty string, which is the same desk saying nothing.
            for (const entry of correspondingDesks)
                expect(
                    entry.help.summary.trim(),
                    `the ${entry.aspect} desk has no help summary`,
                ).toBeTruthy();
        });

        it('gives every row a gesture and an effect', () => {
            // A row is two columns and both are filled, or it is a row that reads as a gesture
            // doing nothing — worse than the gesture being absent from the list.
            for (const entry of correspondingDesks)
                for (const { gesture, does } of entry.help.actions ?? []) {
                    expect(
                        gesture.trim(),
                        `a help row of the ${entry.aspect} desk names no gesture`,
                    ).toBeTruthy();
                    expect(
                        does.trim(),
                        `"${gesture}" on the ${entry.aspect} desk says nothing`,
                    ).toBeTruthy();
                }
        });

        it('names a gesture once per desk', () => {
            // The popover keys its rows on the gesture, so a second row under the same gesture is
            // a React duplicate-key warning and one of the two rows losing its identity.
            for (const entry of correspondingDesks)
                expect(
                    duplicates((entry.help.actions ?? []).map(({ gesture }) => gesture)),
                    `the ${entry.aspect} desk lists a gesture twice`,
                ).toEqual([]);
        });
    });

    describe('a desk that says it has nothing to do', () => {
        it('takes Base Text away only while the document holds fewer than two readings', () => {
            // The rule the whole desk turns on: a choice needs something to choose between. Below
            // two readings the desk is greyed out and `App` moves off it, so getting the boundary
            // wrong either hides a desk that is needed or leaves one drawing a bracket around a
            // single take.
            const entry = correspondingDesks.find(
                ({ transformerName }) => transformerName === 'MakeChoice',
            );
            expect(entry?.unavailable).toBeDefined();

            expect(entry?.unavailable?.({ ...FITTED, readings: 0 })).toBeTruthy();
            expect(entry?.unavailable?.({ ...FITTED, readings: 1 })).toBeTruthy();
            expect(entry?.unavailable?.({ ...FITTED, readings: 2 })).toBeUndefined();
        });

        it('takes the desks that plot the recording away until one is aligned', () => {
            // Every one of these draws `msm.end` wide over `msm.in(part).chords()`, and both
            // are empty before a recording is in: a blank surface with no gesture on it that
            // writes anything. The gate is `aligned` and not `readings`, because a `<when>`
            // outside a `<recording>` places its note while naming no reading.
            const nothingPlayed = { ...FITTED, readings: 0, aligned: 0 };

            for (const aspect of PLOTS_THE_RECORDING) {
                const entry = deskNamed(aspect);
                expect(
                    entry?.unavailable?.(nothingPlayed),
                    `the ${aspect} desk stays open over a score with no recording`,
                ).toBeTruthy();
                expect(
                    entry?.unavailable?.(FITTED),
                    `the ${aspect} desk stays shut over a fitted document`,
                ).toBeUndefined();
            }
        });

        it('takes the desks that fit from the recording away until a base text is chosen', () => {
            // While the readings stand side by side a score note has a row per take, and a desk
            // that measures one row at a time is handed a recorded velocity and an onset per take
            // under the one id. `Alignment.build` keeps the first row, so a plot read against a
            // rendering compares one take with another, and there is no residual to plot at all:
            // `deriveResidual` refuses an alignment on more than one reading.
            const noChoiceYet = { ...FITTED, unchosen: 450 };

            for (const aspect of FITS_THE_RECORDING) {
                const entry = deskNamed(aspect);
                expect(
                    entry?.unavailable?.(noChoiceYet),
                    `the ${aspect} desk stays open while every note is on two readings`,
                ).toBeTruthy();
                expect(
                    entry?.unavailable?.(FITTED),
                    `the ${aspect} desk stays shut once a base text has been chosen`,
                ).toBeUndefined();
            }
        });

        it('names the choice as the remedy, and the recording before it', () => {
            // The gate has to point at the desk that lifts it, and the order matters for the same
            // reason `needsTempo` comes last: with nothing aligned there is nothing to choose
            // between either, so naming the choice first would be a dead end.
            const entry = deskNamed('Articulation');
            expect(entry?.unavailable?.({ ...FITTED, unchosen: 450 })).toMatch(/base text/i);
            expect(entry?.unavailable?.({ ...FITTED, aligned: 0, unchosen: 450 })).toMatch(
                /recording/i,
            );
        });

        it('leaves the three desks whose subject is the takes open on an unchosen document', () => {
            // Where the reader has to be able to go while the readings still stand: Base Text is
            // the remedy the gate names, the alignment desk is where a second recording comes
            // from, and the corrections desk edits the recording itself. Gating these would grey
            // out the only desks that can clear the gate.
            for (const aspect of ['alignment', 'Base Text', 'corrections'])
                expect(
                    deskNamed(aspect)?.unavailable?.({ ...FITTED, unchosen: 450 }),
                    `the ${aspect} desk is greyed out over a document with a choice still to make`,
                ).toBeUndefined();
        });

        it('takes the two tick-domain desks away until a tempo is fitted', () => {
            // `residual.of(note)?.tickDate` is undefined for every note while no `<tempo>` covers
            // it, and these two have nothing else to draw or write from: the rubato desk shows no
            // hooks and `InsertRubato` returns having logged, the pedal desk shows no presses and
            // `InsertPedal` writes no `<movement>`.
            for (const aspect of ['rubato', 'pedalling']) {
                const entry = deskNamed(aspect);
                expect(
                    entry?.unavailable?.({ ...FITTED, tempos: 0 }),
                    `the ${aspect} desk stays open over a document with no tempo`,
                ).toBeTruthy();
                expect(entry?.unavailable?.(FITTED)).toBeUndefined();

                // The recording comes first: with nothing aligned there is no tempo to draw
                // either, so pointing the reader at the tempo desk would be a second dead end.
                expect(entry?.unavailable?.({ ...FITTED, aligned: 0, tempos: 0 })).toMatch(
                    /recording/i,
                );
            }
        });

        it('takes the voices desk away until a recording is aligned', () => {
            // The one desk gated over a surface that is not blank. Verovio engraves the MEI
            // whether or not a note has been played, while the parts the score is coloured by, the
            // voices the picker offers and the bars `tickRange` takes a range from all come out of
            // `msm` — so ungated it is a whole score that answers no click.
            const entry = deskNamed('voices');
            expect(entry?.unavailable?.({ ...FITTED, aligned: 0 })).toBeTruthy();
            expect(entry?.unavailable?.(FITTED)).toBeUndefined();
        });

        it('leaves the desks that read the document alone', () => {
            // The counter-examples, and the reason `unavailable` is not simply "is anything
            // loaded": all four have something to show and something to do before a note has been
            // played. Gating one would lock the reader out of the desk that starts the work.
            for (const aspect of ['metadata', 'alignment', 'narrative', 'markup'])
                expect(
                    deskNamed(aspect)?.unavailable?.({ readings: 0, aligned: 0, tempos: 0, unchosen: 0 }),
                    `the ${aspect} desk is greyed out over a score with nothing in it`,
                ).toBeUndefined();
        });

        it('leaves a desk the whole editor falls back to always available', () => {
            // `App` sends the reader to the alignment desk when the open one becomes unavailable,
            // adjusting `selectedDesk` during render. A fallback that could itself be unavailable
            // would make that adjustment set the same state on every render.
            const fallback = correspondingDesks.find(({ aspect }) => aspect === 'alignment');
            expect(fallback).toBeDefined();
            expect(fallback?.unavailable).toBeUndefined();
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
