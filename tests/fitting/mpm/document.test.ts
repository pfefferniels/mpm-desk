import { describe, expect, test } from 'vitest';
import {
  AccentuationPatternDef,
  ArticulationDef,
  auditInstructions,
  clearOrnamentDraft,
  createMpm,
  ensureDefaultStyle,
  exportMPM,
  fillInAt,
  FrameDomain,
  getDefinition,
  getDefinitions,
  getInstructions,
  getStyles,
  type InstructionOptions,
  insertDefinition,
  insertStyle,
  mapOf,
  Mpm,
  NoteOffShift,
  ornamentDraftOf,
  OrnamentDef,
  parseMPM,
  removeDefinition,
  removeInstruction,
  requireMap,
  scopesOf,
  setOrnamentDraft,
  unwrap,
} from '../../../src/fitting/instructions/index';
import { at, only } from '../../support/at';

const tempo = (date: number, bpm: number, id = `tempo_${date}`): InstructionOptions<'tempo'> => ({
  id,
  date,
  bpm,
  beatLength: 0.25,
});

describe('instructions', () => {
  test('go into the map their type names, sorted by date', () => {
    const mpm = createMpm();
    const map = requireMap(mpm, 'tempo', 'global');
    map.addTempo(tempo(1440, 90));
    map.addTempo(tempo(0, 60));

    expect(getInstructions(mpm, 'tempo', 'global').map((t) => t.date)).toEqual([0, 1440]);
    expect(exportMPM(mpm)).toContain('<tempoMap>');
  });

  test('are snapshots: reading twice does not hand back the same object', () => {
    const mpm = createMpm();
    requireMap(mpm, 'tempo', 'global').addTempo(tempo(0, 60));

    const [first] = getInstructions(mpm, 'tempo', 'global');
    const [again] = getInstructions(mpm, 'tempo', 'global');

    // The old layer proxied every property onto the element and cached one view per
    // element, so this was `toBe`. Nothing relies on that any more, and a value that looks
    // like data and silently is not was the reason to stop.
    expect(again).not.toBe(first);
    expect(again).toEqual(first);
  });

  test('are changed through the espressivo map, which reaches the XML', () => {
    const mpm = createMpm();
    const map = requireMap(mpm, 'tempo', 'global');
    const index = map.addTempo(tempo(0, 60));

    map.updateTempoAt(index, { bpm: 72, transitionTo: 90 });

    expect(exportMPM(mpm)).toContain('bpm="72"');
    expect(exportMPM(mpm)).toContain('transition.to="90"');
    expect(at(getInstructions(mpm, 'tempo', 'global'), 0, 'tempo').bpm).toBe(72);
  });

  test('carry the element they stand for, and their scope', () => {
    const mpm = createMpm();
    requireMap(mpm, 'tempo', 'global').addTempo(tempo(0, 60));

    const inserted = at(getInstructions(mpm, 'tempo', 'global'), 0, 'tempo');
    expect(inserted.element.getLocalName()).toBe('tempo');
    expect(inserted.scope).toBe('global');
    expect(inserted.type).toBe('tempo');
  });

  test('removing takes the element out of the map', () => {
    const mpm = createMpm();
    const map = requireMap(mpm, 'tempo', 'global');
    map.addTempo(tempo(0, 60));
    map.addTempo(tempo(720, 90));

    removeInstruction(mpm, at(getInstructions(mpm, 'tempo', 'global'), 0, 'tempo'));

    expect(getInstructions(mpm, 'tempo', 'global').map((t) => t.date)).toEqual([720]);
    expect(exportMPM(mpm)).not.toContain('bpm="60"');
  });
});

/**
 * The one merge contract in the layer: two transformers describing one element, the second
 * landing inside the first's rather than beside it.
 */
