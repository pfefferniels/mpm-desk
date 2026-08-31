import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { convertMeiToMsm } from 'espressivo';
import { Alignment } from '../../fitting/alignment';
import { asMSM } from '../../fitting/asMSM';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { NotesProvider } from '../../hooks/NotesProvider';
import { ScrollSyncProvider } from '../../hooks/ScrollSyncProvider';
import { ZoomContext } from '../../hooks/ZoomProvider';
import { createMpm, requireMap } from '../../fitting/instructions/index';
import type { Mpm, Scope } from '../../fitting/instructions/index';
import { deriveResidual } from '../../fitting/residual';
import { ArticulationDesk } from './ArticulationDesk';

/** Hovering a note sounds it, and Tone in jsdom is a slow way to assert nothing. */
vi.mock('react-pianosound', () => ({
    usePiano: () => ({ play: vi.fn(), stop: vi.fn() }),
}));

/**
 * The shipped transcription, on one reading: two staves, every note with its recorded onset.
 *
 * One reading because `asMSM` makes a note per `<when>`, so the file as loaded carries each note
 * twice — once per take. `MakeChoice` is what drops the takes that were not preferred, and a desk
 * only ever sees a score it has run over.
 */
let msm: Alignment;

beforeAll(() => {
    const mei = readFileSync('public/transcription.mei', 'utf-8');
    const takes = asMSM(mei, convertMeiToMsm(mei)[0]!.msm);
    const [preferred] = takes.sources();
    msm = new Alignment(
        takes.allNotes.filter((note) => note.source === preferred),
        takes.timeSignature,
    );
});

/** An `<articulation>` in one scope, naming one note — what an overlay is drawn from. */
const articulate = (scope: Scope, note: { 'xml:id': string; date: number }): Mpm => {
    const mpm = createMpm();
    requireMap(mpm, 'articulation', scope).addArticulation({
        date: note.date,
        noteid: `#${note['xml:id']}`,
        nameRef: 'legato',
        id: `articulation_${note['xml:id']}`,
    });
    return mpm;
};

const renderDesk = (part: Scope, mpm: Mpm = createMpm()) => {
    const bar = document.createElement('div');
    document.body.appendChild(bar);

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
                            <ArticulationDesk
                                part={part}
                                msm={msm}
                                mpm={mpm}
                                residual={deriveResidual(msm, mpm)}
                                projected={[]}
                                performanceXml=""
                                secondary={{}}
                                setSecondary={vi.fn()}
                                addTransformer={vi.fn()}
                            />
                        </DeskToolbarProvider>
                    </CallSelectionProvider>
                </ScrollSyncProvider>
            </NotesProvider>
        </ZoomContext>,
    );

    return {
        /** One bar per note plotted. */
        bars: () => document.querySelectorAll('svg rect[data-date]'),
        /** The two release ticks each plotted note gets, recorded and notated. */
        markers: () => document.querySelectorAll('svg line'),
        /** One hull per articulation whose notes are on the plot. */
        overlays: () => document.querySelectorAll('svg polygon'),
        /** Which aspects the unit dialog offers for a unit made of the first plotted note. */
        aspectsOffered: () => {
            fireEvent.click(document.querySelector('svg rect[data-date]')!);
            fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
            const offered = (property: string) =>
                !screen.getByRole<HTMLInputElement>('checkbox', { name: property }).disabled;
            return {
                relativeDuration: offered('relativeDuration'),
                relativeVelocity: offered('relativeVelocity'),
                absoluteDuration: offered('absoluteDuration'),
                absoluteDurationChange: offered('absoluteDurationChange'),
            };
        },
        dispose: () => {
            unmount();
            bar.remove();
        },
    };
};

describe('what the articulation desk plots', () => {
    it('draws the notes of the scope on the picker, and no others', () => {
        const inScope = (part: Scope) => {
            const desk = renderDesk(part);
            const counts = { bars: desk.bars().length, markers: desk.markers().length };
            desk.dispose();
            return counts;
        };

        const notes = { global: 450, first: 260, second: 190 };
        expect(msm.allNotes).toHaveLength(notes.global);
        expect(msm.notesInPart(0)).toHaveLength(notes.first);
        expect(msm.notesInPart(1)).toHaveLength(notes.second);

        // Two release ticks per note: the recorded one solid, the notated one dashed.
        expect(inScope('global')).toEqual({ bars: notes.global, markers: notes.global * 2 });
        expect(inScope(0)).toEqual({ bars: notes.first, markers: notes.first * 2 });
        expect(inScope(1)).toEqual({ bars: notes.second, markers: notes.second * 2 });
    });

    it('hulls an articulation only in the scope whose map holds it', () => {
        const mpm = articulate(0, msm.notesInPart(0)[0]);

        const owning = renderDesk(0, mpm);
        expect(owning.overlays()).toHaveLength(1);
        owning.dispose();

        const other = renderDesk(1, mpm);
        expect(other.overlays()).toHaveLength(0);
        other.dispose();
    });
});

/**
 * Three of the four aspects are measured against the recorded duration on the tick grid, and only
 * a `<tempo>` puts it there. Offered without one they write an `<articulationDef>` stating
 * nothing at all.
 */
describe('what the unit dialog offers', () => {
    it('holds back the tick-borne aspects while no tempo places the notes', () => {
        const desk = renderDesk(0);
        expect(desk.aspectsOffered()).toEqual({
            relativeDuration: false,
            relativeVelocity: true,
            absoluteDuration: false,
            absoluteDurationChange: false,
        });
        desk.dispose();
    });

    it('offers all four once a tempo does', () => {
        const mpm = createMpm();
        requireMap(mpm, 'tempo', 0).addTempo({ date: 0, bpm: 90, beatLength: 0.25, id: 't1' });

        const desk = renderDesk(0, mpm);
        expect(desk.aspectsOffered()).toEqual({
            relativeDuration: true,
            relativeVelocity: true,
            absoluteDuration: true,
            absoluteDurationChange: true,
        });
        desk.dispose();
    });
});
