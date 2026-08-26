/**
 * Opening a work file written before the link turned round.
 *
 * The transposition has to be *lossless* — that is the whole reason the link went onto the call
 * rather than onto a list of element ids on the segment. So what is checked is that nothing is
 * decided: every call keeps the claim it was under, every claim keeps its prose, and the option
 * envelopes that only survive a round trip through the reader survive this one too.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { migrateIfNeeded, liftSegmentLinks, foldCommentary } from './loadWork';
import { parseWorkFile, type WorkFile } from './Work';

/** A work file in the shape that listed calls on the segment. */
const legacy = {
    name: 'Träumerei',
    mei: 'transcription.mei',
    mpm: 'performance.mpm',
    provenance: [
        { id: 'a', name: 'InsertTempo', options: { from: 0 }, elements: ['tempo_0'] },
        { id: 'b', name: 'Modify', options: { from: 1440 } },
        { id: 'c', name: 'InsertRubato', options: { date: 720 }, elements: ['rubato_720'] },
    ],
    segments: [
        { id: 's1', note: 'Hinspielen auf 1', calls: ['a', 'b'] },
        { id: 's2', commentary: 'Die Dynamik unterschreitet den Rahmen.', calls: [] },
    ],
};

describe('turning the segment→call link round', () => {
    it('moves each segment’s calls onto the calls, and takes the list away', () => {
        const lifted = liftSegmentLinks(legacy as unknown as WorkFile);
        expect(lifted).not.toBeNull();

        expect(lifted!.provenance.map((call) => [call.id, call.segment])).toEqual([
            ['a', 's1'],
            // A call that writes no instruction keeps its claim like any other. It contributes
            // nothing to the narrative because it has nothing to contribute, not because this
            // drops it.
            ['b', 's1'],
            ['c', undefined],
        ]);
        for (const segment of lifted!.segments) expect(segment).not.toHaveProperty('calls');
    });

    it('keeps every claim, including one nothing is made under', () => {
        const lifted = liftSegmentLinks(legacy as unknown as WorkFile);
        expect(lifted!.segments).toEqual([
            { id: 's1', note: 'Hinspielen auf 1' },
            { id: 's2', commentary: 'Die Dynamik unterschreitet den Rahmen.' },
        ]);
    });

    it('says there is nothing to do for a file that already points the right way', () => {
        // `null` rather than a copy, so the caller keeps the original text — and with it the
        // option envelopes, which only survive a round trip through the reader.
        const already = liftSegmentLinks(legacy as unknown as WorkFile);
        expect(liftSegmentLinks(already!)).toBeNull();
    });

    it('lifts on open, and revives the option envelopes while it does', () => {
        const withEnvelope = {
            ...legacy,
            provenance: [
                {
                    id: 'a',
                    name: 'InsertArticulation',
                    options: { aspects: { dataType: 'Set', value: ['relativeDuration'] } },
                    elements: ['articulation_0'],
                },
            ],
            segments: [{ id: 's1', note: 'Hinspielen auf 1', calls: ['a'] }],
        };

        const work = migrateIfNeeded(JSON.stringify(withEnvelope));
        expect(work.provenance[0].segment).toBe('s1');
        expect(work.provenance[0].options['aspects']).toEqual(new Set(['relativeDuration']));
    });
});

describe('the shipped reconstruction', () => {
    const work = parseWorkFile(readFileSync('public/work.json', 'utf-8'));

    it('points from the call, with nothing left on the segment', () => {
        expect(work.provenance.filter((call) => call.segment === undefined)).toEqual([]);
        expect(work.segments.some((segment) => 'calls' in segment)).toBe(false);
        expect(liftSegmentLinks(work)).toBeNull();
    });

    it('names only claims the file holds', () => {
        const held = new Set(work.segments.map((segment) => segment.id));
        expect(work.provenance.filter((call) => !held.has(call.segment ?? ''))).toEqual([]);
    });
});

describe('folding the second prose field into the note', () => {
    const withBoth = (segments: unknown[]) =>
        ({ ...legacy, segments } as unknown as WorkFile);

    it('joins a word and its continuation with an em-dash', () => {
        const folded = foldCommentary(
            withBoth([
                {
                    id: 's1',
                    note: 'Großangelegtes Decrescendo',
                    commentary: 'der dynamische Verlauf folgt dem Tonhöhenverlauf',
                },
            ]),
        );

        expect(folded!.segments).toEqual([
            {
                id: 's1',
                note: 'Großangelegtes Decrescendo — der dynamische Verlauf folgt dem Tonhöhenverlauf',
            },
        ]);
    });

    it('keeps prose that has no word to hang off rather than losing it', () => {
        const folded = foldCommentary(
            withBoth([{ id: 's1', commentary: 'durch gedachtes Portamento' }]),
        );
        expect(folded!.segments).toEqual([{ id: 's1', note: 'durch gedachtes Portamento' }]);
    });

    it('says there is nothing to do where no segment carries one', () => {
        expect(foldCommentary(withBoth([{ id: 's1', note: 'Hinspielen auf 1' }]))).toBeNull();
    });

    it('runs on open, after the link has been turned round', () => {
        const work = migrateIfNeeded(
            JSON.stringify({
                ...legacy,
                segments: [
                    { id: 's1', note: 'Hinspielen auf 1', commentary: 'zum a\'', calls: ['a'] },
                ],
            }),
        );

        expect(work.provenance[0].segment).toBe('s1');
        expect(work.segments[0]).toEqual({ id: 's1', note: "Hinspielen auf 1 — zum a'" });
    });
});
