import { describe, expect, it } from 'vitest';
import { readAnswer } from './answer';

/**
 * The expert's answer read out of what it wrote: the one object where it stands alone, and where
 * it is led up to, fenced, or followed by more.
 */

const tempo = { name: 'FitTempo', options: { from: 720, to: 3600 } };

describe('readAnswer', () => {
    it('reads the object where it stands alone', () => {
        expect(readAnswer(JSON.stringify({ steps: [tempo], question: null }))).toEqual({
            steps: [tempo],
            question: null,
        });
    });

    it('reads the last object of steps where words, and objects of other things, lead up to it', () => {
        const text =
            'The trial left {"pulse_ms": 12}. A first idea was {"steps": []}, but this is it:\n' +
            `{"steps": [${JSON.stringify(tempo)}], "question": null}`;
        expect(readAnswer(text)?.steps).toEqual([tempo]);
    });

    it('reads it out of a fence', () => {
        const text = `Here it is.\n\`\`\`json\n{ "steps": [${JSON.stringify(tempo)}],\n "question": null }\n\`\`\`\nThat is all.`;
        expect(readAnswer(text)?.steps).toEqual([tempo]);
    });

    it('takes a question for the whole answer: its steps wait', () => {
        expect(readAnswer('{"steps": [{"name": "FitTempo"}], "question": " Which chord? "}')).toEqual(
            { steps: [], question: 'Which chord?' },
        );
        expect(readAnswer('{"question": "Wo genau?"}')).toEqual({
            steps: [],
            question: 'Wo genau?',
        });
    });

    it('drops what is no step, and gives a step without options none', () => {
        const text = '{"steps": [{"name": "InsertPedal"}, {"options": {}}, "FitTempo", null, {"name": "Modify", "options": 3}]}';
        expect(readAnswer(text)).toEqual({
            steps: [
                { name: 'InsertPedal', options: {} },
                { name: 'Modify', options: {} },
            ],
            question: null,
        });
    });

    it('reads nothing where there is no such object', () => {
        expect(readAnswer('')).toBeUndefined();
        expect(readAnswer('I would roll the chords.')).toBeUndefined();
        expect(readAnswer('{"steps": [')).toBeUndefined();
        expect(readAnswer('{"calls": [{"name": "FitTempo"}]}')).toBeUndefined();
        expect(readAnswer('[1, 2]')).toBeUndefined();
    });
});
