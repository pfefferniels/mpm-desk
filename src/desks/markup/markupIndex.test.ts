/**
 * What the desk has to do to a document before anyone can read it, over the reconstruction the
 * app ships.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { indexMarkup } from './markupIndex';

const performanceMpm = readFileSync('src/test/fixtures/performance.mpm', 'utf-8');
const scoreMsm = readFileSync('src/test/fixtures/score.msm', 'utf-8');

/**
 * A saved performance, read from `public/` rather than from `src/test/fixtures/` on purpose.
 *
 * The fixture beside it is indented, and espressivo's serializer re-emits the whitespace of the
 * document it parsed — so a round trip through the fixture would prove nothing about what the app
 * writes. This is one of `buildWorkArchive`'s four files as it actually landed on disk, and it is
 * the shape every save takes.
 */
const savedMpm = readFileSync('public/performance.mpm', 'utf-8');

describe('indexMarkup', () => {
    /**
     * The regression the desk exists for, asked of the app's own writer rather than of a file
     * that happens to be indented. espressivo's serializer is pinned to bytes a Java original
     * produced, so it adds no whitespace at all: what `exportMPM` hands back is the XML
     * declaration and then the entire document on one line. Shown raw, the desk was a horizontal
     * ribbon a few hundred screen-widths long.
     */
    it('turns the two-line document the app writes into something with lines in it', () => {
        // The declaration, and then the whole document. Trailing newline aside, that is all
        // of it: 111,158 characters on the second line of the reconstruction this app ships.
        const written = savedMpm.trimEnd().split('\n');
        expect(written.length).toBe(2);
        expect(Math.max(...written.map((line) => line.length))).toBeGreaterThan(50000);

        const { lines } = indexMarkup(savedMpm);

        expect(lines.length).toBeGreaterThan(1000);
        expect(Math.max(...lines.map((line) => line.text.length))).toBeLessThan(400);
    });

    it('does the same for the score, which has no newline at all', () => {
        expect(scoreMsm).not.toContain('\n');
        expect(indexMarkup(scoreMsm).lines.length).toBeGreaterThan(400);
    });

    /** Re-indenting an indented document must not walk it further right on every visit. */
    it('leaves an already-indented document where it is', () => {
        const once = indexMarkup(performanceMpm).lines.map((line) => line.text);
        expect(indexMarkup(once.join('\n')).lines.map((line) => line.text)).toEqual(once);
    });

    /** `lineOf` is the whole of the bridge to `CallSelection`, so it has to be complete. */
    it('indexes every xml:id in the document, on the line that carries it', () => {
        const { lines, lineOf } = indexMarkup(performanceMpm);
        const ids = [...performanceMpm.matchAll(/\bxml:id="([^"]*)"/g)].map((match) => match[1]);

        expect(ids.length).toBeGreaterThan(500);
        expect(lineOf.size).toBe(new Set(ids).size);

        for (const id of ids) {
            const line = lineOf.get(id);
            expect(line).toBeDefined();
            expect(lines[line!].text).toContain(`xml:id="${id}"`);
            expect(lines[line!].id).toBe(id);
        }
    });

    it('names the element each identified line opens, for its lane colour', () => {
        const { lines } = indexMarkup(performanceMpm);
        const types = new Set(lines.map((line) => line.type).filter(Boolean));

        expect(types).toContain('tempo');
        expect(types).toContain('rubato');
        expect(types).toContain('movement');
        // A line with no id claims no type: the two are what make a line something the editor
        // can talk about, and they are present together or not at all.
        expect(lines.every((line) => (line.id === undefined) === (line.type === undefined))).toBe(
            true,
        );
    });

    it('has nothing to say about an empty document', () => {
        expect(indexMarkup('')).toEqual({ lines: [], lineOf: new Map() });
    });
});
