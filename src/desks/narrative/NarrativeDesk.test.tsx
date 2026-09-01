/**
 * The narrative desk, heard — over the reconstruction the app ships.
 *
 * Two things the desk does with sound, pinned against the real playback provider on a transport
 * faithful enough to sound the notes in order. Following the playhead lights the rows whose
 * instructions are in effect — the rows the viewer's tree would light, by the same rule. And a
 * chip plays its one instruction: spotlit, and from where that instruction reaches rather than
 * from bar 1.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRoot } from 'react-dom/client';
import { act, useEffect, useState, type ReactNode } from 'react';
import { addAbsoluteTime } from 'react-pianosound';
import type { MidiFile } from 'midifile-ts';
import { createFakePiano } from '../../test/fakePiano';
import { readMeter, readNoteDates } from '../../utils/score';
import { readPerformance } from '../../utils/mpm';
import { indexNoteIds, renderedRange } from '../../utils/anchor';
import { parseMPM } from '../../fitting/instructions/index';
import type { Alignment } from '../../fitting/alignment';
import type { Residual } from '../../fitting/residual';
import { ZoomContext } from '../../hooks/ZoomProvider';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { WorkDocumentProvider } from '../../hooks/WorkDocument';
import { initialHistory } from '../../model/workReducer';
import { PlaybackProvider, usePlayback } from '../../hooks/PlaybackProvider';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { outcomesOf, type Reconstruction } from '../../model/Reconstruction';
import type { Call } from '../../model/Work';
import { elementOwners, segmentsSoundingAt } from '../../segment-stack/sounding';
import { pointSpanFallback, tickRange } from '../../segment-stack/StackModel';
import { NarrativeDesk } from './NarrativeDesk';

// jsdom has no Web Audio graph; the rig underneath is faithful about the two things that
// matter here — notes sound in order, and a seek moves the transport.
let rig = createFakePiano();

vi.mock('react-pianosound', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-pianosound')>()),
    usePiano: () => rig.usePiano(),
}));

const scoreMsm = readFileSync('src/test/fixtures/score.msm', 'utf-8');
const performanceMpm = readFileSync('src/test/fixtures/performance.mpm', 'utf-8');
const dateByNoteId = readNoteDates(scoreMsm);
const meter = readMeter(scoreMsm);
const performance = readPerformance(performanceMpm, meter);
const mpm = parseMPM(performanceMpm);
const { segments: projected } = JSON.parse(
    readFileSync('src/test/fixtures/segments.json', 'utf-8'),
) as Reconstruction;

/** The work file the projection came from, read back off it: one call per span, claimed under its segment. */
const calls: Call[] = projected.flatMap((segment) =>
    segment.spans.map((span) => ({
        id: `call:${span.id}`,
        name: `Insert:${span.type}`,
        options: {},
        elements: [...span.elements],
        range: { from: span.from, to: span.to },
        segment: segment.id,
    })),
);
const segments = projected.map(({ id, note }) => ({ id, ...(note && { note }) }));
const outcomes = outcomesOf(calls);
const owners = elementOwners(projected);

let play: ReturnType<typeof usePlayback>['play'] | null = null;
let stop: ReturnType<typeof usePlayback>['stop'] | null = null;
/** The date of the last note that sounded — what the desk last heard. */
let lastDate: number | null = null;

const Capture = () => {
    const { play: playNow, stop: stopNow, subscribeNoteEvents } = usePlayback();
    useEffect(() => {
        play = playNow;
        stop = stopNow;
    }, [playNow, stopNow]);
    useEffect(
        () =>
            subscribeNoteEvents(({ date }) => {
                lastDate = date;
            }),
        [subscribeNoteEvents],
    );
    return null;
};

const Selection = ({ children }: { children: ReactNode }) => {
    const [activeCallIds, setActiveCallIds] = useState<Set<string>>(new Set());
    return (
        <CallSelectionProvider
            calls={calls}
            outcomes={outcomes}
            activeCallIds={activeCallIds}
            setActiveCallIds={setActiveCallIds}
            onRemoveCalls={() => {}}
            focusCall={() => {}}
        >
            {children}
        </CallSelectionProvider>
    );
};

