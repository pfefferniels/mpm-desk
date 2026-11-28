/**
 * Hearing the describe desk's roll: what the piano is handed and when, where the line is, and
 * what the notes are moved to while a remark is brought out.
 *
 * Against the two bars of `fixture.ts`, a client whose renderings are answered by hand, and the
 * rig of `test/fakePiano`, whose transport only moves when it is told to. Nothing here is heard:
 * what is checked is what was scheduled, for when, and how loud.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MidiFile } from 'midifile-ts';
import { addAbsoluteTime } from 'react-pianosound';
import type {
    BroughtOut,
    DescriptionClient,
    DescriptionRun,
} from '../../../fitting/description/client';
import { midiFileOf } from '../../../performance/buildMidiFile';
import { createFakePiano } from '../../../test/fakePiano';
import { aRun, performed, places } from './fixture';
import { useDescribePlayback } from './index';
import type { PlaybackInput } from './types';

let rig = createFakePiano();
type RigPiano = ReturnType<typeof rig.usePiano>;

/** Whether the samples are still coming, and the presses waiting for them; see `performance/piano`. */
const samples = { loading: false, waiting: new Set<(piano: RigPiano) => void>() };

vi.mock('../../../performance/piano', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../performance/piano')>()),
    usePiano: () =>
        samples.loading
            ? { ...rig.usePiano(), status: 'loading', play: () => null }
            : rig.usePiano(),
    whenSamplesArrive: (start: (piano: RigPiano) => void) => {
        if (!samples.loading) return null;
        samples.waiting.add(start);
        return () => {
            samples.waiting.delete(start);
        };
    },
}));

const samplesArrive = () =>
    act(() => {
        samples.loading = false;
        const starts = [...samples.waiting];
        samples.waiting.clear();
        for (const start of starts) start(rig.usePiano());
    });

/** A rendering the client was asked for, and has not answered until the test does. */
interface Ask {
    run: Pick<DescriptionRun, 'mpm' | 'score'>;
    ids: readonly string[];
    factor: number;
    attenuation: number;
    settle: (out: BroughtOut | null) => void;
    answered: boolean;
}
let asks: Ask[] = [];

const client: DescriptionClient = {
    describe: () => new Promise(() => undefined),
    bringOut: (run, ids, factor, attenuation) =>
        new Promise((resolve, reject) => {
            asks.push({
                run,
                ids,
                factor,
                attenuation,
                answered: false,
                settle: (out) => (out ? resolve(out) : reject(new Error('refused'))),
            });
        }),
    dispose: () => undefined,
};

const settled = async () => {
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
};

/**
 * Answers the renderings named, or every one still open: the MPM as it stands where nothing was
 * to be brought out, and as many times slower as the factor asked for where something was.
 */
const answer = (...which: Ask[]) =>
    act(async () => {
        for (const ask of which.length ? which : asks.filter((open) => !open.answered)) {
            ask.answered = true;
            ask.settle(performed(ask.run as DescriptionRun, ask.ids.length ? ask.factor : 1));
        }
        await settled();
    });

const mount = (given: Partial<PlaybackInput> = {}) => {
    let input: PlaybackInput = { run: aRun(), places: places(), client, ...given };
    const hook = renderHook(() => useDescribePlayback(input));
    return {
        playback: hook.result,
        set: (next: Partial<PlaybackInput>) => {
            input = { ...input, ...next };
            act(() => hook.rerender());
        },
        unmount: hook.unmount,
    };
};

/** Lets the piano's transport run on to `seconds`, and a frame pass for the line to follow. */
const runTo = (seconds: number) =>
    act(() => {
        rig.transport.advanceTo(seconds);
        vi.advanceTimersByTime(20);
    });

const events = (file: MidiFile) => addAbsoluteTime(file);
/** The keys a file strikes, in order: `ms pitch velocity`. */
const keys = (file: MidiFile) =>
    events(file).flatMap((event) =>
        event.type === 'channel' && event.subtype === 'noteOn'
            ? [`${event.abs} ${event.noteNumber} ${event.velocity}`]
            : [],
    );
/** The moves of the sustaining pedal in a file: `ms value`. */
const pedal = (file: MidiFile) =>
    events(file).flatMap((event) =>
        event.type === 'channel' && event.subtype === 'controller' && event.controllerType === 64
            ? [`${event.abs} ${event.value}`]
            : [],
    );