describe('filling in at a date', () => {
  const fillIn = (mpm: Mpm, options: InstructionOptions<'dynamics'>) => {
    const map = requireMap(mpm, 'dynamics', 'global');
    return fillInAt(map, options, {
      localName: 'dynamics',
      add: (o) => map.addDynamics(o),
      read: (i) => map.getDynamicsOptionsOf(i),
      update: (i, patch) => map.updateDynamicsAt(i, patch),
    });
  };

  test('a second instruction at the same date fills the first in', () => {
    const mpm = createMpm();
    fillIn(mpm, { id: 'dynamics_720', date: 720, volume: 30 });
    fillIn(mpm, { id: 'dynamics_720_1', date: 720, volume: 60, transitionTo: 90 });

    const written = getInstructions(mpm, 'dynamics', 'global');
    expect(written).toHaveLength(1);
    expect(only(written, 'dynamics instruction').volume).toBe(30);
    expect(only(written, 'dynamics instruction').transitionTo).toBe(90);
  });

  test('a value already there wins even when it is 0', () => {
    // "Already has a value" and "already has a truthy value" are different rules, and only
    // the first is the one this mechanism needs. A volume of 0 is not an exotic value here:
    // it is what `InsertDynamicsInstructions.closeTransition` writes to end a diminuendo al
    // niente, so under the truthy rule the next segment's fit silently replaced the point
    // the previous one had been fitted to reach (issue #46).
    const mpm = createMpm();
    fillIn(mpm, { id: 'dynamics_720', date: 720, volume: 0 });
    fillIn(mpm, { id: 'dynamics_720_1', date: 720, volume: 60, curvature: 0.4 });

    const written = getInstructions(mpm, 'dynamics', 'global');
    expect(written).toHaveLength(1);
    expect(only(written, 'dynamics instruction').volume).toBe(0);
    expect(only(written, 'dynamics instruction').curvature).toBe(0.4);
  });

  test('a date the map does not hold does not merge into the next instruction', () => {
    const mpm = createMpm();
    fillIn(mpm, { id: 'dynamics_720', date: 720, volume: 90 });
    fillIn(mpm, { id: 'dynamics_0', date: 0, volume: 60 });

    expect(getInstructions(mpm, 'dynamics', 'global').map((d) => d.volume)).toEqual([60, 90]);
  });

  test('a <style> switch sharing the date is not filled in', () => {
    const mpm = createMpm();
    insertStyle(
      mpm,
      { 'xml:id': 'style_0', date: 0, 'name.ref': 'performance_style' },
      'dynamics',
      'global',
    );
    fillIn(mpm, { id: 'dynamics_0', date: 0, volume: 60 });

    expect(getInstructions(mpm, 'dynamics', 'global')).toHaveLength(1);
    expect(getStyles(mpm, 'dynamics', 'global')).toHaveLength(1);
  });
});

describe('mapOf and requireMap', () => {
  test('requireMap creates the part, the dated and the map; mapOf creates nothing', () => {
    const mpm = createMpm();

    expect(mapOf(mpm, 'tempo', 3)).toBeNull();
    expect(scopesOf(mpm)).toEqual(['global']);

    const map = requireMap(mpm, 'tempo', 3);
    map.addTempo(tempo(0, 60));

    expect(scopesOf(mpm)).toEqual(['global', 3]);
    expect(mapOf(mpm, 'tempo', 3)).toBe(map);
  });

  test("hands back espressivo's own class, with its whole surface", () => {
    const mpm = createMpm();
    const map = requireMap(mpm, 'tempo', 'global');
    map.addTempo(tempo(0, 120));

    // Not a wrapper: the renderer's own readers answer on it. `getTempoAt` scans strictly
    // BEFORE the date it is given (`getElementIndexBefore`), so ask after the instruction.
    expect(map.getTempoAt(720)).toBeCloseTo(120, 6);
    expect(map.getTempoDataOf(0)?.kind).toBe('constant');
  });
});

