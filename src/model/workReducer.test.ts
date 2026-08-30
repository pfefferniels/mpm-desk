/**
 * What the document does when it is edited.
 *
 * The rules under test are the ones that hold between the two arrays — a call names the claim it
 * is made under, a claim exists because calls are made under it — plus the two smaller promises
 * the reducer makes so that undo can work at all: it never touches what it was given, and it
 * says so by reference when an edit changed nothing.
 */
import { describe, expect, it } from 'vitest';
import {
    alignmentsOf,
    canRedo,
    canUndo,
    describesPerformance,
    EMPTY_WORK,
    initialHistory,
    MAX_HISTORY,
    metadataOf,
    partNamesOf,
    voicesOf,
    workHistoryReducer,
    workReducer,
    type WorkAction,
} from './workReducer';
import type { Call, WorkFile } from './Work';
import type { Resolution } from '../alignment/readings';

/** A `Set`-valued option, held so the tests can ask for it by identity. */
const aspects = new Set(['relativeDuration']);
/** A `Map`-valued option, likewise — `InsertDynamicsInstructions`' phantom velocities. */
const phantoms = new Map([['note_12', 64]]);

/**
 * Two claims, four calls, one of each envelope-bearing option.
 *
 * Frozen all the way down, so that a reducer reaching for anything reachable from the state
 * throws rather than passing — module code is strict, and a strict-mode write to a frozen object
 * is a `TypeError`.
 */
const base = (): WorkFile =>
    deepFrozen({
        name: 'Träumerei',
        mei: 'transcription.mei',
        mpm: 'performance.mpm',
        provenance: [
            { id: 'a', name: 'InsertTempo', options: { from: 0 }, segment: 's1' },
            { id: 'b', name: 'InsertRubato', options: { date: 720 }, segment: 's1' },
            {
                id: 'c',
                name: 'InsertArticulation',
                options: { aspects },
                elements: ['articulation_0'],
                segment: 's2',
            },
            { id: 'd', name: 'InsertDynamicsInstructions', options: { phantoms } },
        ],
        segments: [
            { id: 's1', note: 'Hinspielen auf 1' },
            { id: 's2', note: 'Nachschlag schattieren' },
        ],
    });

const deepFreeze = (value: unknown): void => {
    if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return;
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
};

const deepFrozen = (work: WorkFile): WorkFile => {
    deepFreeze(work);
    return work;
};

const byId = (work: WorkFile, id: string): Call => {
    const call = work.provenance.find((entry) => entry.id === id);
    expect(call).toBeDefined();
    return call!;
};

/** Every claim in the file has something claimed under it. */
const noEmptyClaims = (work: WorkFile) => {
    const standing = new Set(work.provenance.map((call) => call.segment));
    expect(work.segments.filter(({ id }) => !standing.has(id))).toEqual([]);
};

describe('what a desk’s gesture becomes', () => {
    it('lands under no claim, with the key absent rather than set to undefined', () => {
        // Handed a call that names one, at that: the rule belongs to the document, not to
        // whoever built the action.
        const next = workReducer(base(), {
            type: 'add-call',
            call: { id: 'e', name: 'InsertPedal', options: { from: 100 }, segment: 's1' },
        });

        const added = byId(next, 'e');
        expect('segment' in added).toBe(false);
        expect(JSON.parse(JSON.stringify(added))).toEqual({
            id: 'e',
            name: 'InsertPedal',
            options: { from: 100 },
        });
        expect(next.provenance.at(-1)).toBe(added);
    });

    it('leaves the document it was handed alone', () => {
        const before = base();
        const next = workReducer(before, {
            type: 'add-call',
            call: { id: 'e', name: 'InsertPedal', options: {} },
        });
        expect(before.provenance).toHaveLength(4);
        expect(next.provenance).toHaveLength(5);
        expect(next.segments).toBe(before.segments);
    });
});