/** The keys the piano was sent after `second` of its transport: `second pitch`. */
const struckAfter = (second: number) =>
    rig.piano.actions.flatMap(({ type, time, midi }) =>
        type === 'keyDown' && time > second ? [`${time.toFixed(2)} ${midi}`] : [],
    );

beforeEach(() => {
    vi.useFakeTimers();
    rig = createFakePiano();
    samples.loading = false;
    samples.waiting.clear();
    asks = [];
});

afterEach(() => {
    vi.useRealTimers();
});

describe('playing the roll from the line', () => {
    it('plays the recording as it was played, to the end', () => {
        const { playback } = mount();
        act(() => playback.current.toggle());

        expect(playback.current.playing).toBe(true);
        expect(rig.played).toHaveLength(1);
        expect(keys(rig.played[0])).toHaveLength(11);
        expect(keys(rig.played[0]).slice(0, 3)).toEqual(['30 60 70', '30 36 70', '530 61 70']);
        expect(keys(rig.played[0])).toContain('1950 59 40');
        expect(pedal(rig.played[0])).toEqual(['0 127', '1800 0']);
    });

    it('moves the line with what is heard, a tenth of a second behind what the piano has been sent', () => {
        const { playback } = mount();
        act(() => playback.current.toggle());
        expect(playback.current.line.read()).toBe(0);

        runTo(1);
        expect(playback.current.line.read()).toBe(900);
        runTo(2.5);
        expect(playback.current.line.read()).toBe(2400);
    });

    it('stops, and leaves the line where it was heard last', () => {
        const { playback } = mount();
        act(() => playback.current.toggle());
        runTo(1);
        act(() => playback.current.toggle());

        expect(playback.current.playing).toBe(false);
        expect(rig.transport.state).toBe('stopped');
        expect(rig.piano.held.size + rig.piano.sustained.size).toBe(0);
        expect(playback.current.line.read()).toBe(900);
    });

    it('goes on from the line, the pedal where it stood there', () => {
        const { playback } = mount();
        act(() => playback.current.toggle());
        runTo(1);
        act(() => playback.current.stop());
        act(() => playback.current.toggle());

        expect(rig.played).toHaveLength(2);
        expect(keys(rig.played[1])[0]).toBe('130 62 70');
        expect(keys(rig.played[1])).toHaveLength(8);
        expect(pedal(rig.played[1])).toEqual(['0 127', '900 0']);
    });

    it('stops by itself when the roll has been heard through, and puts the line back at the top', () => {
        const { playback } = mount();
        act(() => playback.current.toggle());
        runTo(4.6);
        expect(playback.current.playing).toBe(true);
        expect(playback.current.line.read()).toBe(4000);

        runTo(4.8);
        expect(playback.current.playing).toBe(false);
        expect(rig.transport.state).toBe('stopped');
        expect(playback.current.line.read()).toBe(0);
    });

    it('begins at the top where next to nothing is left', () => {
        const { playback } = mount();
        act(() => playback.current.seek(3900));
        act(() => playback.current.toggle());
        expect(keys(rig.played[0])[0]).toBe('30 60 70');
        expect(playback.current.line.read()).toBe(0);
    });

    it('plays nothing before a run is in', () => {
        const { playback } = mount({ run: null });
        act(() => playback.current.toggle());
        act(() => playback.current.bring('tempo'));
        expect(rig.played).toHaveLength(0);
        expect(playback.current).toMatchObject({ playing: false, brought: null });
    });
});

describe('putting the line somewhere', () => {
    it('parks it there, inside the roll', () => {
        const { playback } = mount();
        act(() => playback.current.seek(1234));
        expect(playback.current.line.read()).toBe(1234);
        expect(rig.played).toHaveLength(0);

        act(() => playback.current.seek(-5));
        expect(playback.current.line.read()).toBe(0);
        act(() => playback.current.seek(99_999));
        expect(playback.current.line.read()).toBe(4000);
    });

    it('goes on playing from there', () => {
        const { playback } = mount();
        act(() => playback.current.toggle());
        runTo(0.5);
        act(() => playback.current.seek(2000));

        expect(playback.current.playing).toBe(true);
        expect(rig.played).toHaveLength(2);
        expect(keys(rig.played[1]).slice(0, 2)).toEqual(['30 64 70', '30 43 70']);
        expect(playback.current.line.read()).toBe(2000);
        runTo(0.5);
        expect(playback.current.line.read()).toBe(2400);
    });
});