describe('auditInstructions', () => {
  test('fingerprints every instruction that has an id', () => {
    const mpm = createMpm();
    requireMap(mpm, 'tempo', 'global').addTempo(tempo(0, 60, 't1'));

    const { fingerprints, unnamed, nonFinite } = auditInstructions(mpm);
    expect([...fingerprints.keys()]).toEqual(['t1']);
    expect(fingerprints.get('t1')).toContain('bpm="60"');
    expect(unnamed).toEqual([]);
    expect(nonFinite).toEqual([]);
  });

  test('names an instruction written without an xml:id', () => {
    const mpm = createMpm();
    requireMap(mpm, 'tempo', 'global').addTempo({ date: 720, bpm: 60, beatLength: 0.25 });

    expect(auditInstructions(mpm).unnamed).toEqual(['<tempo> at 720']);
    expect(auditInstructions(mpm).fingerprints.size).toBe(0);
  });

  test('names a non-finite attribute, wherever it was written from', () => {
    const mpm = createMpm();
    // Straight through the espressivo map, which is exactly the path a check on the way in
    // would not have covered.
    requireMap(mpm, 'tempo', 'global').addTempo({
      id: 't1',
      date: 0,
      bpm: 60,
      beatLength: 0.25,
      meanTempoAt: NaN,
    });

    expect(auditInstructions(mpm).nonFinite).toEqual(['<tempo @meanTempoAt>="NaN"']);
  });

  test('the fingerprint changes when an instruction is edited, not only when one is added', () => {
    const mpm = createMpm();
    const map = requireMap(mpm, 'tempo', 'global');
    const index = map.addTempo(tempo(0, 60, 't1'));
    const before = auditInstructions(mpm).fingerprints;

    map.updateTempoAt(index, { bpm: 90 });

    expect(auditInstructions(mpm).fingerprints.get('t1')).not.toBe(before.get('t1'));
  });
});

describe('style switches', () => {
  test('go before the instructions sharing their date, so the style is in force', () => {
    const mpm = createMpm();
    const map = requireMap(mpm, 'tempo', 'global');
    map.addTempo(tempo(0, 60));
    map.addTempo(tempo(720, 90));
    insertStyle(
      mpm,
      { 'xml:id': 'style_0', date: 0, 'name.ref': 'performance_style' },
      'tempo',
      'global',
    );

    const written = exportMPM(mpm).match(/<tempoMap>(.*?)<\/tempoMap>/s);
    if (written === null) throw new Error('the export holds no <tempoMap>');
    const serialized = at(written, 1, '<tempoMap> body');
    expect(serialized.indexOf('<style')).toBeLessThan(serialized.indexOf('<tempo '));
  });

  test('carry defaultArticulation when given one', () => {
    const mpm = createMpm();
    insertStyle(
      mpm,
      {
        'xml:id': 'style_0',
        date: 0,
        'name.ref': 'performance_style',
        defaultArticulation: 'legato',
      },
      'articulation',
      'global',
    );

    expect(
      at(getStyles(mpm, 'articulation', 'global'), 0, 'style switch').defaultArticulation,
    ).toBe('legato');
  });

  test('ensureDefaultStyle writes one switch however often it is asked', () => {
    const mpm = createMpm();
    ensureDefaultStyle(mpm, 'articulation', 'global');
    ensureDefaultStyle(mpm, 'articulation', 'global', { defaultArticulation: 'legato' });

    const styles = getStyles(mpm, 'articulation', 'global');
    expect(styles).toHaveLength(1);
    expect(only(styles, 'style switch').defaultArticulation).toBe('legato');
  });
});

