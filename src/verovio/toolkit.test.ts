import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import type { VerovioToolkit } from 'verovio/esm';
import { defaultOptions, loadVerovio, renderScore, supportsOption } from './toolkit';

/**
 * What the vendored build is, asked of the build itself.
 *
 * Everything else about the voices desk is ordinary React over a string. This is the one file that
 * can tell whether `vendor/verovio` is the fork at all, and whether the two attributes the desk
 * hangs everything on — `data-id` and the voice each note was drawn in — are really emitted. It
 * loads a 7 MB module and renders the real transcription, so it is slow, and it is the only slow
 * test here.
 */
const mei = readFileSync('public/transcription.mei', 'utf-8');

/** The `@source` of the recording `public/work.json`'s `MakeChoice` prefers. */
const RECORDING = 'c9050e75-97a8-4862-9533-0f4b1439802b';

let toolkit: VerovioToolkit;

beforeAll(async () => {
    toolkit = await loadVerovio();
}, 60_000);

describe('the vendored toolkit', () => {
    test('is the fork, which knows the performance options', () => {
        const groups = (
            toolkit.getAvailableOptions() as unknown as {
                groups: Record<string, { options: Record<string, unknown> }>;
            }
        ).groups;

        expect(groups['8-performance'], 'no performance group — is vendor/verovio the fork?')
            .toBeDefined();
        expect(Object.keys(groups['8-performance']!.options)).toContain('performanceAlignment');
    });

    test('was built at or after a1746b1a9, so the clock can divide the systems', () => {
        // `performanceBreaks` is the option that tells a fresh build from the 2026-08-27 one.
        // If this fails the vendored artefact is stale — run `npm run verovio:build`.
        expect(supportsOption(toolkit, 'performanceBreaks')).toBe(true);
    });

    test('does not know an option nobody added', () => {
        expect(supportsOption(toolkit, 'performanceNonsense')).toBe(false);
    });
});

describe('rendering the transcription', () => {
    let svg: string;

    beforeAll(() => {
        svg = renderScore(toolkit, mei).join('');
    }, 60_000);

    test('puts the raw MEI xml:id on data-id, and not on id', () => {
        // The whole colouring scheme rests on this: MSM note ids are MEI note ids, so
        // `[data-id="…"]` is how a part reaches a notehead. With `svgHtml5` verovio writes no
        // `id` at all, and the value is the `xml:id` verbatim rather than a `note-…` of its own.
        expect(svg).toContain('data-id="npk4lw6"');
        // `id=` as an attribute of its own, which is what a non-HTML5 render would write. The
        // leading character keeps this from matching the `-id=` of `data-id`.
        expect(svg).not.toMatch(/[^-]id="npk4lw6"/);
    });

    test('marks every note with the voice that drew it', () => {
        // `svgAdditionalAttribute` puts `@n` on the enclosing groups, which is how the desk reads
        // its voice table off the rendering it is already showing.
        expect(svg).toMatch(/<g[^>]*data-class="staff"[^>]*data-n="1"/);
        expect(svg).toMatch(/<g[^>]*data-class="layer"[^>]*data-n="2"/);
        expect(svg).toMatch(/<g[^>]*data-class="measure"[^>]*data-n="1"/);
    });

    test('draws every notehead the MEI has', () => {
        // 532, against the MSM's 476: 43 are tie endids folded into their start note and 13 are
        // grace notes the conversion emits nothing for. The desk has to say "no part" for those
        // rather than mis-colour them, so the gap is pinned here rather than discovered there.
        const notes = [...svg.matchAll(/<g[^>]*data-class="note"/g)];
        expect(notes).toHaveLength(532);
    });

    test('leaves the note group unpainted, so the part hue has it to itself', () => {
        // With `performanceVelocityOpacity` and `performanceUnmatched: 'mark'` on, the fork writes
        // `opacity` and `fill="darkred"` onto the note's own `<g>` — the element the part colour
        // goes on. Both are off in `defaultOptions`; this is what says so.
        const openings = [...svg.matchAll(/<g[^>]*data-class="note"[^>]*>/g)].map((m) => m[0]);
        expect(openings.length).toBeGreaterThan(0);
        expect(openings.filter((tag) => /\bopacity=/.test(tag))).toEqual([]);
        expect(openings.filter((tag) => /\bfill=/.test(tag))).toEqual([]);
    });
});

describe('the performed layout', () => {
    test('lays the score out along the recording it is pointed at', () => {
        const performed = renderScore(toolkit, mei, {
            performanceAlignment: true,
            performanceRecording: RECORDING,
        }).join('');

        // The option takes a `@source` directly, so it can follow whichever reading `MakeChoice`
        // preferred without a lookup table in between.
        expect(performed).toMatch(/<g[^>]*data-class="note"[^>]*data-perf-onset="\d+"/);
    });

    test('the notated layout carries no performed time at all', () => {
        expect(renderScore(toolkit, mei).join('')).not.toContain('data-perf-onset');
    });

    test('resets options between renders, so one render cannot leak into the next', () => {
        // `setOptions` is additive; `renderScore` calls `resetOptions` first. Without it the
        // performed render above would still be in force here.
        expect(defaultOptions.performanceAlignment).toBe(false);
        expect(renderScore(toolkit, mei).join('')).not.toContain('data-perf-onset');
    });
});