describe('what is heard', () => {
    it("is the MPM's rendering once that is chosen: no grace note, and the pedal as the MPM moves it", () => {
        const { playback } = mount();
        act(() => playback.current.setHearing('rendered'));
        act(() => playback.current.toggle());

        expect(playback.current.hearing).toBe('rendered');
        expect(keys(rig.played[0])).toHaveLength(10);
        expect(keys(rig.played[0]).slice(0, 3)).toEqual(['0 60 60', '0 36 60', '500 61 60']);
        expect(pedal(rig.played[0])).toEqual(['0 127', '1900 0']);
    });

    it('changes under the line while it plays: nothing is begun again, and nothing sounding is damped', () => {
        const { playback } = mount();
        act(() => playback.current.toggle());
        runTo(1.25);
        const sounding = rig.piano.held.size + rig.piano.sustained.size;
        expect(sounding).toBeGreaterThan(0);

        act(() => playback.current.setHearing('rendered'));
        expect(rig.played).toHaveLength(1);
        expect(rig.splices).toEqual([{ at: 1.27, released: [], attacked: [] }]);
        expect(rig.piano.held.size + rig.piano.sustained.size).toBe(sounding);
        expect(playback.current.playing).toBe(true);
        expect(playback.current.line.read()).toBe(1150);

        // From the seam on the keys come when the MPM has them, 30 ms before they were played.
        runTo(2.75);
        expect(struckAfter(1.27)).toEqual(['1.50 63', '2.00 64', '2.00 43', '2.50 65']);
        expect(playback.current.line.read()).toBe(2650);
    });

    it('is begun again where the line is on a piano that cannot be glued into', () => {
        rig = createFakePiano({ canSplice: false });
        const { playback } = mount();
        act(() => playback.current.toggle());
        runTo(1.25);
        act(() => playback.current.setHearing('rendered'));

        expect(rig.played).toHaveLength(2);
        expect(keys(rig.played[1])[0]).toBe('350 63 60');
        expect(playback.current.playing).toBe(true);
        expect(playback.current.line.read()).toBe(1150);
    });
});

describe('a press made while the samples are still coming', () => {
    beforeEach(() => {
        samples.loading = true;
    });

    it('waits for them, and starts by itself', () => {
        const { playback } = mount();
        act(() => playback.current.toggle());
        expect(playback.current).toMatchObject({ playing: false, pending: true });
        expect(rig.played).toHaveLength(0);

        samplesArrive();
        expect(playback.current).toMatchObject({ playing: true, pending: false });
        expect(rig.played).toHaveLength(1);
    });

    it('is dropped by another press, by stop, and by the desk going away', () => {
        const { playback, unmount } = mount();
        act(() => playback.current.toggle());
        act(() => playback.current.toggle());
        expect(playback.current.pending).toBe(false);
        act(() => playback.current.toggle());
        act(() => playback.current.stop());
        expect(playback.current.pending).toBe(false);
        act(() => playback.current.toggle());
        unmount();

        samplesArrive();
        expect(rig.played).toHaveLength(0);
    });

    it('starts as it would be made when they are here', () => {
        const { playback } = mount();
        act(() => playback.current.toggle());
        act(() => playback.current.setHearing('rendered'));
        act(() => playback.current.seek(1200));
        expect(playback.current.pending).toBe(true);

        samplesArrive();
        expect(rig.played).toHaveLength(1);
        expect(keys(rig.played[0])[0]).toBe('300 63 60');
    });

    it('holds a remark too', async () => {
        const { playback } = mount();
        act(() => playback.current.bring('tempo'));
        await answer();
        expect(playback.current).toMatchObject({ playing: false, pending: true, brought: 'tempo' });
        expect(playback.current.moved).not.toBeNull();

        samplesArrive();
        expect(playback.current).toMatchObject({ playing: true, pending: false });
        expect(keys(rig.played[0])[0]).toBe('40 62 60');
    });
});

