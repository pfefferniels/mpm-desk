/**
 * Which symbol of the roll a reading performs, as the transcription records it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convertMeiToMsm } from 'espressivo';
import { asMSM } from '../fitting/asMSM';
import { publishedPath } from '../test/published';
import { symbolOf } from './symbols';

const when = (corresp?: string) => {
    const doc = new DOMParser().parseFromString(
        `<when xmlns="http://www.music-encoding.org/ns/mei" absolute="0ms" data="#n1"${corresp === undefined ? '' : ` corresp="${corresp}"`}/>`,
        'application/xml',
    );
    return doc.documentElement;
};

describe('the symbol a <when> performs', () => {
    it('is the IRI its @corresp gives', () => {
        expect(symbolOf(when('https://welte225.org/symbol_1'))).toBe('https://welte225.org/symbol_1');
    });

    it('is the first, where a pedal names the symbols of its steps', () => {
        expect(symbolOf(when('https://welte225.org/symbol_1 https://welte225.org/symbol_2'))).toBe(
            'https://welte225.org/symbol_1',
        );
    });

    /**
     * Read against the transcription's address, `symbol_1` would be
     * `https://welte225.org/mpm/symbol_1`, which is where the calls are.
     */
    it('is none where the take names it by its bare id, by a note asSpans minted, or not at all', () => {
        expect(symbolOf(when('symbol_1'))).toBeUndefined();
        expect(symbolOf(when('0-1200-note-0-60'))).toBeUndefined();
        expect(symbolOf(when())).toBeUndefined();
    });
});

/**
 * Against the transcription as published, where every note a take played was imported from Roll
 * Desk: each row names its symbol, those of the unison notes `asMSM` merges among them, whose
 * `<when>` names the note it dropped rather than the one it kept.
 */
describe('the symbols of the shipped transcription', () => {
    const mei = readFileSync(publishedPath('mei'), 'utf-8');
    const rows = asMSM(mei, convertMeiToMsm(mei)[0]!.msm).allNotes;

    it('are named by every row of both takes', () => {
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.filter((row) => !row.symbol?.startsWith('https://welte225.org/symbol_'))).toEqual([]);
    });

    it('differ between the takes wherever the edition punched a note anew', () => {
        const byNote = Map.groupBy(rows, (row) => row['xml:id']);
        const differing = [...byNote.values()].filter((readings) => new Set(readings.map((row) => row.symbol)).size > 1);
        expect(differing.length).toBeGreaterThan(0);
    });
});
