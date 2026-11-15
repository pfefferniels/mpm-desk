import { describe, expect, it } from 'vitest';
import { sameDocument } from './sameDocument';

const score = (layer: string, staff = '1') =>
    `<mei xmlns="http://www.music-encoding.org/ns/mei"><measure n="1"><staff n="${staff}"><layer n="1">${layer}</layer></staff></measure></mei>`;

describe('two MEI texts being one document', () => {
    it('does not mind the order of attributes, nor the white space between elements', () => {
        const one = score('<note xml:id="a" pname="c" oct="4" dur="4"/>');
        const other = score('\n  <note dur="4" oct="4" pname="c" xml:id="a"/>\n');
        expect(sameDocument(one, other)).toBe(true);
    });

    it('minds a note value', () => {
        const one = score('<note xml:id="a" pname="c" oct="4" dur="4"/>');
        const other = score('<note xml:id="a" pname="c" oct="4" dur="8"/>');
        expect(sameDocument(one, other)).toBe(false);
    });

    it('minds which staff a note is on, with nothing else about it changed', () => {
        const note = '<note xml:id="a" pname="c" oct="4" dur="4"/>';
        expect(sameDocument(score(note, '1'), score(note, '2'))).toBe(false);
    });

    it('minds where in its layer a note stands', () => {
        const a = '<note xml:id="a" pname="c" oct="4" dur="4"/>';
        const rest = '<rest xml:id="r" dur="4"/>';
        expect(sameDocument(score(a + rest), score(rest + a))).toBe(false);
    });

    it('minds the words of an element that holds words', () => {
        expect(sameDocument(score('<dir>dolce</dir>'), score('<dir>marcato</dir>'))).toBe(false);
    });
});