describe('removing calls', () => {
    it('retires exactly the claims nothing is left under', () => {
        // `c` is all there is under `s2`; `s1` still has `b`.
        const next = workReducer(base(), { type: 'remove-calls', ids: ['a', 'c'] });

        expect(next.provenance.map(({ id }) => id)).toEqual(['b', 'd']);
        expect(next.segments.map(({ id }) => id)).toEqual(['s1']);
        noEmptyClaims(next);
    });

    it('keeps a claim that still has something made under it', () => {
        const next = workReducer(base(), { type: 'remove-calls', ids: ['a'] });
        expect(next.segments.map(({ id }) => id)).toEqual(['s1', 's2']);
    });

    it('says nothing happened when it removed nothing', () => {
        const before = base();
        expect(workReducer(before, { type: 'remove-calls', ids: [] })).toBe(before);
        expect(workReducer(before, { type: 'remove-calls', ids: ['nobody'] })).toBe(before);
    });
});

describe('grouping calls under a claim', () => {
    it('creates the claim and fills it in one state, never in two', () => {
        const next = workReducer(base(), {
            type: 'group-calls',
            callIds: ['d'],
            segment: { id: 's3', note: 'Hineinfallen' },
        });

        expect(next.segments.map(({ id }) => id)).toEqual(['s1', 's2', 's3']);
        expect(byId(next, 'd').segment).toBe('s3');
        // The reason it is one update: this is the state a two-step version would have shown in
        // between, and `remove-calls` would have been within its rights to sweep `s3` out of it.
        noEmptyClaims(next);
        expect(workReducer(next, { type: 'remove-calls', ids: ['a'] }).segments).toHaveLength(3);
    });

    it('moves calls into a claim that already exists without repeating it', () => {
        const next = workReducer(base(), {
            type: 'group-calls',
            callIds: ['d'],
            segment: { id: 's2', note: 'a later edit of the prose, ignored' },
        });
        expect(next.segments.map(({ id }) => id)).toEqual(['s1', 's2']);
        expect(next.segments[1].note).toBe('Nachschlag schattieren');
        expect(byId(next, 'd').segment).toBe('s2');
    });

    it('unclaims calls when the claim is null, key absent again', () => {
        const next = workReducer(base(), { type: 'group-calls', callIds: ['a', 'b'], segment: null });
        expect('segment' in byId(next, 'a')).toBe(false);
        expect('segment' in byId(next, 'b')).toBe(false);
        expect(byId(next, 'c').segment).toBe('s2');
    });

    it('says nothing happened for an empty selection, or a claim already held', () => {
        const before = base();
        expect(workReducer(before, { type: 'group-calls', callIds: [], segment: null })).toBe(
            before,
        );
        expect(
            workReducer(before, {
                type: 'group-calls',
                callIds: ['a', 'b'],
                segment: before.segments[0],
            }),
        ).toBe(before);
        expect(workReducer(before, { type: 'group-calls', callIds: ['d'], segment: null })).toBe(
            before,
        );
    });
});

