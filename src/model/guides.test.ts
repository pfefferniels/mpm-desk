/**
 * The guides of the dynamics curve follow the expansions of velocity: set on the expanded scale,
 * they move when an expansion is added or taken away, so that they stay beside the notes they
 * were set beside.
 */
import { describe, expect, it } from 'vitest';
import type { Call, WorkFile } from './Work';
import { followExpansions } from './guides';
import { initialHistory, workHistoryReducer, workReducer } from './workReducer';

const curve = (id: string, guides: [number, number][], scope: unknown = 'global'): Call => ({
    id,
    name: 'InsertDynamicsInstructions',
    options: { scope, from: 0, to: 2880, phantomVelocities: new Map(guides) },
});

const expand = (id: string, options: Record<string, unknown> = {}): Call => ({
    id,
    name: 'Expand',
    options: {
        scope: 'global',
        aspect: 'velocity',
        points: [
            [35, 20],
            [54, 46],
        ],
        ...options,
    },
});

const work = (provenance: Call[]): WorkFile => ({ name: '', mei: '', mpm: '', provenance, segments: [] });

const guidesOf = (state: WorkFile, id: string) => {
    const call = state.provenance.find((c) => c.id === id);
    return [...(call?.options.phantomVelocities as Map<number, number>)];
};

describe('adding an expansion of velocity', () => {
    it('moves every guide onto the expanded scale', () => {
        const next = workReducer(work([curve('d', [[720, 35], [1440, 54]])]), {
            type: 'add-call',
            call: expand('e'),
        });

        expect(guidesOf(next, 'd')).toEqual([
            [720, 20],
            [1440, 46],
        ]);
    });

    it('leaves the guides of the document it was handed alone', () => {
        const before = work([curve('d', [[720, 35]])]);
        workReducer(before, { type: 'add-call', call: expand('e') });

        expect(guidesOf(before, 'd')).toEqual([[720, 35]]);
    });

    it('moves only the guides a stretch of ticks reaches', () => {
        const next = workReducer(work([curve('d', [[720, 35], [1440, 35]])]), {
            type: 'add-call',
            call: expand('e', { from: 0, to: 1000 }),
        });

        expect(guidesOf(next, 'd')).toEqual([
            [720, 20],
            [1440, 35],
        ]);
    });

    it('moves no guide when it reaches notes by their ids, whose dates the file does not hold', () => {
        const before = work([curve('d', [[720, 35]])]);
        const next = workReducer(before, { type: 'add-call', call: expand('e', { noteIDs: ['n1'] }) });

        expect(next.provenance[0]).toBe(before.provenance[0]);
    });

    it('moves only the guides of its own part, or of every part when it is global', () => {
        const next = workReducer(work([curve('upper', [[720, 35]], 0), curve('lower', [[720, 35]], 1)]), {
            type: 'add-call',
            call: expand('e', { scope: 1 }),
        });

        expect(guidesOf(next, 'upper')).toEqual([[720, 35]]);
        expect(guidesOf(next, 'lower')).toEqual([[720, 20]]);
    });

    it('moves nothing when it is of another aspect', () => {
        const before = work([curve('d', [[720, 35]])]);
        const next = workReducer(before, { type: 'add-call', call: expand('e', { aspect: 'onset' }) });

        expect(next.provenance[0]).toBe(before.provenance[0]);
    });
});

describe('taking one away', () => {
    it('moves the guides back to the scale before it', () => {
        const expanded = workReducer(work([curve('d', [[720, 35], [1440, 50]])]), {
            type: 'add-call',
            call: expand('e'),
        });
        const back = workReducer(expanded, { type: 'remove-calls', ids: ['e'] });

        const guides = guidesOf(back, 'd');
        expect(guides[0][1]).toBeCloseTo(35, 9);
        expect(guides[1][1]).toBeCloseTo(50, 9);
    });

    it('undoes the ones after it as well, and applies them again', () => {
        // First 35..54 onto 20..46, then everything halved: a guide set at 35 is at 10.
        const halve = expand('h', { points: [[0, 0], [100, 50]] });
        const state = [expand('e'), halve].reduce(
            (s, call) => workReducer(s, { type: 'add-call', call }),
            work([curve('d', [[720, 35]])]),
        );
        expect(guidesOf(state, 'd')[0][1]).toBeCloseTo(10, 9);

        const without = workReducer(state, { type: 'remove-calls', ids: ['e'] });
        expect(guidesOf(without, 'd')[0][1]).toBeCloseTo(17.5, 9);
    });

    it('leaves a guide where it is when the map has no way back', () => {
        const folded = expand('f', { points: [[35, 20], [45, 40], [54, 30]] });
        const state = workReducer(work([curve('d', [[720, 50]])]), { type: 'add-call', call: folded });
        const moved = guidesOf(state, 'd')[0][1];

        const back = workReducer(state, { type: 'remove-calls', ids: ['f'] });
        expect(guidesOf(back, 'd')[0][1]).toBe(moved);
    });
});

it('is undone with the call', () => {
    const history = workHistoryReducer(initialHistory(work([curve('d', [[720, 35]])])), {
        type: 'add-call',
        call: expand('e'),
    });
    const undone = workHistoryReducer(history, { type: 'undo' });

    expect(guidesOf(undone.present, 'd')).toEqual([[720, 35]]);
});

it('returns a call whose guides do not move as it was', () => {
    const untouched = curve('d', [[720, 35]], 0);
    const [after] = followExpansions([], [untouched, expand('e', { scope: 1 })]);

    expect(after).toBe(untouched);
});