describe('definitions', () => {
  test('go into the styleDef of their collection and read back as espressivo defs', () => {
    const mpm = createMpm();
    const def = unwrap(ArticulationDef.createArticulationDef('legato'));
    def.setRelativeDuration(1.05);
    insertDefinition(mpm, 'articulationDef', def, 'global');

    const defs = getDefinitions(mpm, 'articulationDef', 'global');
    expect(defs).toHaveLength(1);
    expect(only(defs, 'articulationDef').getRelativeDuration()).toBe(1.05);
    expect(exportMPM(mpm)).toContain('<articulationStyles>');
  });

  test('carry their child elements', () => {
    const mpm = createMpm();
    const def = unwrap(AccentuationPatternDef.fromNameLength('downbeat', 1));
    def.addAccentuation(1, 1, 1, 0);
    def.addAccentuation(3, 0.5, 0.5, 0);
    insertDefinition(mpm, 'accentuationPatternDef', def, 'global');

    const found = getDefinition(mpm, 'accentuationPatternDef', 'downbeat')!;
    expect(found.getAllAccentuations().map((a) => a.key[0])).toEqual([1, 3]);
  });

  test('are the very object that was inserted, so a later setter edits the document', () => {
    const mpm = createMpm();
    const def = unwrap(OrnamentDef.createOrnamentDef('roll'));
    insertDefinition(mpm, 'ornamentDef', def, 'global');

    def.setTemporalSpreadValues(-100, 200, FrameDomain.Milliseconds, 1, NoteOffShift.Monophonic);

    const found = getDefinition(mpm, 'ornamentDef', 'roll')!;
    expect(found.getTemporalSpread()?.noteOffShift).toBe(NoteOffShift.Monophonic);
    expect(found.getTemporalSpread()?.getFrameLength()).toBe(200);
    expect(found.getDynamicsGradient()).toBeNull();
    expect(exportMPM(mpm)).toContain('noteoff.shift="monophonic"');
  });

  test('can be removed after being renamed', () => {
    const mpm = createMpm();
    const def = unwrap(ArticulationDef.createArticulationDef('a'));
    insertDefinition(mpm, 'articulationDef', def, 'global');

    // Found by element identity, not by name: renaming leaves espressivo's by-name index
    // keyed on the old one.
    def.setName('renamed');
    removeDefinition(mpm, 'articulationDef', def);

    expect(getDefinitions(mpm, 'articulationDef', 'global')).toHaveLength(0);
    expect(exportMPM(mpm)).not.toContain('articulationDef');
  });
});

describe('scopes', () => {
  test('a part is created on demand and numbered as Alignment expects', () => {
    const mpm = createMpm();
    requireMap(mpm, 'tempo', 1).addTempo(tempo(0, 60));

    expect(scopesOf(mpm)).toEqual(['global', 1]);
    expect(exportMPM(mpm)).toContain('number="2"');
    expect(exportMPM(mpm)).toContain('midi.channel="1"');
  });

  test('reading without a scope reaches every part', () => {
    const mpm = createMpm();
    requireMap(mpm, 'tempo', 'global').addTempo(tempo(0, 60));
    requireMap(mpm, 'tempo', 0).addTempo(tempo(720, 90));

    expect(getInstructions(mpm, 'tempo').map((t) => t.date)).toEqual([0, 720]);
  });
});

