/**
 * Saving, checked — because a save is the only step in the editor with no second chance.
 *
 * Everything else a desk does can be undone or refitted; the archive is what is left when the tab
 * is closed, and it is written by folding three separate things together. So what is checked here
 * is that nothing goes missing on the way out: which reading each note was taken from lands on the
 * note, what the run made each call answerable for lands on the call, and the four files a viewer
 * expects are all in the bag with their contents intact — including the option envelopes, which
 * turn into `{}` the moment a round trip skips {@link serializeWorkFile}.
 *
 * A couple of tests below pin behaviour that is arguably wrong rather than behaviour that is
 * wanted; each one says so where it stands. They are here so that a fix shows up as a failure
 * instead of as nothing at all.
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildWorkArchive, injectChoices, provenanceOf, type WorkArchiveInput } from './exportWork';
import { parseWorkFile, type Call } from './Work';
import { Alignment, type AlignedNote } from '../fitting/alignment';
import { createMpm, exportMPM } from '../fitting/instructions/index';
import type { CallOutcome } from './Reconstruction';

/**
 * Three notes, and one `<when>` per note under a single take.
 *
 * Hand-written rather than taken from `latest/transcription.mei`, which is the real thing at
 * 472 KB: what these tests are about is which `@corresp` reaches which `<note>`, and three notes
 * show that as well as 463 do while still fitting on the screen.
 */
const mei = (): string => `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei">
   <music>
      <body>
         <mdiv><score><section><measure>
            <note xml:id="n1" pname="c" oct="4"/>
            <note xml:id="n2" pname="d" oct="4"/>
            <note xml:id="n3" pname="e" oct="4"/>
         </measure></section></score></mdiv>
      </body>
      <performance>
         <recording source="take-a">
            <when absolute="0ms" corresp="symbol_a1" data="#n1"/>
            <when absolute="500ms" corresp="symbol_a2" data="#n2"/>
            <when absolute="1000ms" corresp="symbol_a3" data="#n3"/>
         </recording>
      </performance>
   </music>
</mei>`;

/** One note of the alignment. Only `xml:id` and `date` decide anything below. */
const note = (id: string, date: number): AlignedNote => ({
    'xml:id': id,
    part: 0,
    date,
    duration: 720,
    pitchname: 'c',
    accidentals: 0,
    octave: 4,
    'midi.pitch': 60,
    'milliseconds.date': date,
    'milliseconds.date.end': date + 500,
    velocity: 64,
});

const alignment = (): Alignment =>
    new Alignment([note('n1', 0), note('n2', 720), note('n3', 1440)]);

/** What each `<note>` says it was performed as, after a fold. */
const correspondences = (xml: string): Record<string, string | null> => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return Object.fromEntries(
        [...doc.querySelectorAll('note')].map((n) => [
            n.getAttribute('xml:id'),
            n.getAttribute('corresp'),
        ]),
    );
};

