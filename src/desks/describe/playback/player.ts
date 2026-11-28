/**
 * The describe desk's transport: the roll played from its line, as recorded or as the MPM
 * renders it, and a remark's passage played brought out.
 *
 * Everything it plays is on the recording's clock, so the line is one number whatever is heard,
 * and other notes can be handed to the piano under it without the place being lost.
 *
 * It is no part of React. The hook hands it what the desk has after every render, and draws what
 * it shows; the line it keeps apart, for the one thing that follows it.
 *
 * The Desk has one piano, which the app bar's transport plays as well. Whoever plays last has it:
 * this one notices by the schedule the piano holds that it is no longer its own, and lets go
 * without stopping what the other started.
 */
import { addAbsoluteTime, type Schedule } from 'react-pianosound';
import type { BroughtOut, DescriptionRun } from '../../../fitting/description/client';
import { midiFileOf } from '../../../performance/buildMidiFile';
import { whenSamplesArrive, type Piano } from '../../../performance/piano';
import { indexNoteIds, pickAnchor } from '../../../utils/anchor';
import { endOf, heardOf, type Heard } from './hearing';
import { renderingOf, type Rendering } from './laying';
import { wroteOf } from './passage';
import type { DescribePlayback, Hearing, PlaybackInput } from './types';

/** How much the instructions a remark did not write are damped while its own are brought out. */
const DAMPED = 0.35;
const [WEAKEST, STRONGEST] = [1, 1.9];

/** How long the transport runs on after the last sound of the roll. */
const TAIL_MS = 600;
/** Play pressed with less than this left of the roll begins at the top. */
const NEARLY_OVER_MS = 200;

/**
 * How far the piano's transport is ahead of what is heard: it reports how far it has dispatched,
 * which Tone keeps a tenth of a second ahead of the sound.
 */
const AHEAD_MS = 100;
/** How far past what is dispatched other notes are glued in: anything later has not been sent. */
const SEAM_S = 0.02;

type Shown = Pick<
    DescribePlayback,
    'playing' | 'pending' | 'hearing' | 'brought' | 'strength' | 'moved'
>;
type Controls = Pick<
    DescribePlayback,
    'setHearing' | 'toggle' | 'stop' | 'seek' | 'bring' | 'setStrength' | 'line'
>;

/** What the piano is playing. */
interface Flight {
    /** The ms of the recording the piano's file begins on, and the ms the playing ends on. */
    from: number;
    until: number;
    schedule: Schedule;
}

interface Player {
    controls: Controls;
    subscribe: (listener: () => void) => () => void;
    shown: () => Shown;
    /** What the desk has now. A run that is another than the last one is a document edited. */
    update: (input: PlaybackInput, piano: Piano) => void;
    /** Stops, and drops whatever is still to come. The player can be used again. */
    dispose: () => void;
}

