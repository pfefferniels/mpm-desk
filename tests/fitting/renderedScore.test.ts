/**
 * The published reconstruction as the app renders it: the chain's MPM against the alignment's
 * own score (`scoreMsm` in `App.tsx`), never against the raw conversion of the MEI.
 *
 * Every instruction that names a note has to find it there, and espressivo will not say so
 * loudly when one does not. An ornament whose `@noteid` the score lacks falls back to its
 * `@note.order`, and one with a millisecond frame is then skipped: five grace figures of WM 225,
 * grace notes and held principal alike, were silent in the app, while every test that rendered
 * against the conversion, which holds every note of the MEI, heard them.
 */
import { describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { convertMeiToMsm, performMsmToData } from 'espressivo';
import { asMSM } from '../../src/fitting/asMSM';
import { runFit } from '../../src/fitting/fit';
import { Alignment } from '../../src/fitting/alignment';
import { parseWorkFile, sourcesOf } from '../../src/model/Work';
import { partNamesOf } from '../../src/model/workReducer';
import { publishedPath } from '../../src/test/published';
import { at } from '../support/at';

const XML_NS = 'http://www.w3.org/XML/1998/namespace';

describe('the score the app renders the published MPM against', () => {
  const mei = readFileSync(publishedPath('mei'), 'utf-8');
  const work = parseWorkFile(readFileSync(publishedPath('work'), 'utf-8'));
  const movement = at(convertMeiToMsm(mei), 0, 'movement');
  const pristine = asMSM(mei, movement.msm, movement.graces);

  // As the editor and the viewer come by it: the chain run over a copy, the alignment rebuilt
  // from the ground it hands back (`useEditorFit`), the score serialized from that.
  const result = runFit(work, pristine.clone());
  const alignment = new Alignment(result.ground.notes, result.ground.timeSignatures);
  alignment.pedals = result.ground.pedals;
  alignment.graces = result.ground.graces;
  alignment.tiedPrincipals = result.ground.tiedPrincipals;
  const score = alignment.serializeScore(partNamesOf(work)) ?? '';

  const scoreIds = new Set(
    [...new DOMParser().parseFromString(score, 'application/xml').querySelectorAll('note')].map(
      (note) => note.getAttributeNS(XML_NS, 'id') ?? '',
    ),
  );
  const mpm = new DOMParser().parseFromString(result.mpm, 'application/xml');

  test('holds every note an instruction names', () => {
    const named = [...mpm.querySelectorAll('[noteid]')].map((element) =>
      (element.getAttribute('noteid') ?? '').replace(/^#/, ''),
    );
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((id) => !scoreIds.has(id))).toEqual([]);
  });

  test('holds every score note an ornament orders', () => {
    const ordered = [...mpm.querySelectorAll('ornament')].flatMap((ornament) => {
      // A pool note is the ornament's own, and generated; everything else in the order is the
      // score's.
      const pool = new Set(
        [...ornament.querySelectorAll('note')].map((note) => note.getAttributeNS(XML_NS, 'id')),
      );
      return [...(ornament.getAttribute('note.order') ?? '').matchAll(/#([^\s\]|]+)/g)]
        .map((match) => match[1] ?? '')
        .filter((id) => !pool.has(id));
    });
    expect(ordered.length).toBeGreaterThan(0);
    expect(ordered.filter((id) => !scoreIds.has(id))).toEqual([]);
  });

  const render = () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const played = performMsmToData({ msm: score, mpm: result.mpm }).parts.flatMap(
        (part) => part.notes,
      );
      return { played, said: errors.mock.calls.map((call) => call.map(String).join(' ')) };
    } finally {
      errors.mockRestore();
      logs.mockRestore();
    }
  };

  test('sounds every grace figure, with nothing to fall back from', () => {
    const { played, said } = render();
    expect(said.filter((line) => /principal note/.test(line))).toEqual([]);

    const figures = [...mpm.querySelectorAll('ornament')].filter((ornament) =>
      ornament.hasAttribute('noteid'),
    );
    expect(figures).toHaveLength(8);
    for (const figure of figures) {
      const ref = figure.getAttributeNS(XML_NS, 'id');
      const principal = (figure.getAttribute('noteid') ?? '').replace(/^#/, '');
      // The grace notes and, last, the principal, struck in its place.
      const sounding = played.filter((note) => note.ornamentRef === ref);
      expect(sounding.length, String(ref)).toBeGreaterThan(1);
      expect(sounding.at(-1)?.id, String(ref)).toBe(principal);
    }
  });

  // The roll struck each of these principals as the grace note tied into it, early, and held it.
  //
  // To the millisecond for four of the five, and within five for `nrjny5d`. A figure's frame is in
  // ticks now, so its notes are notes of the score where the frame puts them, and a `<rubato>`
  // over that stretch moves them as it moves any other: the one from tick 72720, fitted to the
  // notes around the figure, takes this one 4.4 ms from where the roll has it. Rendered without
  // the rubato map all five are exact. In milliseconds the figure was out of the rubato's reach,
  // and of the tempo map's with it.
  test('strikes a principal a grace note is tied into where the roll struck that grace note', () => {
    const { played } = render();
    const take = at(sourcesOf(work.provenance), 0, 'the reading chosen');
    const onset = (id: string) => played.find((note) => note.id === id)?.milliseconds.date;

    expect(alignment.tiedPrincipals).toHaveLength(5);
    for (const principal of alignment.tiedPrincipals) {
      const id = principal['xml:id'];
      // Measured from the chord on the principal's date as it was last struck, there and here.
      const chord = pristine.allNotes.filter(
        (note) => note.date === principal.date && note.source === take,
      );
      const tied = pristine.graces.find(
        (grace) => grace.principal === id && grace.tied && grace.source === take,
      );
      const recordedChord = Math.max(...chord.map((note) => note['milliseconds.date']));
      const renderedChord = Math.max(...chord.map((note) => onset(note['xml:id']) ?? NaN));

      expect(tied, id).toBeDefined();
      expect(
        Math.abs(
          (onset(id) ?? NaN) - renderedChord - ((tied?.['milliseconds.date'] ?? NaN) - recordedChord),
        ),
        id,
      ).toBeLessThan(id === 'nrjny5d' ? 5 : 1);
    }
  });
});
