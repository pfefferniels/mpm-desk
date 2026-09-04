import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { Alignment, type AlignedNote } from '../../fitting/alignment';
import { useEventSelection } from './useEventSelection';

/**
 * The three clicks, and the three selector shapes a `Modify` can be built from.
 *
 * Two things this model can get wrong are invisible from the plot, so they are pinned here: a
 * plain click on an existing selection falling through and doing nothing, and "is this note in
 * the range?" being answered by walking every note in the piece, once per drawn note.
 */

const note = (id: string, date: number): AlignedNote => ({
    'xml:id': id,
    part: 1,
    staff: '1',
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
});

const msm = () => new Alignment([note('a', 0), note('b', 720), note('c', 1440)]);

const plain = { metaKey: false, shiftKey: false };
const meta = { metaKey: true, shiftKey: false };
const shift = { metaKey: false, shiftKey: true };

const setup = () => renderHook(() => useEventSelection(msm(), 'global'));

describe('a plain click', () => {
    it('selects the one event, as a list of ids', () => {
        const { result } = setup();

        act(() => { result.current.select({ kind: 'note', id: 'a', date: 0 }, plain); });

        expect(result.current.selection).toEqual({ noteIDs: ['a'] });
        expect([...result.current.selected]).toEqual(['a']);
    });

    it('leaves a selection it lands inside alone, so the group can be dragged by any member', () => {
        // The press that begins a drag is a plain one. Replacing on it would throw away
        // everything but the event under the cursor at the very moment the drag starts.
        const { result } = setup();

        act(() => { result.current.select({ kind: 'note', id: 'a', date: 0 }, plain); });
        act(() => { result.current.select({ kind: 'note', id: 'b', date: 720 }, meta); });
        const held = result.current.selection;

        act(() => { result.current.select({ kind: 'note', id: 'b', date: 720 }, plain); });

        expect(result.current.selection).toBe(held);
    });

    it('leaves a stretch alone when it lands inside that', () => {
        const { result } = setup();

        act(() => { result.current.select({ kind: 'note', id: 'a', date: 0 }, plain); });
        act(() => { result.current.select({ kind: 'note', id: 'c', date: 1440 }, shift); });

        act(() => { result.current.select({ kind: 'note', id: 'b', date: 720 }, plain); });

        expect(result.current.selection).toEqual({ from: 0, to: 1440 });
    });

    it('replaces a selection it lands outside', () => {
        // The behaviour the dynamics desk did not have: with a selection standing, a plain click
        // there fell through every branch, so there was no way to start a new selection.
        const { result } = setup();

        act(() => { result.current.select({ kind: 'note', id: 'a', date: 0 }, plain); });
        act(() => { result.current.select({ kind: 'note', id: 'c', date: 1440 }, plain); });

        expect(result.current.selection).toEqual({ noteIDs: ['c'] });
    });
});

describe('a cmd click', () => {
    it('adds to the list', () => {
        const { result } = setup();

        act(() => { result.current.select({ kind: 'note', id: 'a', date: 0 }, plain); });
        act(() => { result.current.select({ kind: 'note', id: 'b', date: 720 }, meta); });

        expect(result.current.selection).toEqual({ noteIDs: ['a', 'b'] });
    });

    it('takes an already-listed event back out', () => {
        const { result } = setup();

        act(() => { result.current.select({ kind: 'note', id: 'a', date: 0 }, plain); });
        act(() => { result.current.select({ kind: 'note', id: 'b', date: 720 }, meta); });
        act(() => { result.current.select({ kind: 'note', id: 'a', date: 0 }, meta); });

        expect(result.current.selection).toEqual({ noteIDs: ['b'] });
    });

    it('builds a new array rather than pushing into the old one', () => {
        // A shallow spread over a pushed-into array carries the same reference into the "new"
        // selection, and a consumer comparing references sees no change.
        const { result } = setup();

        act(() => { result.current.select({ kind: 'note', id: 'a', date: 0 }, plain); });
        const first = result.current.selection;
        act(() => { result.current.select({ kind: 'note', id: 'b', date: 720 }, meta); });

        expect(result.current.selection).not.toBe(first);
        expect(first).toEqual({ noteIDs: ['a'] });
    });
});