export const createPlayer = (): Player => {
    let input: PlaybackInput | null = null;
    let piano: Piano | null = null;

    let shown: Shown = {
        playing: false,
        pending: false,
        hearing: 'played',
        brought: null,
        strength: 1.5,
        moved: null,
    };
    const watching = new Set<() => void>();
    const show = (change: Partial<Shown>) => {
        const next = { ...shown, ...change };
        if ((Object.keys(next) as (keyof Shown)[]).every((key) => next[key] === shown[key])) return;
        shown = next;
        watching.forEach((listener) => listener());
    };

    /** Where the line stands while nothing plays, and where it is. */
    let parked = 0;
    let line = 0;
    const following = new Set<() => void>();
    const end = () => (input?.run ? endOf(input.run.roll) : 0);
    const draw = (ms: number) => {
        const at = Math.max(ms, 0);
        if (at === line) return;
        line = at;
        following.forEach((listener) => listener());
    };

    let flight: Flight | null = null;
    /** Whether what plays, or waits to, is a remark's passage: that leaves the line parked. */
    let ofRemark = false;
    let frame = 0;
    /** Cancels a press that is waiting for the samples. */
    let waiting: (() => void) | null = null;

    /** The remark brought out as it was rendered last, and whether it is to be played once it is. */
    let rendering: Rendering | null = null;
    let toPlay = false;
    /** How many renderings have been asked for, and whether one is being made. */
    let asked = 0;
    let making = false;
    /** The MPM of one run as it stands, on the renderer's clock: what `lay` reads the roll's laying off. */
    let asItStands: { run: DescriptionRun; rendering: Promise<BroughtOut> } | null = null;

    const position = ({ from, schedule }: Flight) =>
        from + ((piano?.getTransportSeconds() ?? 0) - schedule.offset) * 1000 - AHEAD_MS;

    /** The flight is over. The line goes back to where it is parked: at `at`, if it was the roll that played. */
    const land = (at: number) => {
        cancelAnimationFrame(frame);
        if (flight && !ofRemark) parked = at;
        flight = null;
        draw(parked);
        show({ playing: false });
    };

    /** Stops what plays, and drops a press still waiting to. The line stays where it was heard last. */
    const halt = () => {
        waiting?.();
        waiting = null;
        show({ pending: false });
        if (!flight) return;
        // A piano someone else has started since is theirs.
        if (piano?.getSchedule() === flight.schedule) piano.stop();
        land(line);
    };

    const follow = () => {
        if (!flight || !piano) return;
        if (piano.getSchedule() !== flight.schedule) {
            land(line);
            return;
        }
        const at = position(flight);
        if (at >= flight.until) {
            piano.stop();
            land(0);
            return;
        }
        // The roll's last sound is left to die away, and the line waits for it at the end.
        draw(Math.max(ofRemark ? at : Math.min(at, end()), flight.from));
        frame = requestAnimationFrame(follow);
    };

    /**
     * Plays a stretch, now or once the samples are here.
     *
     * @param again what to do when the samples have come: the press as it would be made then.
     */
    const fly = (
        heard: Heard,
        from: number,
        until: number,
        forRemark: boolean,
        again: () => void,
    ) => {
        halt();
        ofRemark = forRemark;
        const file = midiFileOf(heard.notes, heard.pedals, { fromMs: from, toMs: until });
        // Whatever else was sounding is damped first: `play` takes the transport, not the keys.
        input?.silence?.();
        piano?.stop();
        const schedule = piano?.play(file);
        if (schedule) {
            flight = { from, until, schedule };
            show({ playing: true });
            frame = requestAnimationFrame(follow);
            return;
        }
        const cancel = whenSamplesArrive((arrived) => {
            // The piano that arrived is the one to play on; the one held here refused.
            piano = arrived;
            waiting = null;
            show({ pending: false });
            again();
        });
        if (!cancel) return;
        waiting = cancel;
        show({ pending: true });
    };

    /**
     * Hands the piano other notes for what is in flight, without stopping it: what is sounding is
     * neither damped nor struck again.
     *
     * Two hearings of the roll are one clock, and are glued where the line is. Two renderings of
     * a remark are not: a tempo brought out more strongly has every note elsewhere. They are glued
     * at the next note both have, so that none is struck twice or passed over, and the line goes
     * to where the new one has that note.
     */
    const swap = (heard: Heard, until: number, seam: 'line' | 'note', again: () => void) => {
        if (!flight || !piano || piano.getSchedule() !== flight.schedule) return;
        const { from, schedule } = flight;
        const events = addAbsoluteTime(
            midiFileOf(heard.notes, heard.pedals, { fromMs: from, toMs: until }),
        );
        const at = Math.max(piano.getTransportSeconds() + SEAM_S, schedule.from);
        const anchor =
            seam === 'note'
                ? pickAnchor(schedule, indexNoteIds(events), at)
                : { fileMs: (at - schedule.offset) * 1000, transportSeconds: at };
        // Past the last note the two have in common, what is playing is left to play out.
        if (!anchor) return;
        const glued = piano.canSplice && piano.splice({ events, anchor });
        if (glued && glued.ok) {
            flight = { from, until, schedule: glued.schedule };
            return;
        }
        // A piano that cannot be glued into, as a hardware output: begun again where it is.
        fly(heard, Math.max(position(flight), from), until, ofRemark, again);
    };

    const playRoll = () => {
        const roll = input?.run?.roll;
        if (!roll) return;
        const until = endOf(roll) + TAIL_MS;
        if (flight && !ofRemark) {
            swap(heardOf(roll, shown.hearing), until, 'line', playRoll);
            return;
        }
        halt();
        if (parked >= endOf(roll) - NEARLY_OVER_MS) parked = 0;
        draw(parked);
        fly(heardOf(roll, shown.hearing), parked, until, false, playRoll);
    };

    const playPassage = () => {
        if (rendering) fly(rendering.heard, rendering.from, rendering.until, true, playPassage);
    };

    /** Puts every note back, and stops the passage that was played for them. */
    const letGo = () => {
        asked += 1;
        toPlay = false;
        rendering = null;
        if (ofRemark) halt();
        show({ brought: null, moved: null });
    };

    const plainly = (run: DescriptionRun, { client }: PlaybackInput) => {
        if (asItStands?.run !== run) {
            asItStands = { run, rendering: client.bringOut(run, [], 1, 1) };
        }
        return asItStands.rendering;
    };

    /** The remark brought out, rendered against the run as it stands; null where it cannot be played. */
    const make = async (): Promise<Rendering | null> => {
        const now = input;
        const remark = now?.run?.remarks.find((report) => report.id === shown.brought);
        const place = remark && now?.places.get(remark.id);
        if (!now?.run || !remark || !place) return null;
        const wrote = wroteOf(remark);
        const { run } = now;
        const brought =
            wrote.elements.length === 0
                ? null
                : await Promise.all([
                      plainly(run, now),
                      now.client.bringOut(run, wrote.elements, shown.strength, DAMPED),
                  ]).then(
                      ([plain, out]) => ({ plain, out }),
                      // A rendering that could not be made: the passage is played as it stands.
                      () => null,
                  );
        const from = parked >= endOf(run.roll) - NEARLY_OVER_MS ? 0 : parked;
        return renderingOf(run.roll, place, wrote, from, brought);
    };

    /**
     * Renders the remark brought out, and shows it. One rendering is made at a time, and of those
     * asked for while one is made only the newest is: the others would be shown for no longer
     * than it takes to make the next.
     */
    const render = async () => {
        asked += 1;
        if (making) return;
        making = true;
        try {
            for (;;) {
                const mine = asked;
                const made = await make();
                if (mine !== asked) continue;
                if (shown.brought === null) return;
                rendering = made;
                show({ moved: made?.moved ?? null });
                if (!made) {
                    if (ofRemark) halt();
                } else if (toPlay) playPassage();
                else if (flight && ofRemark) swap(made.heard, made.until, 'note', playPassage);
                toPlay = false;
                return;
            }
        } finally {
            making = false;
        }
    };

    const known = (id: string) =>
        Boolean(input?.run?.remarks.some((remark) => remark.id === id) && input.places.has(id));

    const controls: Controls = {
        setHearing: (hearing: Hearing) => {
            if (hearing === shown.hearing) return;
            show({ hearing });
            if (flight && !ofRemark) playRoll();
        },
        toggle: () => {
            const sounding = shown.playing || shown.pending;
            letGo();
            if (sounding) halt();
            else playRoll();
        },
        stop: halt,
        seek: (ms) => {
            const onward = !ofRemark && (flight !== null || waiting !== null);
            halt();
            parked = Math.min(Math.max(ms, 0), end());
            draw(parked);
            if (onward) playRoll();
        },
        bring: (id) => {
            if (id === null || !known(id)) {
                letGo();
                return;
            }
            toPlay = true;
            show({ brought: id });
            void render();
        },
        setStrength: (value) => {
            const strength = Math.min(Math.max(value, WEAKEST), STRONGEST);
            if (strength === shown.strength) return;
            show({ strength });
            if (shown.brought !== null) void render();
        },
        line: {
            subscribe: (listener) => {
                following.add(listener);
                return () => following.delete(listener);
            },
            read: () => line,
        },
    };

    return {
        controls,
        subscribe: (listener) => {
            watching.add(listener);
            return () => watching.delete(listener);
        },
        shown: () => shown,
        update: (next, nextPiano) => {
            const before = input?.run ?? null;
            input = next;
            piano = nextPiano;
            if (next.run === before) return;
            if (!next.run) {
                letGo();
                halt();
            }
            parked = Math.min(parked, end());
            if (!flight) draw(parked);
            else if (!ofRemark) playRoll();
            if (shown.brought === null) return;
            if (known(shown.brought)) void render();
            else letGo();
        },
        dispose: () => {
            letGo();
            halt();
        },
    };
};