describe('dissolving a claim', () => {
    it('keeps its calls and leaves them unclaimed', () => {
        const next = workReducer(base(), { type: 'dissolve-segment', segmentId: 's1' });

        expect(next.provenance.map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd']);
        expect('segment' in byId(next, 'a')).toBe(false);
        expect('segment' in byId(next, 'b')).toBe(false);
        expect(next.segments.map(({ id }) => id)).toEqual(['s2']);
        expect(byId(next, 'c').segment).toBe('s2');
    });

    it('says nothing happened for a claim the file does not hold', () => {
        const before = base();
        expect(workReducer(before, { type: 'dissolve-segment', segmentId: 's9' })).toBe(before);
    });
});

describe('the claims themselves', () => {
    it('takes a rewritten list, and recognises the same one', () => {
        const before = base();
        const edited = [{ id: 's1', note: 'Hinspielen zur 1' }, before.segments[1]];
        expect(workReducer(before, { type: 'set-segments', segments: edited }).segments).toBe(
            edited,
        );
        expect(workReducer(before, { type: 'set-segments', segments: [...before.segments] })).toBe(
            before,
        );
    });
});

describe('title and author', () => {
    const insertMetadata: Call = {
        id: 'm',
        name: 'InsertMetadata',
        options: {
            authors: [{ number: 0, text: 'Clara Schumann' }],
            comments: [{ text: 'Träumerei' }],
            relatedResources: [{ uri: 'recording.wav', type: 'audio' }],
        },
        segment: 's1',
    };

    const withMetadata = (): WorkFile =>
        deepFrozen({ ...base(), provenance: [...base().provenance, insertMetadata] });

    it('is read off the chain’s InsertMetadata call, and off nothing else', () => {
        expect(metadataOf(withMetadata())).toEqual({
            author: 'Clara Schumann',
            title: 'Träumerei',
        });
        expect(metadataOf(base())).toEqual({ author: '', title: '' });
    });

    it('reads nothing out of options that say something else entirely', () => {
        const odd: Call = {
            id: 'm',
            name: 'InsertMetadata',
            options: { authors: 7, comments: [{}] },
        };
        expect(metadataOf({ ...base(), provenance: [odd] })).toEqual({ author: '', title: '' });
    });

    it('writes back through that call, and round-trips', () => {
        const next = workReducer(withMetadata(), {
            type: 'set-metadata',
            update: (previous) => ({ ...previous, title: 'Träumerei, op. 15/7' }),
            newCallId: 'unused',
        });

        expect(metadataOf(next)).toEqual({
            author: 'Clara Schumann',
            title: 'Träumerei, op. 15/7',
        });
        expect(next.provenance.filter(({ name }) => name === 'InsertMetadata')).toHaveLength(1);
    });

    it('keeps what has no UI: the other options, and the rest of the call', () => {
        const next = workReducer(withMetadata(), {
            type: 'set-metadata',
            update: { author: 'Robert Schumann', title: 'Träumerei' },
            newCallId: 'unused',
        });

        const call = byId(next, 'm');
        expect(call.options['relatedResources']).toBe(insertMetadata.options['relatedResources']);
        expect(call.segment).toBe('s1');
    });

    it('adds the call, with the id the action carried, when the chain has none', () => {
        const next = workReducer(base(), {
            type: 'set-metadata',
            update: { author: 'Clara Schumann', title: '' },
            newCallId: 'fresh-id',
        });

        expect(next.provenance.at(-1)).toEqual({
            id: 'fresh-id',
            name: 'InsertMetadata',
            options: { authors: [{ number: 0, text: 'Clara Schumann' }], comments: [] },
        });
    });

    it('says nothing happened when the fields come back unchanged', () => {
        // Which is what tabbing out of an untouched field looks like: the desk syncs on blur.
        const before = withMetadata();
        expect(
            workReducer(before, {
                type: 'set-metadata',
                update: (previous) => previous,
                newCallId: 'unused',
            }),
        ).toBe(before);
        // Including the file that has no `InsertMetadata` at all: an empty title and an empty
        // author say nothing, and a call that writes nothing is not worth adding to the chain.
        const withNone = base();
        expect(
            workReducer(withNone, {
                type: 'set-metadata',
                update: { author: '', title: '' },
                newCallId: 'unused',
            }),
        ).toBe(withNone);
    });
});

describe('what counts as a call about the performance', () => {
    it('counts every call except the one that writes <metadata>', () => {
        const titled = workReducer(base(), {
            type: 'set-metadata',
            update: { author: 'Clara Schumann', title: 'Träumerei' },
            newCallId: 'm',
        });

        expect(titled.provenance).toHaveLength(5);
        expect(titled.provenance.filter(describesPerformance).map(({ id }) => id)).toEqual([
            'a',
            'b',
            'c',
            'd',
        ]);
    });

    it('leaves a document that has only been given a title reporting nothing at all', () => {
        // The case that makes this worth having: naming a reconstruction is not claiming
        // anything about the performance, and the metadata desk should not say it is.
        const named = workReducer(EMPTY_WORK, {
            type: 'set-metadata',
            update: { author: '', title: 'Träumerei' },
            newCallId: 'm',
        });

        expect(named.provenance).toHaveLength(1);
        expect(named.provenance.filter(describesPerformance)).toEqual([]);
    });

    it('counts the calls that reshape rather than add, and the one made a moment ago', () => {
        // `Modify` corrects the recording and `MakeChoice` picks between readings: both say
        // something about the performance, by reshaping rather than by adding. And none of the
        // three has `elements` yet — a run records those — which is why the count is taken off
        // the name here and off the elements in the narrative.
        const calls: Call[] = [
            { id: 'x', name: 'Modify', options: { velocity: 0.9 } },
            { id: 'y', name: 'MakeChoice', options: { prefer: 'recording_1' } },
            { id: 'z', name: 'InsertPedal', options: {} },
        ];

        expect(calls.every(describesPerformance)).toBe(true);
        expect(calls.some((call) => call.elements !== undefined)).toBe(false);
    });
});

describe('the desk bag', () => {
    it('takes a value or an updater, and keeps out of the document’s way', () => {
        const before = base();
        const set = workReducer(before, { type: 'set-secondary', update: { tempo: { boxes: 2 } } });
        expect(set.secondary).toEqual({ tempo: { boxes: 2 } });
        expect(set.provenance).toBe(before.provenance);

        const updated = workReducer(set, {
            type: 'set-secondary',
            update: (previous) => ({ ...previous, marked: ['note_3'] }),
        });
        expect(updated.secondary).toEqual({ tempo: { boxes: 2 }, marked: ['note_3'] });
    });

    it('says nothing happened when the updater hands its argument back', () => {
        const before = base();
        expect(
            workReducer(before, { type: 'set-secondary', update: (previous) => previous }),
        ).toBe(before);
    });
});

describe('the option envelopes', () => {
    it('carries Map and Set values through every edit, by reference', () => {
        // Not "equal to": the same objects. Anything that parsed and re-encoded them would turn
        // the shipped file's 87 envelopes into `{}`, and `{}` has no `.get`.
        const actions: WorkAction[] = [
            { type: 'add-call', call: { id: 'e', name: 'InsertPedal', options: {} } },
            { type: 'group-calls', callIds: ['c', 'd'], segment: { id: 's3', note: 'nachgeben' } },
            { type: 'dissolve-segment', segmentId: 's3' },
            { type: 'remove-calls', ids: ['a'] },
            { type: 'set-metadata', update: { author: 'C. S.', title: '' }, newCallId: 'm' },
            { type: 'set-secondary', update: { tempo: {} } },
        ];
        const after = actions.reduce(workReducer, base());

        expect(byId(after, 'c').options['aspects']).toBe(aspects);
        expect(byId(after, 'd').options['phantoms']).toBe(phantoms);
    });

    it('never writes to the state it was handed', () => {
        // The fixture is frozen all the way down; a reducer that mutated would throw here.
        const actions: WorkAction[] = [
            { type: 'add-call', call: { id: 'e', name: 'InsertPedal', options: {}, segment: 's1' } },
            { type: 'remove-calls', ids: ['c'] },
            { type: 'group-calls', callIds: ['a'], segment: { id: 's4' } },
            { type: 'group-calls', callIds: ['b'], segment: null },
            { type: 'dissolve-segment', segmentId: 's1' },
            { type: 'set-segments', segments: [{ id: 's4', note: 'weiter' }] },
            { type: 'set-secondary', update: { tempo: {} } },
            { type: 'set-metadata', update: { author: 'C. S.', title: 'T.' }, newCallId: 'm' },
            { type: 'load', work: base() },
        ];
        for (const action of actions) expect(() => workReducer(base(), action)).not.toThrow();
    });
});

// ── undo and redo ─────────────────────────────────────────────────

const add = (id: string): WorkAction => ({
    type: 'add-call',
    call: { id, name: 'InsertPedal', options: {} },
});

describe('undo and redo', () => {
    it('walks back and forward through the edits that changed something', () => {
        const opened = initialHistory(base());
        expect(canUndo(opened)).toBe(false);
        expect(canRedo(opened)).toBe(false);

        const edited = [add('e'), add('f')].reduce(workHistoryReducer, opened);
        expect(edited.present.provenance.map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
        expect(canUndo(edited)).toBe(true);

        const undone = workHistoryReducer(edited, { type: 'undo' });
        expect(undone.present.provenance.map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(canRedo(undone)).toBe(true);

        const back = workHistoryReducer(undone, { type: 'redo' });
        expect(back.present).toBe(edited.present);
        expect(canRedo(back)).toBe(false);

        const twice = [{ type: 'undo' } as const, { type: 'undo' } as const].reduce(
            workHistoryReducer,
            edited,
        );
        expect(twice.present).toBe(opened.present);
        expect(canUndo(twice)).toBe(false);
    });

    it('has nothing to do at either end', () => {
        const opened = initialHistory(base());
        expect(workHistoryReducer(opened, { type: 'undo' })).toBe(opened);
        expect(workHistoryReducer(opened, { type: 'redo' })).toBe(opened);
    });

    it('drops the future as soon as something else is edited', () => {
        const edited = [add('e'), add('f'), { type: 'undo' } as const].reduce(
            workHistoryReducer,
            initialHistory(base()),
        );
        expect(canRedo(edited)).toBe(true);

        const branched = workHistoryReducer(edited, add('g'));
        expect(canRedo(branched)).toBe(false);
        expect(branched.present.provenance.map(({ id }) => id)).toEqual([
            'a',
            'b',
            'c',
            'd',
            'e',
            'g',
        ]);
    });

    it('resets on open: there is no undoing past the file you opened', () => {
        const edited = [add('e'), add('f')].reduce(workHistoryReducer, initialHistory(base()));
        const opened = workHistoryReducer(edited, {
            type: 'load',
            work: { ...base(), name: 'Kinderszenen' },
        });

        expect(opened.present.name).toBe('Kinderszenen');
        expect(canUndo(opened)).toBe(false);
        expect(canRedo(opened)).toBe(false);
    });

    it('records no step for an edit that changed nothing', () => {
        const edited = workHistoryReducer(initialHistory(base()), add('e'));
        const noop = [
            { type: 'remove-calls', ids: [] } as const,
            { type: 'group-calls', callIds: [], segment: null } as const,
            { type: 'dissolve-segment', segmentId: 's9' } as const,
            { type: 'set-metadata', update: { author: '', title: '' }, newCallId: 'm' } as const,
        ].reduce(workHistoryReducer, edited);

        expect(noop).toBe(edited);
        expect(noop.past).toHaveLength(1);
    });

    it('leaves the desk bag out of the history, and out of what undo restores', () => {
        const edited = workHistoryReducer(initialHistory(base()), add('e'));
        const dragged = workHistoryReducer(edited, {
            type: 'set-secondary',
            update: { tempo: { boxes: 3 } },
        });

        // The bag changed; the past did not.
        expect(dragged.present.secondary).toEqual({ tempo: { boxes: 3 } });
        expect(dragged.past).toEqual(edited.past);

        // And undo takes the call back without taking the boxes with it.
        const undone = workHistoryReducer(dragged, { type: 'undo' });
        expect(undone.present.provenance.map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd']);
        expect(undone.present.secondary).toEqual({ tempo: { boxes: 3 } });

        const redone = workHistoryReducer(undone, { type: 'redo' });
        expect(redone.present.secondary).toEqual({ tempo: { boxes: 3 } });
        expect('e').toBe(redone.present.provenance.at(-1)?.id);
    });

    it('drops a bag the present does not have rather than writing an undefined key', () => {
        const dragged = workHistoryReducer(initialHistory(base()), {
            type: 'set-secondary',
            update: { tempo: {} },
        });
        const edited = workHistoryReducer(dragged, add('e'));
        const emptied = workHistoryReducer(edited, {
            type: 'load',
            work: base(),
        });
        expect('secondary' in emptied.present).toBe(false);

        // A snapshot taken while there was a bag, restored while there is none.
        const again = workHistoryReducer(workHistoryReducer(emptied, add('f')), { type: 'undo' });
        expect('secondary' in again.present).toBe(false);
    });

    it('remembers a bounded number of steps', () => {
        const many = Array.from({ length: MAX_HISTORY + 20 }, (_, index) => add(`x${index}`));
        const edited = many.reduce(workHistoryReducer, initialHistory(base()));

        expect(edited.past).toHaveLength(MAX_HISTORY);
        // The cap drops the oldest, so the reachable floor is not the opened file any more.
        expect(edited.past[0].provenance).toHaveLength(4 + 20);
    });
});

describe('the voice layout', () => {
    const processVoices: Call = {
        id: 'v',
        name: 'ProcessVoices',
        options: {
            parts: [{ number: 1, name: 'melody', voices: ['1/1'] }],
            moves: [],
            // No UI reaches this; it stands in for whatever a later build adds.
            note: 'hand-written',
        },
        segment: 's1',
    };

    const withVoices = (): WorkFile =>
        deepFrozen({ ...base(), provenance: [...base().provenance, processVoices] });

    it('reads the layout off the chain', () => {
        expect(voicesOf(withVoices())).toEqual({
            parts: [{ number: 1, name: 'melody', voices: ['1/1'] }],
            moves: [],
        });
    });

    it('reads an empty layout out of a chain that has no such call', () => {
        expect(voicesOf(base())).toEqual({ parts: [], moves: [] });
    });

    it('reads nothing out of options that say something else entirely', () => {
        const odd: Call = { id: 'v', name: 'ProcessVoices', options: { parts: 7, moves: [{}] } };
        expect(voicesOf({ ...base(), provenance: [odd] })).toEqual({ parts: [], moves: [] });
    });

    it('names only the parts somebody named', () => {
        const two: Call = {
            id: 'v',
            name: 'ProcessVoices',
            options: {
                parts: [
                    { number: 1, name: 'melody', voices: [] },
                    { number: 2, name: '', voices: [] },
                ],
                moves: [],
            },
        };
        expect(partNamesOf({ ...base(), provenance: [two] })).toEqual(new Map([[1, 'melody']]));
    });

    it('writes back through that call, and round-trips', () => {
        const next = workReducer(withVoices(), {
            type: 'set-voices',
            update: (previous) => ({
                ...previous,
                parts: [...previous.parts, { number: 2, name: 'accompaniment', voices: ['1/2'] }],
            }),
            newCallId: 'unused',
        });

        expect(voicesOf(next).parts.map((part) => part.name)).toEqual([
            'melody',
            'accompaniment',
        ]);
        expect(next.provenance.filter(({ name }) => name === 'ProcessVoices')).toHaveLength(1);
    });

    it('keeps what has no UI: the other options, and the rest of the call', () => {
        const next = workReducer(withVoices(), {
            type: 'set-voices',
            update: (previous) => ({ ...previous, moves: [{ part: 1, select: { noteIDs: ['n1'] } }] }),
            newCallId: 'unused',
        });

        const call = byId(next, 'v');
        expect(call.options['note']).toBe('hand-written');
        expect(call.segment).toBe('s1');
    });

    it('adds the call, with the id the action carried, when the chain has none', () => {
        const next = workReducer(base(), {
            type: 'set-voices',
            update: { parts: [{ number: 1, name: 'melody', voices: ['1/1'] }], moves: [] },
            newCallId: 'minted',
        });

        expect(byId(next, 'minted').name).toBe('ProcessVoices');
    });

    it('says nothing changed, by reference, when the layout comes back the same', () => {
        const work = withVoices();
        // What a blur on an untouched part name arrives as. A step here undoes nothing.
        expect(workReducer(work, { type: 'set-voices', update: (p) => p, newCallId: 'x' })).toBe(
            work,
        );
    });

    it('writes no call for an empty layout on a chain that has none', () => {
        const work = base();
        expect(
            workReducer(work, {
                type: 'set-voices',
                update: { parts: [], moves: [] },
                newCallId: 'x',
            }),
        ).toBe(work);
    });

    it('says nothing about the performance, so it is not counted as a claim', () => {
        // Laying out voices is a statement about the score's encoding: a reconstruction that has
        // only sorted its voices into parts has claimed nothing yet about how the piece was played.
        expect(describesPerformance(processVoices)).toBe(false);
    });
});

describe('the alignment', () => {
    const resolutions = new Map<string, Resolution>([
        ['missing-n7', { reading: 'omitted-passage', action: 'mark-simplification' }],
    ]);

    const align: Call = {
        id: 'al',
        name: 'Align',
        options: {
            source: 'take-1',
            midi: 'take-1.mid',
            model: 'v3',
            minConfidence: 0.25,
            resolutions,
            resp: 'NP',
            certainty: 'medium',
            // No UI reaches this; it stands in for whatever a later build adds.
            note: 'hand-written',
        },
        segment: 's1',
    };

    const aligned = (): WorkFile =>
        deepFrozen({ ...base(), provenance: [...base().provenance, align] });

    it('reads what was decided about each take off the chain', () => {
        expect(alignmentsOf(aligned())).toEqual([
            {
                source: 'take-1',
                midi: 'take-1.mid',
                model: 'v3',
                minConfidence: 0.25,
                resolutions,
                resp: 'NP',
                certainty: 'medium',
            },
        ]);
    });

    it('reads nothing out of a chain that has aligned nothing', () => {
        expect(alignmentsOf(base())).toEqual([]);
    });

    it('drops a call that does not say which recording it is about', () => {
        const nameless: Call = { id: 'al', name: 'Align', options: { midi: 'take-1.mid' } };
        expect(alignmentsOf({ ...base(), provenance: [nameless] })).toEqual([]);
    });

    it('reads a resolution that says something else entirely as no resolution', () => {
        const odd: Call = {
            id: 'al',
            name: 'Align',
            options: {
                source: 'take-1',
                resolutions: [['missing-n7', { reading: 7 }], 'nonsense'],
            },
        };
        expect(alignmentsOf({ ...base(), provenance: [odd] })[0].resolutions.size).toBe(0);
    });

    it('writes back through the call that names the same take', () => {
        const next = workReducer(aligned(), {
            type: 'set-alignment',
            alignment: {
                ...alignmentsOf(aligned())[0],
                resolutions: new Map([
                    ...resolutions,
                    ['added-p3', { reading: 'ornamentation', action: 'record' }],
                ]),
            },
            newCallId: 'unused',
        });

        expect(next.provenance.filter(({ name }) => name === 'Align')).toHaveLength(1);
        expect(alignmentsOf(next)[0].resolutions.size).toBe(2);
    });

    it('opens a second call for a second take', () => {
        const next = workReducer(aligned(), {
            type: 'set-alignment',
            alignment: {
                source: 'take-2',
                midi: 'take-2.mid',
                model: 'v3',
                minConfidence: 0,
                resolutions: new Map(),
                resp: 'NP',
                certainty: 'medium',
            },
            newCallId: 'a2',
        });

        expect(alignmentsOf(next).map((entry) => entry.source)).toEqual(['take-1', 'take-2']);
    });

    it('says nothing changed, by reference, when the same review comes back', () => {
        const work = aligned();
        expect(
            workReducer(work, {
                type: 'set-alignment',
                alignment: alignmentsOf(work)[0],
                newCallId: 'unused',
            }),
        ).toBe(work);
    });

    it('keeps what has no UI: the other options, and the rest of the call', () => {
        const next = workReducer(aligned(), {
            type: 'set-alignment',
            alignment: { ...alignmentsOf(aligned())[0], resp: 'somebody else' },
            newCallId: 'unused',
        });

        const call = byId(next, 'al');
        expect(call.options['note']).toBe('hand-written');
        expect(call.segment).toBe('s1');
    });

    it('says nothing about the performance, so it is not counted as a claim', () => {
        // Which sounding event realises which written note is what a reconstruction reads before
        // it has claimed anything at all about how the piece was played.
        expect(describesPerformance(align)).toBe(false);
    });
});