describe('bringing a remark out', () => {
    it('asks for the MPM as it stands and with what the remark wrote brought out', () => {
        const { playback } = mount();
        act(() => playback.current.bring('tempo'));

        expect(playback.current.brought).toBe('tempo');
        expect(playback.current.moved).toBeNull();
        expect(asks.map(({ ids, factor, attenuation }) => ({ ids, factor, attenuation }))).toEqual([
            { ids: [], factor: 1, attenuation: 1 },
            { ids: ['tempo_2880'], factor: 1.5, attenuation: 0.35 },
        ]);
        expect(rig.played).toHaveLength(0);
    });

    it('moves the notes to where that rendering has them, and plays its passage with what it takes around it', async () => {
        const { playback } = mount();
        act(() => playback.current.bring('tempo'));
        await answer();

        // Half as slow again from the first chord that is played, which stays.
        const { moved } = playback.current;
        expect(moved!.get('r2')).toEqual({ ms: 1000, msEnd: 1675, velocity: 60 });
        expect(moved!.get('r4')).toEqual({ ms: 2500, msEnd: 3175, velocity: 60 });
        // Only what is struck in the passage: not what came before it, nor the note held into it.
        expect([...moved!.keys()]).toEqual(['r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'l1']);

        expect(playback.current.playing).toBe(true);
        expect(rig.played).toHaveLength(1);
        // From 40 ms before that chord; the whole note held under it is struck with it, softer.
        expect(keys(rig.played[0])).toEqual([
            '40 62 60',
            '40 36 42',
            '790 63 60',
            '1540 64 60',
            '1540 43 60',
            '2290 65 60',
            '3040 66 60',
            '3790 67 60',
        ]);
        expect(pedal(rig.played[0])).toEqual(['0 127', '790 0']);
    });

    it('shows the line where the passage is, and puts it back where it was parked', async () => {
        const { playback } = mount();
        act(() => playback.current.seek(300));
        act(() => playback.current.bring('tempo'));
        await answer();
        runTo(1);
        expect(playback.current.line.read()).toBe(1860);

        // The passage ends at 5750 ms of the recording, 4790 ms into what the piano was handed.
        runTo(4.88);
        expect(playback.current.playing).toBe(true);
        runTo(4.9);
        expect(playback.current.playing).toBe(false);
        expect(rig.transport.state).toBe('stopped');
        expect(playback.current.line.read()).toBe(300);
    });

    it('keeps the notes moved when the passage has played, until it is let go', async () => {
        const { playback } = mount();
        act(() => playback.current.bring('tempo'));
        await answer();
        runTo(5);
        expect(playback.current).toMatchObject({ playing: false, brought: 'tempo' });
        expect(playback.current.moved).not.toBeNull();

        act(() => playback.current.bring(null));
        expect(playback.current).toMatchObject({ brought: null, moved: null });
    });

    it('stops and puts every note back when it is let go while it plays', async () => {
        const { playback } = mount();
        act(() => playback.current.bring('tempo'));
        await answer();
        runTo(1);
        act(() => playback.current.bring(null));

        expect(playback.current).toMatchObject({ playing: false, brought: null, moved: null });
        expect(rig.transport.state).toBe('stopped');
    });

    it('takes over from the roll, whose line stays where it was heard last', async () => {
        const { playback } = mount();
        act(() => playback.current.toggle());
        runTo(1);
        act(() => playback.current.bring('tempo'));
        expect(rig.played).toHaveLength(1);
        await answer();

        expect(rig.played).toHaveLength(2);
        expect(playback.current.playing).toBe(true);
        runTo(5);
        expect(playback.current.line.read()).toBe(900);
    });

    it('is let go by play: pressed while the passage sounds it stops, pressed after it plays the roll', async () => {
        const { playback } = mount();
        act(() => playback.current.bring('tempo'));
        await answer();
        act(() => playback.current.toggle());
        expect(playback.current).toMatchObject({ playing: false, brought: null, moved: null });

        act(() => playback.current.bring('tempo'));
        await answer();
        runTo(5);
        act(() => playback.current.toggle());
        expect(playback.current).toMatchObject({ playing: true, brought: null, moved: null });
        expect(keys(rig.played.at(-1)!)).toHaveLength(11);
    });

    it('stays brought out when the sound is stopped, or the line put elsewhere', async () => {
        const { playback } = mount();
        act(() => playback.current.bring('tempo'));
        await answer();
        act(() => playback.current.stop());
        expect(playback.current).toMatchObject({ playing: false, brought: 'tempo' });
        expect(playback.current.moved).not.toBeNull();

        act(() => playback.current.bring('tempo'));
        await answer();
        expect(playback.current.playing).toBe(true);
        act(() => playback.current.seek(2000));
        expect(playback.current).toMatchObject({ playing: false, brought: 'tempo' });
        expect(playback.current.line.read()).toBe(2000);
        expect(rig.played).toHaveLength(2);
    });

    it('plays again when it is brought out again', async () => {
        const { playback } = mount();
        act(() => playback.current.bring('tempo'));
        await answer();
        runTo(5);
        act(() => playback.current.bring('tempo'));
        await answer();

        expect(rig.played).toHaveLength(2);
        expect(keys(rig.played[1])).toEqual(keys(rig.played[0]));
        // The MPM as it stands is rendered once for a run.
        expect(asks.map((ask) => ask.ids.length)).toEqual([0, 1, 1]);
    });

    it('is whatever the hearing: changing that leaves the passage alone', async () => {
        const { playback } = mount();
        act(() => playback.current.bring('tempo'));
        await answer();
        runTo(1);
        act(() => playback.current.setHearing('rendered'));

        expect(playback.current.hearing).toBe('rendered');
        expect(rig.played).toHaveLength(1);
        expect(rig.splices).toHaveLength(0);
    });

    it('plays a remark on the whole piece from the line', async () => {
        const { playback } = mount();
        act(() => playback.current.seek(1200));
        act(() => playback.current.bring('whole'));
        expect(asks[1].ids).toEqual(['dynamics_0']);
        await answer(asks[0]);
        await act(async () => {
            asks[1].settle(performed(aRun(), 1, 12));
            await settled();
        });

        expect(playback.current.moved!.get('r0')).toEqual({ ms: 0, msEnd: 450, velocity: 72 });
        expect(keys(rig.played[0])).toEqual([
            '40 63 72',
            '540 64 72',
            '540 43 72',
            '1040 65 72',
            '1540 66 72',
            '2040 67 72',
        ]);
    });

    it('lets go of a remark the run does not hold', async () => {
        const { playback } = mount();
        act(() => playback.current.bring('tempo'));
        await answer();
        act(() => playback.current.bring('unheard-of'));

        expect(playback.current).toMatchObject({ playing: false, brought: null, moved: null });
    });
});

describe('a remark that wrote nothing', () => {
    it('plays its passage as the MPM has it, and moves no note', async () => {
        const { playback } = mount();
        act(() => playback.current.bring('quiet'));
        await act(settled);

        expect(asks).toHaveLength(0);
        expect(playback.current).toMatchObject({ playing: true, brought: 'quiet', moved: null });
        // The left hand held back under the single note the remark is about.
        expect(keys(rig.played[0])).toEqual(['40 61 60', '40 36 23', '540 62 60', '1040 63 60']);
    });

    it('puts the notes of the remark before it back', async () => {
        const { playback } = mount();
        act(() => playback.current.bring('tempo'));
        await answer();
        act(() => playback.current.bring('quiet'));
        await act(settled);

        expect(playback.current).toMatchObject({ playing: true, brought: 'quiet', moved: null });
        expect(rig.played).toHaveLength(2);
    });

    it('is what a remark is played as whose rendering could not be made', async () => {
        const { playback } = mount();
        act(() => playback.current.bring('tempo'));
        await act(async () => {
            asks[0].settle(performed(aRun()));
            asks[1].settle(null);
            await settled();
        });

        expect(playback.current).toMatchObject({ playing: true, brought: 'tempo', moved: null });
        expect(keys(rig.played[0])[0]).toBe('40 62 60');
        expect(keys(rig.played[0])[2]).toBe('540 63 60');
    });
});

describe('moving the strength', () => {
    it('keeps to 1 and 1.9, and renders nothing while nothing is brought out', () => {
        const { playback } = mount();
        act(() => playback.current.setStrength(5));
        expect(playback.current.strength).toBe(1.9);
        act(() => playback.current.setStrength(0));
        expect(playback.current.strength).toBe(1);
        expect(asks).toHaveLength(0);
    });

    it('moves the notes of the remark brought out, and plays nothing once its passage is over', async () => {
        const { playback } = mount();
        act(() => playback.current.bring('tempo'));
        await answer();
        runTo(5);
        act(() => playback.current.setStrength(1.9));
        expect(playback.current.strength).toBe(1.9);
        expect(playback.current.moved!.get('r4')!.ms).toBe(2500);
        await answer();

        expect(asks.at(-1)).toMatchObject({ ids: ['tempo_2880'], factor: 1.9, attenuation: 0.35 });
        expect(playback.current.moved!.get('r4')!.ms).toBeCloseTo(2900, 6);
        expect(playback.current.playing).toBe(false);
        expect(rig.played).toHaveLength(1);
    });

    it('counts only the newest of the renderings asked for in a row', async () => {
        const { playback } = mount();
        act(() => playback.current.bring('tempo'));
        await answer();
        const before = playback.current.moved;

        act(() => playback.current.setStrength(1.2));
        act(() => playback.current.setStrength(1.7));
        act(() => playback.current.setStrength(1.9));
        // One is made at a time: the second was overtaken before it was asked for.
        expect(asks.map((ask) => ask.factor)).toEqual([1, 1.5, 1.2]);

        await answer();
        expect(playback.current.moved).toBe(before);
        expect(asks.map((ask) => ask.factor)).toEqual([1, 1.5, 1.2, 1.9]);

        await answer();
        expect(playback.current.moved!.get('r4')!.ms).toBeCloseTo(2900, 6);
        expect(asks).toHaveLength(4);
    });

    it('lands nothing once the remark has been let go', async () => {
        const { playback } = mount();
        act(() => playback.current.bring('tempo'));
        act(() => playback.current.bring(null));
        await answer();
        expect(playback.current).toMatchObject({ playing: false, brought: null, moved: null });

        act(() => playback.current.bring('tempo'));
        await answer();
        act(() => playback.current.setStrength(1.2));
        act(() => playback.current.bring(null));
        await answer();
        expect(playback.current).toMatchObject({ playing: false, brought: null, moved: null });
        expect(rig.played).toHaveLength(1);
    });

    it('lands the remark asked for last, of two asked for in a row', async () => {
        const { playback } = mount();
        act(() => playback.current.bring('tempo'));
        act(() => playback.current.bring('quiet'));
        await answer();

        expect(playback.current).toMatchObject({ playing: true, brought: 'quiet', moved: null });
        expect(rig.played).toHaveLength(1);
        expect(keys(rig.played[0])[0]).toBe('40 61 60');
    });

    it('keeps the passage playing, glued at the next note to where the new rendering has it', async () => {
        const { playback } = mount();
        act(() => playback.current.bring('tempo'));
        await answer();
        runTo(1);
        expect(playback.current.line.read()).toBe(1860);
        act(() => playback.current.setStrength(1.9));
        await answer();

        expect(rig.played).toHaveLength(1);
        expect(rig.splices).toEqual([{ at: 1.54, released: [], attacked: [] }]);
        expect(playback.current.playing).toBe(true);

        // The second bar comes when it was due, 1.54 s into what the piano was handed, and the
        // line is from then on where the new rendering has it: at 2900 ms of the recording, not
        // 2500. What follows comes at the new rendering's pace.
        runTo(1.5);
        expect(playback.current.line.read()).toBe(2760);
        runTo(2.5);
        expect(struckAfter(1)).toEqual(['1.54 64', '1.54 43', '2.49 65']);
        expect(rig.heard).toEqual(['r2', 'l0', 'r3', 'r4', 'l1', 'r5']);
    });

    it('lets the passage play out where no note is left to glue at', async () => {
        const { playback } = mount();
        act(() => playback.current.bring('tempo'));
        await answer();
        runTo(4);
        act(() => playback.current.setStrength(1.9));
        await answer();

        expect(rig.splices).toHaveLength(0);
        expect(playback.current.playing).toBe(true);
        expect(playback.current.moved!.get('r4')!.ms).toBeCloseTo(2900, 6);
        runTo(5);
        expect(playback.current.playing).toBe(false);
    });
});

describe('the document being edited', () => {
    /** The run after an edit: the right hand's fourth note comes 200 ms later. */
    const edited = (): DescriptionRun => {
        const run = aRun();
        const notes = run.roll.notes.map((note) =>
            note.id === 'r3' ? { ...note, mpm: { ...note.mpm, ms: note.mpm.ms + 200 } } : note,
        );
        return { ...run, roll: { ...run.roll, notes } };
    };

    it('renders the remark brought out again, against the new run', async () => {
        const { playback, set } = mount();
        act(() => playback.current.bring('tempo'));
        await answer();
        const before = playback.current.moved;
        runTo(5);

        const next = edited();
        set({ run: next });
        expect(playback.current.moved).toBe(before);
        expect(asks.slice(2).map((ask) => [ask.run === next, ask.ids.length])).toEqual([
            [true, 0],
            [true, 1],
        ]);

        await answer();
        expect(playback.current.brought).toBe('tempo');
        expect(playback.current.moved).not.toBe(before);
        expect(playback.current.moved!.get('r3')!.ms).toBe(2050);
        expect(rig.played).toHaveLength(1);
    });

    it('lets go of a remark that is gone, and stops its passage', async () => {
        const { playback, set } = mount();
        act(() => playback.current.bring('tempo'));
        await answer();
        runTo(1);

        set({ run: { ...aRun(), remarks: [] } });
        expect(playback.current).toMatchObject({ playing: false, brought: null, moved: null });
        expect(rig.transport.state).toBe('stopped');
    });

    it('hands the piano the new notes under the line while the roll plays', () => {
        const { playback, set } = mount();
        act(() => playback.current.setHearing('rendered'));
        act(() => playback.current.toggle());
        runTo(1.25);

        set({ run: edited() });
        expect(rig.played).toHaveLength(1);
        expect(rig.splices).toHaveLength(1);
        runTo(2.25);
        expect(struckAfter(1.27)).toEqual(['1.70 63', '2.00 64', '2.00 43']);
    });

    it('stops everything when there is no run any more', async () => {
        const { playback, set } = mount();
        act(() => playback.current.bring('tempo'));
        await answer();
        set({ run: null });

        expect(playback.current).toMatchObject({ playing: false, brought: null, moved: null });
        expect(playback.current.line.read()).toBe(0);
    });
});

describe('the one piano of the Desk', () => {
    const elsewhere = midiFileOf([{ id: 'x', pitch: 72, onsetMs: 0, offsetMs: 500, velocity: 64 }]);

    it('is let go of when something else starts playing it, and is not stopped under that', () => {
        const { playback } = mount();
        act(() => playback.current.toggle());
        runTo(1);

        act(() => {
            rig.usePiano().play(elsewhere);
            vi.advanceTimersByTime(20);
        });
        expect(playback.current.playing).toBe(false);
        expect(rig.transport.state).toBe('started');
        expect(playback.current.line.read()).toBe(900);

        // Nor by a stop that comes late.
        act(() => playback.current.stop());
        expect(rig.transport.state).toBe('started');
    });

    it('is not stopped under the other even before a frame has shown that it was taken', () => {
        const { playback } = mount();
        act(() => playback.current.toggle());
        runTo(1);
        act(() => {
            rig.usePiano().play(elsewhere);
        });
        expect(playback.current.playing).toBe(true);

        act(() => playback.current.stop());
        expect(playback.current.playing).toBe(false);
        expect(rig.transport.state).toBe('started');
    });

    it('is seen to have been stopped elsewhere', () => {
        const { playback } = mount();
        act(() => playback.current.toggle());
        runTo(1);
        act(() => {
            rig.usePiano().stop();
            vi.advanceTimersByTime(20);
        });
        expect(playback.current.playing).toBe(false);
    });

    it('is taken from whatever else plays it, which is told first', () => {
        const told: number[] = [];
        const { playback } = mount({ silence: () => told.push(rig.played.length) });
        act(() => {
            rig.usePiano().play(elsewhere);
        });
        act(() => playback.current.toggle());

        expect(told).toEqual([1]);
        expect(rig.played).toHaveLength(2);
        expect(playback.current.playing).toBe(true);
    });
});

describe('what the desk is handed', () => {
    it('keeps its functions, and is the same object from one tick of the line to the next', () => {
        const { playback, set } = mount();
        const first = playback.current;
        const follow = vi.fn();
        const unfollow = first.line.subscribe(follow);

        set({ places: places() });
        expect(playback.current).toBe(first);

        act(() => first.toggle());
        const playing = playback.current;
        expect(playing).not.toBe(first);
        runTo(0.5);
        runTo(1);
        expect(follow).toHaveBeenCalledTimes(2);
        expect(playback.current).toBe(playing);

        for (const control of [
            'setHearing',
            'toggle',
            'stop',
            'seek',
            'bring',
            'setStrength',
            'line',
        ] as const) {
            expect(playback.current[control]).toBe(first[control]);
        }

        unfollow();
        runTo(1.5);
        expect(follow).toHaveBeenCalledTimes(2);
    });
});
