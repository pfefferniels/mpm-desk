import { describe, expect, test } from 'vitest';
import { Alignment, type AlignedNote, type AlignedPedal } from '../../src/fitting/alignment';
import { InsertTempo } from '../../src/fitting/transformers/tempo/InsertTempo';
import { InsertRubato } from '../../src/fitting/transformers/rubato/InsertRubato';
import { InsertArticulation } from '../../src/fitting/transformers/articulation/InsertArticulation';
import { InsertMetricalAccentuation } from '../../src/fitting/transformers/accentuation/InsertMetricalAccentuation';
import { InsertTemporalSpread } from '../../src/fitting/transformers/ornamentation/InsertTemporalSpread';
import { InsertPedal } from '../../src/fitting/transformers/pedal/InsertPedalInstructions';
import { Modify } from '../../src/fitting/transformers/modification/Modify';
import { MergeMetricalAccentuations } from '../../src/fitting/transformers/accentuation/MergeMetricalAccentuations';
import { InsertGraceNotes } from '../../src/fitting/transformers/ornamentation/InsertGraceNotes';
import type { AlignedGrace } from '../../src/fitting/alignment';

/**
 * What a call was fitted to — `Transformer.evidence`, which a desk marks when the call is selected.
 *
 * The default is the call's scope over its range, both ends included. Each case below is a call
 * that reads something else, and says so: the frame that stops short of its end, the unit that
 * names its notes, the pattern sampled on its beats, the press.
 */

const note = (id: string, date: number, part = 1, over: Partial<AlignedNote> = {}): AlignedNote => ({
    'xml:id': id,
    part,
    staff: String(part),
    layer: '1',
    date,
    duration: 720,
    pitchname: 'c',
    accidentals: 0,
    octave: 4,
    'milliseconds.date': date,
    'milliseconds.date.end': date + 500,
    'midi.pitch': 60,
    velocity: 64,
    ...over,
});

const pedal = (id: string): AlignedPedal => ({
    'xml:id': id,
    type: 'sustain',
    'milliseconds.date': 0,
    'milliseconds.date.end': 1000,
});

/** A quarter at every 720 ticks over two bars of 4/4, in part 1, and one note in part 2. */
const score = () => {
    const msm = new Alignment([
        ...Array.from({ length: 8 }, (_, i) => note(`n${String(i * 720)}`, i * 720)),
        note('bass0', 0, 2),
    ]);
    msm.pedals = [pedal('p1'), pedal('p2')];
    return msm;
};

describe('what a call was fitted to', () => {
    test('a tempo: its scope over its span, both ends included', () => {
        const tempo = new InsertTempo({ scope: 'global', from: 720, to: 2160, bpm: 60, beatLength: 0.25 });
        expect(tempo.evidence(score()).sort()).toEqual(['n1440', 'n2160', 'n720']);
    });

    test('in a part, the part’s notes only', () => {
        const tempo = new InsertTempo({ scope: 1, from: 0, to: 720, bpm: 60, beatLength: 0.25 });
        expect(tempo.evidence(score())).toEqual(['bass0']);
    });

    test('a rubato frame: from its date up to its end, and not the chord at the end', () => {
        const rubato = new InsertRubato({ scope: 'global', date: 720, length: 1440 });
        expect(rubato.evidence(score()).sort()).toEqual(['n1440', 'n720']);
    });

    test('an articulation unit: the notes it names, not those its range spans', () => {
        const unit = new InsertArticulation({
            scope: 'global',
            noteIDs: ['n0', 'n2160'],
            name: 'unit',
            aspects: new Set(['relativeVelocity'] as const),
        });
        expect(unit.evidence(score()).sort()).toEqual(['n0', 'n2160']);
    });

    test('an accentuation cell: the chords on the beats it is sampled at', () => {
        // Half-note beats over a bar: sampled at 0, 1440 and 2880, and nothing between.
        const cell = new InsertMetricalAccentuation({
            scope: 'global',
            from: 0,
            to: 2880,
            beatLength: 0.5,
        } as ConstructorParameters<typeof InsertMetricalAccentuation>[0]);
        expect(cell.evidence(score()).sort()).toEqual(['bass0', 'n0', 'n1440', 'n2880']);
    });

    test('a spread: the chord at its date', () => {
        const spread = new InsertTemporalSpread({
            scope: 'global',
            date: 1440,
            placement: 'before-beat',
            noteOffShiftTolerance: 2,
        } as ConstructorParameters<typeof InsertTemporalSpread>[0]);
        expect(spread.evidence(score())).toEqual(['n1440']);
    });

    test('a pedal call: the recorded press it writes, or every press where it names none', () => {
        expect(new InsertPedal({ pedal: 'p2' }).evidence(score())).toEqual(['p2']);
        expect(new InsertPedal({}).evidence(score())).toEqual(['p1', 'p2']);
    });

    test('a correction: the notes or presses it names', () => {
        const byNotes = new Modify({ scope: 'global', aspect: 'velocity', change: 3, noteIDs: ['n720'] });
        const byPresses = new Modify({ scope: 'global', aspect: 'onset', change: 10, pedalIDs: ['p1'] });
        expect(byNotes.evidence(score())).toEqual(['n720']);
        expect(byPresses.evidence(score())).toEqual(['p1']);
    });

    test('grace notes: the recorded grace notes of the group, and the principal they lead into', () => {
        const grace = (id: string, group: string, principal: string, part = 1): AlignedGrace => ({
            'xml:id': id,
            group,
            principal,
            tied: false,
            part,
            date: 1440,
            slot: 0,
            'midi.pitch': 62,
            velocity: 50,
            'milliseconds.date': 1300,
            'milliseconds.date.end': 1400,
        });
        const msm = score();
        msm.graces = [grace('g1', 'grp1', 'n1440'), grace('g2', 'grp2', 'n2160'), grace('g3', 'grp3', 'bass0', 2)];

        // One group: not the chord at the principal's date, which no grace note is part of.
        expect(new InsertGraceNotes({ scope: 'global', group: 'grp1' }).evidence(msm).sort()).toEqual(['g1', 'n1440']);
        // Every group of a part, where it names none.
        expect(new InsertGraceNotes({ scope: 0 }).evidence(msm).sort()).toEqual(['g1', 'g2', 'n1440', 'n2160']);
    });

    test('a pass over the whole piece: nothing, being about no place in it', () => {
        expect(new MergeMetricalAccentuations().evidence(score())).toEqual([]);
    });

    test('every reading of a note once: an id has a row per take until a choice', () => {
        const msm = new Alignment([note('a', 0, 1, { source: 'take-1' }), note('a', 0, 1, { source: 'take-2' })]);
        const tempo = new InsertTempo({ scope: 'global', from: 0, to: 720, bpm: 60, beatLength: 0.25 });
        expect(tempo.evidence(msm)).toEqual(['a']);
    });
});
