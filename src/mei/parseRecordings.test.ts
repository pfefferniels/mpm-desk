/**
 * What a recording read back out of a score sounds as.
 *
 * A `<when>` points at a note and says when. The pitch is the score's, and the score says it as
 * scores do: under a key signature, with accidentals that hold for their bar, under an ottava.
 * Read off the note alone, a recording in three flats came back in none — every e, a and b a
 * semitone high — which is what "Hear it" played once the transcription had been written.
 */
import { describe, expect, it } from 'vitest';
import { parseRecordings } from './parseRecordings';

const note = (id: string, pname: string, oct: number, rest = '') =>
    `<note xml:id="${id}" pname="${pname}" oct="${oct}" dur="4" ${rest}/>`;

const when = (id: string, ms: number) =>
    `<when absolute="${ms}ms" data="#${id}"><extData type="duration">400</extData><extData type="velocity">60</extData></when>`;

const ids = ['e1', 'a1', 'en', 'e2', 'e3', 'b1', 'g1', 'f1', 'hi', 'lo'];

const mei = `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1">
  <music>
    <performance><recording source="take">${ids.map((id, index) => when(id, index * 500)).join('')}</recording></performance>
    <body><mdiv><score>
    <scoreDef meter.count="4" meter.unit="4"><staffGrp>
      <staffDef n="1" lines="5" clef.shape="G" clef.line="2"><keySig sig="3f"/></staffDef>
    </staffGrp></scoreDef>
    <section>
      <measure xml:id="m1" n="1">
        <staff n="1"><layer n="1">${note('e1', 'e', 4)}${note('a1', 'a', 4)}${note('en', 'e', 4, 'accid="n"')}${note('e2', 'e', 4)}</layer></staff>
      </measure>
      <measure xml:id="m2" n="2">
        <staff n="1"><layer n="1">${note('e3', 'e', 4)}${note('b1', 'b', 3)}${note('g1', 'g', 4)}${note('f1', 'f', 4, 'accid="s"')}</layer></staff>
      </measure>
      <measure xml:id="m3" n="3">
        <staff n="1"><layer n="1">${note('hi', 'e', 5, 'oct.ges="6"')}${note('lo', 'c', 4)}<rest dur="2"/></layer></staff>
        <octave startid="#hi" endid="#hi" dis="8" dis.place="above"/>
      </measure>
    </section>
  </score></mdiv></body></music>
</mei>`;

const pitches = () => {
    const { recordings, pitchMap } = parseRecordings(mei);
    const spans = recordings[0].noteSpans;
    return { of: (id: string) => spans.get(id)?.pitch, written: pitchMap };
};

describe('the pitch of a played note, read back out of the score', () => {
    it('is flat where the key signature says so and the note says nothing', () => {
        const { of } = pitches();
        expect(of('e1')).toBe(63);
        expect(of('a1')).toBe(68);
        expect(of('b1')).toBe(58);
    });

    it('is the note as written where the signature does not touch it', () => {
        const { of } = pitches();
        expect(of('g1')).toBe(67);
        expect(of('lo')).toBe(60);
    });

    it('follows an accidental to the end of its bar, and no further', () => {
        const { of } = pitches();
        expect(of('en')).toBe(64);
        // The same e again in that bar is still natural; in the next bar it is flat again
        expect(of('e2')).toBe(64);
        expect(of('e3')).toBe(63);
        expect(of('f1')).toBe(66);
    });

    it('is where the note sounds, under an ottava', () => {
        const { of } = pitches();
        // e flat, written in the fifth octave and marked as sounding in the sixth
        expect(of('hi')).toBe(87);
    });

    it('says the same of every note in the map of written pitches', () => {
        const { of, written } = pitches();
        for (const id of ids) expect(written.get(id), id).toBe(of(id));
    });
});