const mount = async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // The app bar, standing in for `EditorAppBar`'s second row. A sibling of the desk and not a
    // child of it, which is where it really is — so `container` stays a view of the table alone
    // and the two tests below go on asking their questions of it unchanged.
    //
    // Present at all because `DeskToolbar` renders `null` where there is no target: without a
    // provider the desk's New Segment button, filter and counters do not exist in the DOM, and a
    // test of them would be indistinguishable from a test of a desk that had lost them.
    const toolbar = document.createElement('div');
    document.body.appendChild(toolbar);

    const root = createRoot(container);
    await act(async () => {
        root.render(
            <ZoomContext
                value={{
                    symbolic: { stretchX: 20 },
                    physical: { stretchX: 20 },
                    setStretchX: () => {},
                }}
            >
                <PlaybackProvider
                    scoreMsm={scoreMsm}
                    performanceMpm={performanceMpm}
                    dateByNoteId={dateByNoteId}
                >
                    <Capture />
                    <Selection>
                        {/* The desk reads the document off `useWorkDocument` rather than out of
                            its props, so the fixture supplies one. Nothing here dispatches: the
                            two tests below only look and listen. */}
                        <WorkDocumentProvider
                            history={initialHistory({
                                name: '',
                                mei: '',
                                mpm: '',
                                provenance: [...calls],
                                segments: [...segments],
                            })}
                            dispatch={() => {}}
                        >
                            <DeskToolbarProvider target={toolbar}>
                                <NarrativeDesk
                                    msm={
                                        {
                                            principalTimeSignature: {
                                                denominator: meter.denominator,
                                            },
                                        } as unknown as Alignment
                                    }
                                    mpm={mpm}
                                    residual={{} as Residual}
                                    secondary={{}}
                                    setSecondary={() => {}}
                                    projected={projected}
                                    performanceXml={performanceMpm}
                                />
                            </DeskToolbarProvider>
                        </WorkDocumentProvider>
                    </Selection>
                </PlaybackProvider>
            </ZoomContext>,
        );
    });

    /** The rows lit as sounding, by segment id. */
    const lit = () =>
        [...container.querySelectorAll('tr[aria-current="true"]')]
            .map((row) => row.getAttribute('data-segment-id'))
            .sort();

    return {
        container,
        toolbar,
        lit,
        unmount: async () => {
            await act(async () => root.unmount());
            container.remove();
            toolbar.remove();
        },
    };
};

const sounding = () => [...segmentsSoundingAt(performance, lastDate!, owners)].sort();

const velocities = (file: MidiFile) =>
    file.tracks
        .flat()
        .filter((event) => event.type === 'channel' && event.subtype === 'noteOn')
        .map((event) => (event as { velocity: number }).velocity);

describe('the narrative desk, heard', () => {
    beforeEach(() => {
        rig = createFakePiano();
        play = null;
        stop = null;
        lastDate = null;
        // espressivo narrates every conversion to the console.
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('lights the rows whose instructions are sounding, and moves with the playhead', async () => {
        const { lit, unmount } = await mount();
        expect(lit()).toEqual([]);

        act(() => {
            play!({ exaggerate: 1 });
        });
        act(() => {
            rig.transport.advanceTo(10);
        });

        expect(lastDate).not.toBeNull();
        const first = sounding();
        expect(first.length).toBeGreaterThan(0);
        expect(lit()).toEqual(first);

        act(() => {
            rig.transport.advanceTo(60);
        });
        const later = sounding();
        expect(later).not.toEqual(first);
        expect(lit()).toEqual(later);

        // The spotlight goes out with the sound.
        act(() => {
            stop!();
        });
        expect(lit()).toEqual([]);

        await unmount();
    });

    it('plays a clicked chip alone, from where that instruction reaches', async () => {
        vi.useFakeTimers();
        try {
            const { container, lit, unmount } = await mount();

            act(() => {
                play!({ exaggerate: 1 });
            });
            const plain = rig.played[0];

            // A tempo chip, and not the first: the kind whose reach is the stretch to the next
            // of its kind, so the window is neither a point nor the piece — and one that starts
            // somewhere a seek can be told from a start at bar 1.
            const chip = [...container.querySelectorAll('button')].find(
                (button) =>
                    button.title.includes(' · tempo\n') &&
                    (performance.byId(button.title.split(' · ')[0])?.date ?? 0) > 0,
            );
            expect(chip).toBeDefined();
            const id = chip!.title.split(' · ')[0];
            const row = chip!.closest('tr')!;

            act(() => {
                chip!.click();
            });

            // Spotlit: a fresh rendering with the same notes played differently, since
            // everything but this one instruction is damped.
            expect(rig.played.length).toBe(2);
            const spotlit = rig.played[1];
            expect(velocities(spotlit).length).toBe(velocities(plain).length);
            expect(velocities(spotlit)).not.toEqual(velocities(plain));

            // Windowed: the transport was seeked to the instruction's own reach, not bar 1.
            const reach = tickRange(performance.reachOf(performance.byId(id)!), pointSpanFallback(projected));
            expect(reach.to).toBeGreaterThan(reach.from);
            const heard = renderedRange(
                indexNoteIds(addAbsoluteTime(spotlit)),
                dateByNoteId,
                reach.from,
                reach.to,
            );
            expect(heard).not.toBeNull();
            expect(heard!.fromMs).toBeGreaterThan(0);
            expect(rig.transport.seconds).toBeCloseTo(heard!.fromMs / 1000, 2);

            // The row and the chip say so — and the click still selected the call.
            expect(lit()).toEqual([row.getAttribute('data-segment-id')]);
            expect(chip!.getAttribute('data-sounding')).toBe('true');
            expect(chip!.getAttribute('aria-pressed')).toBe('true');

            // The preview stops itself once its stretch is through, and the light goes with it.
            act(() => {
                vi.advanceTimersByTime(120_000);
            });
            expect(lit()).toEqual([]);
            expect(chip!.getAttribute('data-sounding')).toBeNull();

            await unmount();
        } finally {
            vi.useRealTimers();
        }
    });
});
