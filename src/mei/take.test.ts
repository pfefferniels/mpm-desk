/**
 * What a take is called, in the header and in its recording.
 *
 * A take was named by the bare id of the roll's version it was read from, both as the `xml:id` of
 * its `<manifestation>` and as its recording's `@source`. A UUID may begin with a digit, which an
 * `xml:id` may not, and the published transcription of roll 225 failed its schema on
 * `0e5f443d-…`. Nor was the bare id a reference, which the as-played-by format asks `@source` to
 * be.
 */
import { describe, expect, it } from 'vitest';
import { insertMetadata } from './insertMetadata';
import { manifestationIdOf, takeSource } from './take';
import { insertRecording } from './when';

/** What XML allows an `xml:id` to be, the letters and digits of any script included. */
const NCNAME = /^[\p{L}_][\p{L}\p{M}\p{N}._-]*$/u;

const MEI_NS = 'http://www.music-encoding.org/ns/mei';

const empty = () =>
    new DOMParser().parseFromString(
        `<mei xmlns="${MEI_NS}" meiversion="5.1"><meiHead><fileDesc><titleStmt><title/></titleStmt><pubStmt/></fileDesc></meiHead><music><body/></music></mei>`,
        'application/xml',
    );

describe('the name of a take', () => {
    it('refers to an id a UUID beginning with a digit can stand in', () => {
        const source = takeSource('0e5f443d-0dd9-4810-9dbe-7f5007df490f');
        expect(source).toBe('#take-0e5f443d-0dd9-4810-9dbe-7f5007df490f');
        expect(manifestationIdOf(source)).toMatch(NCNAME);
    });

    it('is named take- whatever the id begins with', () => {
        expect(takeSource('c9050e75-97a8-4862-9533-0f4b1439802b')).toBe(
            '#take-c9050e75-97a8-4862-9533-0f4b1439802b',
        );
    });

    it('holds a file stem with what an id cannot hold made hyphens', () => {
        const source = takeSource('Träumerei (2) take 1');
        expect(source).toBe('#take-Träumerei--2--take-1');
        expect(manifestationIdOf(source)).toMatch(NCNAME);
    });

    it('keeps an id written before takes were named so', () => {
        expect(manifestationIdOf('c9050e75-97a8-4862-9533-0f4b1439802b')).toBe(
            'c9050e75-97a8-4862-9533-0f4b1439802b',
        );
    });
});

describe('a take written into a document', () => {
    const source = takeSource('0e5f443d-0dd9-4810-9dbe-7f5007df490f');
    const doc = empty();
    insertMetadata({ source, applicationName: 'linked-rolls', parameters: [] }, doc);
    const recording = insertRecording(doc, source);

    it('has a recording whose @source points at its manifestation', () => {
        expect(recording?.getAttribute('source')).toBe(source);
        const manifestations = [...doc.getElementsByTagNameNS(MEI_NS, 'manifestation')];
        expect(manifestations.map((element) => element.getAttribute('xml:id'))).toEqual([
            'take-0e5f443d-0dd9-4810-9dbe-7f5007df490f',
        ]);
    });

    it('is described once, however often it is aligned again', () => {
        insertMetadata({ source, applicationName: 'linked-rolls', parameters: [] }, doc);
        expect(doc.getElementsByTagNameNS(MEI_NS, 'manifestation')).toHaveLength(1);
    });
});
