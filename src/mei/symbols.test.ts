/**
 * Which symbol of the roll a reading of a note performs, as the transcription records it.
 */
import { describe, expect, it } from 'vitest';
import { symbolsOf } from './symbols';

const mei = (performance: string) =>
    `<mei xmlns="http://www.music-encoding.org/ns/mei"><music><performance>${performance}</performance></music></mei>`;

describe('the symbol each reading performs', () => {
    it('is the IRI of its <when>, by note and take', () => {
        const symbols = symbolsOf(
            mei(`
                <recording source="#take-a">
                    <when absolute="0ms" data="#n1" corresp="https://welte225.org/symbol_1" type="match"/>
                </recording>
                <recording source="#take-b">
                    <when absolute="0ms" data="#n1" corresp="https://welte225.org/symbol_2" type="match"/>
                </recording>`),
        );

        expect([...symbols]).toEqual([
            ['n1/#take-a', 'https://welte225.org/symbol_1'],
            ['n1/#take-b', 'https://welte225.org/symbol_2'],
        ]);
    });

    it('is the symbol that sounded, where the take played another note', () => {
        const symbols = symbolsOf(
            mei(`
                <recording source="#take-a">
                    <when absolute="0ms" data="#n1" corresp="https://welte225.org/symbol_1" type="substitution"/>
                </recording>`),
        );

        expect(symbols.get('n1/#take-a')).toBe('https://welte225.org/symbol_1');
    });

    /**
     * Read against the transcription's address, `symbol_1` would be
     * `https://welte225.org/mpm/symbol_1`, which is where the calls are.
     */
    it('is none where the take names the symbol by its bare id, or by nothing of the roll', () => {
        const symbols = symbolsOf(
            mei(`
                <recording source="#take-a">
                    <when absolute="0ms" data="#n1" corresp="symbol_1" type="match"/>
                    <when absolute="0ms" data="#n2" corresp="0-1200-note-0-60" type="match"/>
                    <when absolute="0ms" data="#n3" type="match"/>
                </recording>`),
        );

        expect(symbols.size).toBe(0);
    });

    it('leaves out a pedal, which times no written note', () => {
        const symbols = symbolsOf(
            mei(`
                <recording source="#take-a">
                    <when absolute="0ms" corresp="https://welte225.org/symbol_1 https://welte225.org/symbol_2" type="sustain"/>
                </recording>`),
        );

        expect(symbols.size).toBe(0);
    });
});
