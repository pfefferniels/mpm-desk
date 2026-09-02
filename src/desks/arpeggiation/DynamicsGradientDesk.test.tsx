import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { convertMeiToMsm } from 'espressivo';
import { Alignment } from '../../fitting/alignment';
import { asMSM } from '../../fitting/asMSM';
import {
    InsertDynamicsGradient,
    rampVelocities,
} from '../../fitting/transformers/ornamentation/InsertDynamicsGradient';
import { wasSounded } from '../noteTiming';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { NotesProvider } from '../../hooks/NotesProvider';
import { ScrollSyncProvider } from '../../hooks/ScrollSyncProvider';
import { ZoomContext } from '../../hooks/ZoomProvider';
import { createMpm } from '../../fitting/instructions/index';
import type { Scope } from '../../fitting/instructions/index';
import { deriveResidual } from '../../fitting/residual';
import { DynamicsGradientDesk } from './DynamicsGradientDesk';

/** Hovering a chord sounds it, and Tone in jsdom is a slow way to assert nothing. */
vi.mock('react-pianosound', () => ({
    usePiano: () => ({ play: vi.fn(), stop: vi.fn() }),
}));

/**
 * The shipped transcription on one reading, as in `ArticulationDesk.test.tsx` — `asMSM` makes a
 * note per `<when>`, and a desk only ever sees a score `MakeChoice` has run over.
 */
let msm: Alignment;

beforeAll(() => {
    const mei = readFileSync('public/transcription.mei', 'utf-8');
    const takes = asMSM(mei, convertMeiToMsm(mei)[0]!.msm);
    const [preferred] = takes.sources();
    msm = new Alignment(
        takes.allNotes.filter((note) => note.source === preferred),
        takes.timeSignatures,
    );
});

const renderDesk = (part: Scope) => {
    const bar = document.createElement('div');
    document.body.appendChild(bar);

    const mpm = createMpm();
    const addTransformer = vi.fn<(transformer: InsertDynamicsGradient) => void>();
    const { unmount } = render(
        <ZoomContext
            value={{ symbolic: { stretchX: 0.1 }, physical: { stretchX: 20 }, setStretchX: vi.fn() }}
        >
            <NotesProvider notes={msm.allNotes}>
                <ScrollSyncProvider
                    symbolicZoom={0.1}
                    physicalZoom={20}
                    tickToSeconds={(tick) => tick / 1440}
                    secondsToTick={(seconds) => seconds * 1440}
                >
                    <CallSelectionProvider
                        calls={[]}
                        outcomes={[]}
                        activeCallIds={new Set()}
                        setActiveCallIds={vi.fn()}
                        onRemoveCalls={vi.fn()}
                        focusCall={vi.fn()}
                    >
                        <DeskToolbarProvider target={bar}>
                            <DynamicsGradientDesk
                                part={part}
                                msm={msm}
                                mpm={mpm}
                                residual={deriveResidual(msm, mpm)}
                                projected={[]}
                                performanceXml=""
                                secondary={{}}
                                setSecondary={vi.fn()}
                                addTransformer={addTransformer}
                            />
                        </DeskToolbarProvider>
                    </CallSelectionProvider>
                </ScrollSyncProvider>
            </NotesProvider>
        </ZoomContext>,
    );

    return {
        /** One group per chord whose ramp is still to be drawn, which with an empty MPM is all of them. */
        chords: () => document.querySelectorAll('svg g[data-date]'),
        /** The hull, one quadrilateral joining each chord to the next. */
        hull: () => document.querySelectorAll('svg polygon'),
        /** The calls the plot's handles wrote. */
        addTransformer,
        dispose: () => {
            unmount();
            bar.remove();
        },
    };
};