describe('injectChoices', () => {
    it('writes the chosen `@corresp` onto the notes a ranged choice covers', () => {
        const folded = injectChoices(mei(), alignment(), [
            { scope: 'global', from: 0, to: 1440, prefer: 'take-a' },
        ]);

        // `to` is exclusive here — n3 sits exactly on it and is left alone. Worth pinning: the
        // `MakeChoice` transformer this mirrors compares `<=`, so the two disagree about the note
        // on the boundary.
        expect(correspondences(folded)).toEqual({
            n1: 'symbol_a1',
            n2: 'symbol_a2',
            n3: null,
        });
    });

    it('writes it onto exactly the notes a `noteIDs` choice names', () => {
        const folded = injectChoices(mei(), alignment(), [
            { scope: 'global', noteIDs: ['n1', 'n3'], prefer: 'take-a' },
        ]);

        expect(correspondences(folded)).toEqual({
            n1: 'symbol_a1',
            n2: null,
            n3: 'symbol_a3',
        });
    });

    it('writes it onto every note for a choice that names no place at all', () => {
        const folded = injectChoices(mei(), alignment(), [{ prefer: 'take-a' }]);

        expect(correspondences(folded)).toEqual({
            n1: 'symbol_a1',
            n2: 'symbol_a2',
            n3: 'symbol_a3',
        });
    });

    it('leaves a note that already carries one alone, so the first choice decides it', () => {
        const withAnswer = mei().replace(
            '<note xml:id="n2"',
            '<note corresp="symbol_kept" xml:id="n2"',
        );
        const folded = injectChoices(withAnswer, alignment(), [{ prefer: 'take-a' }]);

        expect(correspondences(folded).n2).toBe('symbol_kept');
    });

    it('skips a choice naming a take this MEI does not carry, rather than throwing', () => {
        const folded = injectChoices(mei(), alignment(), [{ prefer: 'take-nobody-recorded' }]);

        expect(correspondences(folded)).toEqual({ n1: null, n2: null, n3: null });
    });

    it('leaves the score untouched where no choice applies to it', () => {
        expect(injectChoices(mei(), alignment(), [])).toContain('<note xml:id="n1"');
    });

    it('strips every take when asked to', () => {
        const twoTakes = mei().replace(
            '</performance>',
            '   <recording source="take-b"/>\n      </performance>',
        );
        const folded = injectChoices(twoTakes, alignment(), [{ prefer: 'take-a' }], true);

        expect(folded).not.toContain('<recording');
        // The answers survive their source being removed — which is the point of folding them in.
        expect(correspondences(folded).n1).toBe('symbol_a1');
    });

    // ── behaviour recorded rather than wanted ─────────────────────────

    it('skips a split velocity/timing choice entirely', () => {
        // The two source ids are joined with a space and looked up as one — `"take-a take-b"`
        // names no `<recording>`, so every such choice falls out of the loop. The shipped
        // reconstruction only ever writes `prefer`, so nothing depends on this today.
        const twoTakes = mei().replace(
            '</performance>',
            '   <recording source="take-b"/>\n      </performance>',
        );
        const folded = injectChoices(twoTakes, alignment(), [
            {
                scope: 'global',
                from: 0,
                to: 2000,
                velocity: 'take-a',
                timing: 'take-b',
                pedalling: 'take-a',
            },
        ]);

        expect(correspondences(folded)).toEqual({ n1: null, n2: null, n3: null });
    });

    it('takes the `<when>` from the first take in the document, whichever one was preferred', () => {
        // The `<recording>` the choice names is looked up only to decide whether to go on; the
        // `<when>` is then searched for across the whole document, so the earliest take wins. Both
        // takes in the shipped MEI carry a `<when>` for all 463 notes, and the one choice in the
        // shipped chain happens to prefer the first — so this is latent, not active.
        const twoTakes = mei().replace(
            '</performance>',
            `   <recording source="take-b">
            <when absolute="10ms" corresp="symbol_b1" data="#n1"/>
         </recording>
      </performance>`,
        );
        const folded = injectChoices(twoTakes, alignment(), [{ prefer: 'take-b' }]);

        expect(correspondences(folded).n1).toBe('symbol_a1');
    });
});

