import { describe, expect, test } from 'vitest';
import { findViolations } from './invariants';

/**
 * Tests for the structural checks themselves.
 *
 * An assertion that cannot fail is worse than no assertion: it reads as coverage. Each check
 * gets a document that violates it and one that does not, so a check that silently stops
 * working is caught here rather than by quietly passing everything downstream.
 */

const wrap = (header: string, dated: string) =>
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<mpm xmlns="http://www.cemfi.de/mpm/ns/1.0">' +
  '<performance name="t" pulsesPerQuarter="720">' +
  `<global><header>${header}</header><dated>${dated}</dated></global>` +
  '</performance></mpm>';

const checks = (xml: string) => findViolations(xml).map((violation) => violation.check);

describe('the structural checks have teeth', () => {
  test('a well-formed document reports nothing', () => {
    expect(
      findViolations(
        wrap(
          '<articulationStyles><styleDef name="s"><articulationDef name="a" relativeDuration="1.2"/></styleDef></articulationStyles>',
          '<tempoMap><tempo date="0" xml:id="t0" bpm="60" transition.to="90"/><tempo date="720" xml:id="t1" bpm="90"/></tempoMap>' +
            '<articulationMap><style date="0" name.ref="s"/><articulation date="0" xml:id="a0" name.ref="a" noteid="#n0"/></articulationMap>',
        ),
      ),
    ).toEqual([]);
  });

  test('a repeated xml:id is caught (#30)', () => {
    expect(
      checks(
        wrap(
          '',
          '<tempoMap><tempo date="0" xml:id="t" bpm="60"/><tempo date="720" xml:id="t" bpm="90"/></tempoMap>',
        ),
      ),
    ).toContain('unique xml:id');
  });

  test('NaN written into an attribute is caught (#44)', () => {
    expect(
      checks(wrap('', '<tempoMap><tempo date="0" xml:id="t0" bpm="NaN"/></tempoMap>')),
    ).toContain('attribute values are values');
  });

  test('a transition with no successor is caught (#24)', () => {
    expect(
      checks(
        wrap('', '<tempoMap><tempo date="0" xml:id="t0" bpm="60" transition.to="90"/></tempoMap>'),
      ),
    ).toContain('every transition is closed');
  });

  test('a @name.ref that names no definition is caught (#28)', () => {
    expect(
      checks(
        wrap(
          '<articulationStyles><styleDef name="s"><articulationDef name="a"/></styleDef></articulationStyles>',
          '<articulationMap><style date="0" name.ref="s"/><articulation date="0" xml:id="a0" name.ref="missing"/></articulationMap>',
        ),
      ),
    ).toContain('@name.ref resolves');
  });

  test('a defaultArticulation that names no definition is caught', () => {
    expect(
      checks(
        wrap(
          '<articulationStyles><styleDef name="s"><articulationDef name="a"/></styleDef></articulationStyles>',
          '<articulationMap><style date="0" name.ref="s" defaultArticulation="missing"/></articulationMap>',
        ),
      ),
    ).toContain('@name.ref resolves');
  });

  test('a map that references definitions but never switches style is caught', () => {
    // Without a <style> nothing puts the styleDef in scope, so every @name.ref in the map
    // resolves to nothing and the instructions are inert. See old-bugs.md.
    expect(
      checks(
        wrap(
          '<articulationStyles><styleDef name="s"><articulationDef name="a"/></styleDef></articulationStyles>',
          '<articulationMap><articulation date="0" xml:id="a0" name.ref="a"/></articulationMap>',
        ),
      ),
    ).toContain('a map that references definitions switches to a style');
  });

  test('two style switches at the same date are caught', () => {
    expect(
      checks(
        wrap(
          '<articulationStyles><styleDef name="s"><articulationDef name="a"/></styleDef></articulationStyles>',
          '<articulationMap><style date="0" name.ref="s"/><style date="0" name.ref="s"/></articulationMap>',
        ),
      ),
    ).toContain('one <style> per date');
  });

  test('malformed XML is an error, not a clean report', () => {
    expect(() => findViolations('<mpm><unclosed>')).toThrow();
  });
});