describe('what the dynamics gradient desk plots', () => {
    it('draws the chords of the scope on the picker, and no others', () => {
        const inScope = (part: Scope) => {
            const desk = renderDesk(part);
            const counts = { chords: desk.chords().length, hull: desk.hull().length };
            desk.dispose();
            return counts;
        };

        // The two parts together hold more chords than the score does, because 100 of the 215
        // carry notes from both. Drawn globally, either part would draw all 215.
        expect(msm.in('global').chords()).toHaveProperty('size', 215);
        expect(msm.in(0).chords()).toHaveProperty('size', 183);
        expect(msm.in(1).chords()).toHaveProperty('size', 132);

        // The hull joins consecutive chords, so it is one short of them wherever the two agree.
        // Where they did not, the ramps drawn were the extremes of chords the hull never covered.
        expect(inScope('global')).toEqual({ chords: 215, hull: 214 });
        expect(inScope(0)).toEqual({ chords: 183, hull: 182 });
        expect(inScope(1)).toEqual({ chords: 132, hull: 131 });
    });
});

/**
 * Both handles commit the velocity the pointer is on as the chord's standard, and what they hand
 * the transformer is a ramp in the units a `<dynamicsGradient>` takes. The line used to send the
 * two extremes' onsets, in seconds, as that ramp (issue #29), and the circle sent a pair read off
 * the band from soft to loud whichever way the chord actually rolled.
 */
describe('what a click on a chord commits', () => {
    /**
     * A chord every note of which the recording sounded and whose ramp, the velocities sorted,
     * runs the given way. The shipped transcription rolls both ways.
     */
    const chordRunning = (upwards: boolean) => {
        for (const [date, notes] of msm.in('global').chords()) {
            if (notes.length < 2 || !notes.every(wasSounded)) continue;
            const ramp = rampVelocities(notes, true);
            const first = ramp[0]!;
            const last = ramp[ramp.length - 1]!;
            if (upwards ? first < last : first > last) return { date, first, last };
        }
        throw new Error(`no chord rolls ${upwards ? 'up' : 'down'}`);
    };

    /**
     * Click one of a chord's handles with the pointer this far down its band: 0 on the loudest
     * note along the top edge, 1 on the softest along the bottom. jsdom lays nothing out, so the
     * band is given its height by hand.
     */
    const click = (date: number, handle: 'line' | 'circle', down: number) => {
        const group = document.querySelector(`svg g[data-date="${String(date)}"]`)!;
        const rect = group.querySelector('rect')!;
        rect.getBoundingClientRect = () => ({ top: 0, height: 100 }) as DOMRect;
        const clientY = 100 * down;
        if (handle === 'circle') fireEvent.mouseMove(rect, { clientY });
        fireEvent.click(group.querySelector(handle)!, { clientY });
    };

    const committed = (desk: ReturnType<typeof renderDesk>, date: number) => {
        expect(desk.addTransformer).toHaveBeenCalledTimes(1);
        const [transformer] = desk.addTransformer.mock.calls[0]!;
        const options = transformer.options;
        if (!('gradient' in options)) throw new Error('the click wrote a default, not a chord');
        expect(options.scope).toBe('global');
        expect(options.date).toBe(date);
        return options.gradient;
    };

    /** The velocity the transformer will leave every note of the chord at, given this ramp. */
    const standardOf = (gradient: { from: number; to: number }, first: number, last: number) =>
        first - gradient.from * ((last - first) / (gradient.to - gradient.from));

    it.each([
        ['a crescendo has the loudest note at the end of its ramp', true, { from: -1, to: 0 }],
        ['a chord rolled loud to soft has it at the start, and is not mirrored', false, { from: 0, to: 1 }],
    ])('%s', (_, upwards, expected) => {
        const { date, first, last } = chordRunning(upwards);
        const desk = renderDesk('global');
        click(date, 'line', 0);

        const gradient = committed(desk, date);
        expect(gradient).toEqual(expected);
        expect(standardOf(gradient, first, last)).toBeCloseTo(Math.max(first, last));
        desk.dispose();
    });

    it('the circle commits the same choice as the line', () => {
        const { date } = chordRunning(true);
        const desk = renderDesk('global');
        click(date, 'circle', 0);

        expect(committed(desk, date)).toEqual({ from: -1, to: 0 });
        desk.dispose();
    });

    it('the standard follows the pointer down the band', () => {
        const { date, first, last } = chordRunning(true);
        const desk = renderDesk('global');
        click(date, 'line', 0.5);

        const gradient = committed(desk, date);
        expect(gradient).toEqual({ from: -0.5, to: 0.5 });
        expect(standardOf(gradient, first, last)).toBeCloseTo((first + last) / 2);
        desk.dispose();
    });
});