describe('provenanceOf', () => {
    const call = (id: string, rest: Partial<Call> = {}): Call => ({
        id,
        name: 'InsertTempo',
        options: { from: 0 },
        ...rest,
    });

    const outcome = (id: string, rest: Partial<CallOutcome> = {}): CallOutcome => ({
        id,
        elements: [],
        range: null,
        ...rest,
    });

    it('folds in what the run made the call answerable for', () => {
        const [folded] = provenanceOf(
            [call('a')],
            [outcome('a', { elements: ['tempo_0'], range: { from: 0, to: 720 } })],
        );

        expect(folded).toEqual({
            id: 'a',
            name: 'InsertTempo',
            options: { from: 0 },
            elements: ['tempo_0'],
            range: { from: 0, to: 720 },
        });
    });

    it('copies the elements rather than sharing the run’s array', () => {
        const elements = ['tempo_0'];
        const [folded] = provenanceOf([call('a')], [outcome('a', { elements })]);

        expect(folded.elements).toEqual(['tempo_0']);
        expect(folded.elements).not.toBe(elements);
    });

    it('writes no `elements` where the call wrote none', () => {
        const [folded] = provenanceOf([call('a')], [outcome('a', { range: { from: 0, to: 720 } })]);

        expect(folded).not.toHaveProperty('elements');
        expect(folded.range).toEqual({ from: 0, to: 720 });
    });

    it('writes no `range` for a call that names no place at all', () => {
        const [folded] = provenanceOf([call('a')], [outcome('a', { elements: ['tempo_0'] })]);

        expect(folded).not.toHaveProperty('range');
        expect(folded.elements).toEqual(['tempo_0']);
    });

    it('keeps a date-only range, whose `to` is null', () => {
        const [folded] = provenanceOf(
            [call('a')],
            [outcome('a', { elements: ['ornament_9'], range: { from: 41040, to: null } })],
        );

        expect(folded.range).toEqual({ from: 41040, to: null });
    });

    it('passes a call no outcome mentions through untouched', () => {
        const unrun = call('a', { elements: ['tempo_0'], segment: 's1' });
        const [folded] = provenanceOf([unrun], [outcome('b')]);

        expect(folded).toBe(unrun);
    });

    it('keeps every call, in the order the chain ran them', () => {
        const folded = provenanceOf(
            [call('a'), call('b'), call('c')],
            [outcome('c', { elements: ['tempo_2'] }), outcome('a', { elements: ['tempo_0'] })],
        );

        expect(folded.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    });

    it('keeps the claim the call was made under', () => {
        const [folded] = provenanceOf(
            [call('a', { segment: 's1' })],
            [outcome('a', { elements: ['tempo_0'] })],
        );

        expect(folded.segment).toBe('s1');
    });

    // ── behaviour recorded rather than wanted ─────────────────────────

    it('keeps what the file recorded where this run reports nothing', () => {
        // The two fields are spread conditionally, so a call the chain could not run keeps the
        // answer a previous save wrote. Better than emptying it silently, and worth knowing about:
        // stale elements are indistinguishable from current ones in the file.
        const [folded] = provenanceOf(
            [call('a', { elements: ['tempo_stale'], range: { from: 99, to: 100 } })],
            [outcome('a')],
        );

        expect(folded.elements).toEqual(['tempo_stale']);
        expect(folded.range).toEqual({ from: 99, to: 100 });
    });
});

describe('buildWorkArchive', () => {
    const input = (overrides: Partial<WorkArchiveInput> = {}): WorkArchiveInput => ({
        mei: mei(),
        msm: alignment(),
        mpm: createMpm(),
        scoreMsm: '<msm><global/></msm>',
        calls: [
            { id: 'choice', name: 'MakeChoice', options: { prefer: 'take-a' } },
            {
                id: 'a',
                name: 'InsertTempo',
                options: { from: 0, bpm: 60 },
                segment: 's1',
            },
        ],
        segments: [{ id: 's1', note: 'Hinspielen auf 1' }],
        outcomes: [
            { id: 'a', segment: 's1', elements: ['tempo_0'], range: { from: 0, to: 720 } },
        ],
        metadata: { author: 'Clara Schumann', title: 'Träumerei' },
        ...overrides,
    });

    /**
     * The archive, opened again — the only honest way to check what was written.
     *
     * The blob goes into `loadAsync` whole rather than through `blob.arrayBuffer()`: jsdom's
     * `Blob` has no such method, so JSZip's own `FileReader` path is what reads it here.
     */
    const readBack = (blob: Blob): Promise<JSZip> => JSZip.loadAsync(blob);

    const entry = async (zip: JSZip, name: string): Promise<string> => {
        const file = zip.file(name);
        if (!file) throw new Error(`the archive holds no ${name}`);
        return file.async('string');
    };

    it('holds the four files the viewer reads, and no others', async () => {
        const zip = await readBack(await buildWorkArchive(input()));

        expect(Object.keys(zip.files).sort()).toEqual([
            'performance.mpm',
            'score.msm',
            'transcription.mei',
            'work.json',
        ]);
    });

    it('writes the score with the choices already folded in', async () => {
        const zip = await readBack(await buildWorkArchive(input()));

        expect(correspondences(await entry(zip, 'transcription.mei'))).toEqual({
            n1: 'symbol_a1',
            n2: 'symbol_a2',
            n3: 'symbol_a3',
        });
    });

    it('writes the MPM and the converted score through unchanged', async () => {
        const mpm = createMpm();
        const zip = await readBack(await buildWorkArchive(input({ mpm })));

        expect(await entry(zip, 'performance.mpm')).toBe(exportMPM(mpm));
        expect(await entry(zip, 'score.msm')).toBe('<msm><global/></msm>');
    });

    it('writes a work file that reads straight back', async () => {
        const zip = await readBack(await buildWorkArchive(input()));
        const work = parseWorkFile(await entry(zip, 'work.json'));

        expect(work).toEqual({
            name: 'Träumerei',
            mei: 'transcription.mei',
            mpm: 'performance.mpm',
            provenance: [
                { id: 'choice', name: 'MakeChoice', options: { prefer: 'take-a' } },
                {
                    id: 'a',
                    name: 'InsertTempo',
                    options: { from: 0, bpm: 60 },
                    segment: 's1',
                    elements: ['tempo_0'],
                    range: { from: 0, to: 720 },
                },
            ],
            segments: [{ id: 's1', note: 'Hinspielen auf 1' }],
        });
    });

    it('carries the `Map` and `Set` options through the round trip', async () => {
        // The envelope handling is the reason `serializeWorkFile` exists. Written with plain
        // `JSON.stringify`, both of these arrive back as `{}` — and `{}` has no `.get`, so the
        // failure surfaces the next time a phantom velocity is read, somewhere else entirely.
        const zip = await readBack(
            await buildWorkArchive(
                input({
                    calls: [
                        {
                            id: 'a',
                            name: 'InsertArticulation',
                            options: { aspects: new Set(['relativeDuration']) },
                        },
                        {
                            id: 'b',
                            name: 'InsertDynamicsInstructions',
                            options: { phantoms: new Map([[720, 64]]) },
                        },
                    ],
                    outcomes: [],
                }),
            ),
        );
        const work = parseWorkFile(await entry(zip, 'work.json'));

        expect(work.provenance[0].options['aspects']).toEqual(new Set(['relativeDuration']));
        expect(work.provenance[1].options['phantoms']).toEqual(new Map([[720, 64]]));
    });

    it('names the file after the reconstruction, or `Reconstruction` where it has no name', async () => {
        const named = await readBack(await buildWorkArchive(input()));
        expect(parseWorkFile(await entry(named, 'work.json')).name).toBe('Träumerei');

        const unnamed = await readBack(
            await buildWorkArchive(input({ metadata: { author: '', title: '' } })),
        );
        expect(parseWorkFile(await entry(unnamed, 'work.json')).name).toBe('Reconstruction');
    });

    it('carries the desk bag when there is one, and writes no key when there is not', async () => {
        const withBag = await readBack(
            await buildWorkArchive(input({ secondary: { tempo: { clusters: [1, 2] } } })),
        );
        expect(parseWorkFile(await entry(withBag, 'work.json')).secondary).toEqual({
            tempo: { clusters: [1, 2] },
        });

        const withoutBag = await readBack(await buildWorkArchive(input()));
        expect(await entry(withoutBag, 'work.json')).not.toContain('secondary');
    });
});