describe('round trip', () => {
  const source = `<?xml version="1.0"?>
<mpm xmlns="http://www.cemfi.de/mpm/ns/1.0">
  <performance name="test" pulsesPerQuarter="720">
    <global>
      <header>
        <metricalAccentuationStyles>
          <styleDef name="performance_style">
            <accentuationPatternDef name="downbeat" length="1">
              <accentuation beat="1" value="1" transition.from="1" transition.to="0"/>
            </accentuationPatternDef>
          </styleDef>
        </metricalAccentuationStyles>
      </header>
      <dated>
        <metricalAccentuationMap>
          <style date="0" name.ref="performance_style"/>
          <accentuationPattern date="0" name.ref="downbeat" scale="3" loop="true"/>
          <accentuationPattern date="2880" name.ref="downbeat" scale="1.5"/>
        </metricalAccentuationMap>
        <dynamicsMap>
          <dynamics date="0" volume="60" transition.to="90" curvature="0.5"/>
        </dynamicsMap>
        <rubatoMap>
          <rubato date="0" frameLength="720" intensity="1.4" loop="true"/>
        </rubatoMap>
      </dated>
    </global>
  </performance>
</mpm>`;

  test("reads <accentuationPattern>, which mpm-ts's reader dropped", () => {
    const mpm = parseMPM(source);

    const patterns = getInstructions(mpm, 'accentuationPattern', 'global');
    expect(patterns).toHaveLength(2);
    expect(at(patterns, 0, 'accentuationPattern').scale).toBe(3);
    expect(at(patterns, 0, 'accentuationPattern').loop).toBe(true);
    expect(at(patterns, 1, 'accentuationPattern').loop).toBeUndefined();
    expect(at(patterns, 1, 'accentuationPattern').accentuationPatternDefName).toBe('downbeat');
  });

  test('reads the definitions the patterns refer to', () => {
    const mpm = parseMPM(source);

    const def = getDefinition(mpm, 'accentuationPatternDef', 'downbeat')!;
    expect(def.getLength()).toBe(1);
    expect(def.size()).toBe(1);
    expect(def.getAccentuationAttributes(0)?.[2]).toBe(1);
  });

  test('reads the other maps and their numbers', () => {
    const mpm = parseMPM(source);

    expect(at(getInstructions(mpm, 'dynamics', 'global'), 0, 'dynamics').volume).toBe(60);
    expect(at(getInstructions(mpm, 'rubato', 'global'), 0, 'rubato').intensity).toBe(1.4);
    expect(getStyles(mpm, 'accentuationPattern', 'global')).toHaveLength(1);
  });

  test('a symbolic level stays the name it was written as', () => {
    const mpm = parseMPM(source.replace('volume="60"', 'volume="forte"'));

    expect(at(getInstructions(mpm, 'dynamics', 'global'), 0, 'dynamics').volume).toBe('forte');
  });

  test('what was read can be written back', () => {
    const mpm = parseMPM(source);

    const again = parseMPM(exportMPM(mpm));
    expect(getInstructions(again, 'accentuationPattern', 'global')).toHaveLength(2);
    expect(exportMPM(again)).toContain('xmlns="http://www.cemfi.de/mpm/ns/1.0"');
  });
});

describe('the ornament draft', () => {
  test('is not part of the instruction, and survives a patch of one', () => {
    const mpm = createMpm();
    const map = requireMap(mpm, 'ornament', 'global');
    const ornament = map.getElement(map.addOrnamentV3({ id: 'o1', date: 0, nameRef: 'roll' }))!;
    setOrnamentDraft(ornament, {
      frameStart: -100,
      frameLength: 200,
      frameDomain: FrameDomain.Milliseconds,
    });

    map.updateOrnamentAt(map.getElementIndexOf(ornament), { scale: 0.5 });

    expect(ornamentDraftOf(ornament).frameStart).toBe(-100);
    expect(at(getInstructions(mpm, 'ornament', 'global'), 0, 'ornament')).not.toHaveProperty(
      'frameStart',
    );
  });

  test('comes off entirely when a real definition holds it', () => {
    const mpm = createMpm();
    const map = requireMap(mpm, 'ornament', 'global');
    const ornament = map.getElement(map.addOrnamentV3({ id: 'o1', date: 0, nameRef: 'roll' }))!;
    setOrnamentDraft(ornament, {
      transitionFrom: 0,
      transitionTo: 1,
      frameStart: -100,
      frameLength: 200,
      frameDomain: FrameDomain.Ticks,
      noteOffShift: NoteOffShift.True,
      intensity: 0.5,
    });

    clearOrnamentDraft(ornament);

    expect(ornamentDraftOf(ornament)).toEqual({});
    expect(exportMPM(mpm)).toContain('<ornament');
    for (const gone of ['transition.from', 'frame.start', 'time.unit', 'noteoff.shift']) {
      expect(exportMPM(mpm)).not.toContain(gone);
    }
  });
});
