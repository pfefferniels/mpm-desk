/**
 * The transport over the published transcription, the engine itself answering in the worker's
 * place: what reaches the piano for the whole roll, and for a remark on two of its bars.
 *
 * Nobody hears a test. What is measured instead is what there is to measure: that every note is
 * struck, once, when and as loud as the roll shows it, and that nothing is left sounding.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MidiFile } from 'midifile-ts';
import { addAbsoluteTime } from 'react-pianosound';
import type { DescriptionClient } from '../../../fitting/description/client';
import {
    bringOut,
    describe as runDescription,
    type DescriptionRun,
} from '../../../fitting/description/index';
import type { DescribedPlace } from '../../../fitting/transformers/description/Describe';
import { createFakePiano } from '../../../test/fakePiano';
import { bar, loadPublished, remark, step } from '../../../../tests/fitting/description/published';
import { endOf } from './hearing';
import { useDescribePlayback } from './index';

let rig = createFakePiano();

vi.mock('../../../performance/piano', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../performance/piano')>()),
    usePiano: () => rig.usePiano(),
}));

const client: DescriptionClient = {
    describe: () => new Promise(() => undefined),
    bringOut: (run, ids, factor, attenuation) =>
        Promise.resolve().then(() => bringOut(run, ids, factor, attenuation)),
    dispose: () => undefined,
};

// Two bars that press forward and grow louder.
const [FROM, TO] = [bar(16), bar(18)];
const places = new Map<string, DescribedPlace>([['r1', { kind: 'span', from: FROM, to: TO, notes: [] }]]);

/** The published reconstruction as it stands, and a remark on the two bars' loudness. */
let reconstructed: DescriptionRun;
/** Nothing but the two bars described: their tempo and their loudness. */
let described: DescriptionRun;

beforeAll(() => {
    const published = loadPublished();
    reconstructed = runDescription(published.alignment, [
        ...published.work.provenance,
        remark('r1', [step('InsertDynamics', { from: FROM, to: TO })]),
    ]);
    described = runDescription(published.alignment, [
        ...published.choice,
        remark('r1', [
            step('FitTempo', { from: FROM, to: TO, shape: 'transition' }),
            step('InsertDynamics', { from: FROM, to: TO }),
        ]),
    ]);
}, 120_000);

beforeEach(() => {
    vi.useFakeTimers();
    rig = createFakePiano();
});

afterEach(() => {
    vi.useRealTimers();
});

const mount = (run: DescriptionRun) => renderHook(() => useDescribePlayback({ run, places, client })).result;

const runTo = (seconds: number) =>
    act(() => {
        rig.transport.advanceTo(seconds);
        vi.advanceTimersByTime(20);
    });

const settled = () =>
    act(async () => {
        for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    });

/** Each note a file strikes: when, in ms from its beginning, and how hard. */
const struckIn = (file: MidiFile) => {
    const keys = new Map<string, { ms: number; velocity: number }>();
    let id: string | null = null;
    for (const event of addAbsoluteTime(file)) {
        if (event.type === 'meta' && event.subtype === 'text') id = event.text;
        else if (event.type === 'channel' && event.subtype === 'noteOn' && id !== null) {
            keys.set(id, { ms: Math.round(event.abs), velocity: event.velocity });
            id = null;
        }
    }
    return keys;
};

const sent = (type: string) => rig.piano.actions.filter((action) => action.type === type).length;
const sounding = () => rig.piano.held.size + rig.piano.sustained.size;

describe('the roll of the published transcription', () => {
    it('is struck as it was played: every note and grace note once, when and as hard as it was recorded', () => {
        const { roll } = reconstructed;
        const playback = mount(reconstructed);
        act(() => playback.current.toggle());

        const keys = struckIn(rig.played[0]);
        expect(keys.size).toBe(roll.notes.length + roll.graces.length);
        for (const note of roll.notes) {
            expect(keys.get(note.id)).toEqual({ ms: Math.round(note.ms), velocity: Math.round(note.velocity) });
        }

        runTo(endOf(roll) / 1000 + 1);
        expect(sent('keyDown')).toBe(keys.size);
        expect(new Set(rig.heard).size).toBe(keys.size);
        expect(sent('pedalDown')).toBe(roll.pedals.played.filter((press) => press.kind === 'sustain').length);
        expect(rig.piano.dropped).toBe(0);
        expect(playback.current.playing).toBe(false);
        expect(sounding()).toBe(0);
    });

    it('is struck as the MPM renders it: every note once, though the rendering holds some into the next on their key', () => {
        const { roll } = reconstructed;
        const held = roll.notes.filter((note) =>
            roll.notes.some((next) => next.pitch === note.pitch && next.mpm.ms > note.mpm.ms && next.mpm.ms < note.mpm.msEnd),
        );
        expect(held.length).toBeGreaterThan(10);

        const playback = mount(reconstructed);
        act(() => playback.current.setHearing('rendered'));
        act(() => playback.current.toggle());
        const keys = struckIn(rig.played[0]);
        for (const note of roll.notes) {
            expect(keys.get(note.id)).toEqual({ ms: Math.round(note.mpm.ms), velocity: Math.round(note.mpm.velocity) });
        }

        runTo(endOf(roll) / 1000 + 1);
        expect(sent('keyDown')).toBe(roll.notes.length);
        expect(rig.piano.dropped).toBe(0);
        expect(sounding()).toBe(0);
    });
});

describe('a remark of the published transcription, brought out', () => {
    const own = (run: DescriptionRun) => run.roll.notes.filter((note) => note.date >= FROM && note.date < TO);

    it('is struck where the roll shows it and as loud, with what it takes around it, and then is still', async () => {
        const playback = mount(described);
        act(() => playback.current.bring('r1'));
        await settled();

        const { moved } = playback.current;
        expect(playback.current).toMatchObject({ playing: true, brought: 'r1' });
        const keys = struckIn(rig.played[0]);
        // One clock: every note as far into what the piano was handed as it is along the roll.
        const into = own(described).map((note) => moved!.get(note.id)!.ms - keys.get(note.id)!.ms);
        expect(Math.max(...into) - Math.min(...into)).toBeLessThanOrEqual(1);
        for (const note of own(described)) {
            expect(keys.get(note.id)!.velocity).toBe(Math.round(moved!.get(note.id)!.velocity));
        }
        // More than the two bars: what came before to measure against, and what comes after.
        expect(keys.size).toBeGreaterThan(own(described).length + 2);

        runTo(30);
        expect(sent('keyDown')).toBe(keys.size);
        expect(playback.current).toMatchObject({ playing: false, brought: 'r1' });
        expect(playback.current.moved).toBe(moved);
        expect(sounding()).toBe(0);
    });

    it('is struck through once when the strength moves under it, however far the notes then are', async () => {
        const playback = mount(described);
        act(() => playback.current.bring('r1'));
        await settled();
        const before = playback.current.moved!;
        runTo(3);
        act(() => playback.current.setStrength(1.9));
        await settled();

        // The tempo brought out more strongly has the two bars' last notes far from where they were.
        const apart = own(described).map((note) => Math.abs(playback.current.moved!.get(note.id)!.ms - before.get(note.id)!.ms));
        expect(Math.max(...apart)).toBeGreaterThan(300);
        expect(rig.played).toHaveLength(1);
        expect(rig.splices).toHaveLength(1);

        runTo(30);
        expect(new Set(rig.heard).size).toBe(rig.heard.length);
        for (const note of own(described)) expect(rig.heard).toContain(note.id);
        expect(playback.current.playing).toBe(false);
        expect(sounding()).toBe(0);
    });
});