describe('a shift click', () => {
    it('turns a list of notes into the stretch that spans them', () => {
        const { result } = setup();

        act(() => { result.current.select({ kind: 'note', id: 'b', date: 720 }, plain); });
        act(() => { result.current.select({ kind: 'note', id: 'c', date: 1440 }, shift); });

        expect(result.current.selection).toEqual({ from: 720, to: 1440 });
        expect([...result.current.selected].sort()).toEqual(['b', 'c']);
    });

    it('reaches backwards as readily as forwards', () => {
        // `from` is the earlier of the two dates, not the one that was clicked first — reaching
        // left produced `from` > `to` before, which is a range that covers nothing.
        const { result } = setup();

        act(() => { result.current.select({ kind: 'note', id: 'c', date: 1440 }, plain); });
        act(() => { result.current.select({ kind: 'note', id: 'a', date: 0 }, shift); });

        expect(result.current.selection).toEqual({ from: 0, to: 1440 });
        expect(result.current.selected.size).toBe(3);
    });

    it('extends a stretch that is already open', () => {
        const { result } = setup();

        act(() => { result.current.select({ kind: 'note', id: 'a', date: 0 }, plain); });
        act(() => { result.current.select({ kind: 'note', id: 'b', date: 720 }, shift); });
        act(() => { result.current.select({ kind: 'note', id: 'c', date: 1440 }, shift); });

        expect(result.current.selection).toEqual({ from: 0, to: 1440 });
    });

    it('extends an open stretch backwards as readily', () => {
        // Issue #26's shape, in the branch the earlier fix left alone: writing `to` onto the
        // stretch inverted it as soon as the click landed before `from`.
        const { result } = setup();

        act(() => { result.current.select({ kind: 'note', id: 'b', date: 720 }, plain); });
        act(() => { result.current.select({ kind: 'note', id: 'c', date: 1440 }, shift); });
        act(() => { result.current.select({ kind: 'note', id: 'a', date: 0 }, shift); });

        expect(result.current.selection).toEqual({ from: 0, to: 1440 });
        expect(result.current.selected.size).toBe(3);
    });
});

describe('pedals', () => {
    it('form a list of their own, never a stretch', () => {
        // `from`/`to` is a stretch of the score, and a recorded pedal has no place on the score.
        const { result } = setup();

        act(() => { result.current.select({ kind: 'pedal', id: 'p1' }, plain); });
        act(() => { result.current.select({ kind: 'pedal', id: 'p2' }, shift); });

        expect(result.current.selection).toEqual({ pedalIDs: ['p1', 'p2'] });
    });

    it('replace a note selection rather than mixing with it', () => {
        const { result } = setup();

        act(() => { result.current.select({ kind: 'note', id: 'a', date: 0 }, plain); });
        act(() => { result.current.select({ kind: 'pedal', id: 'p1' }, meta); });

        expect(result.current.selection).toEqual({ pedalIDs: ['p1'] });
    });

    it('are replaced by a note selection in turn', () => {
        const { result } = setup();

        act(() => { result.current.select({ kind: 'pedal', id: 'p1' }, plain); });
        act(() => { result.current.select({ kind: 'note', id: 'a', date: 0 }, meta); });

        expect(result.current.selection).toEqual({ noteIDs: ['a'] });
    });
});

it('clears', () => {
    const { result } = setup();

    act(() => { result.current.select({ kind: 'note', id: 'a', date: 0 }, plain); });
    act(() => { result.current.clear(); });

    expect(result.current.selection).toBeUndefined();
    expect(result.current.selected.size).toBe(0);
});
