import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { prepareBandMei, readScoreNotes, SYMBOLIC_RECORDING } from './bandMei';
import { publishedPath } from '../../test/published';

const MEI = `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei"><music><body><mdiv><score><section>
  <measure xml:id="m1" n="1">
    <staff n="1"><layer n="1">
      <note xml:id="a" pname="c" oct="4" dur="4" artic="stacc"/>
      <note xml:id="b" pname="d" oct="4" dur="4"><artic xml:id="ar" artic="acc"/></note>
    </layer></staff>
    <slur startid="#a" endid="#b"/><hairpin form="cres" startid="#a" endid="#b"/>
    <dynam startid="#a">p</dynam><tie startid="#a" endid="#b"/><fermata startid="#b"/>
  </measure>
</section></score></mdiv></body></music></mei>`;

describe('the score the band engraves', () => {
    const { mei, removed } = prepareBandMei(MEI, [
        { id: 'a', date: 0, duration: 720, pitch: 60 },
        { id: 'b', date: 720, duration: 720, pitch: 62 },
    ]);
    const doc = new DOMParser().parseFromString(mei, 'application/xml');

    it('takes out every performance mark and keeps what says which notes there are', () => {
        expect(removed).toEqual({ slur: 1, hairpin: 1, dynam: 1, fermata: 1, artic: 1 });
        expect(doc.querySelectorAll('slur, hairpin, dynam, fermata, artic')).toHaveLength(0);
        expect(doc.querySelector('note')?.hasAttribute('artic')).toBe(false);
        expect(doc.querySelectorAll('tie, note')).toHaveLength(3);
    });

    it('places every note at its notated date, one millisecond per tick', () => {
        const recording = doc.querySelector(`recording[source="${SYMBOLIC_RECORDING}"]`);
        const whens = [...(recording?.querySelectorAll('when') ?? [])];
        expect(whens.map((when) => [when.getAttribute('data'), when.getAttribute('absolute')])).toEqual([
            ['#a', '0ms'],
            ['#b', '720ms'],
        ]);
        expect(recording?.parentElement?.localName).toBe('performance');
    });

    it('prepares the published transcription without a slur or hairpin left', () => {
        const published = readFileSync(publishedPath('mei'), 'utf-8');
        const notes = readScoreNotes(readFileSync(publishedPath('score'), 'utf-8'));
        const band = prepareBandMei(published, notes);
        expect(band.removed.slur).toBeGreaterThan(50);
        expect(band.mei).not.toMatch(/<(slur|hairpin|dynam|fermata) /);
        expect(band.mei.match(/<when /g)?.length).toBeGreaterThan(notes.length);
    });
});
