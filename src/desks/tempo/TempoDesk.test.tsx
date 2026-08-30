import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Alignment, type AlignedNote } from '../../fitting/alignment';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { NotesProvider } from '../../hooks/NotesProvider';
import { ScrollSyncProvider } from '../../hooks/ScrollSyncProvider';
import { ZoomContext } from '../../hooks/ZoomProvider';
import { createMpm } from '../../fitting/instructions/index';
import { deriveResidual } from '../../fitting/residual';
import type { Scope } from '../../fitting/instructions/index';
import type { SecondaryData } from '../TransformerViewProps';
import { TempoDesk } from './TempoDesk';

/** The skyline hovers a box to audition it, and Tone in jsdom is a slow way to assert nothing. */
vi.mock('react-pianosound', () => ({
    usePiano: () => ({ play: vi.fn(), stop: vi.fn() }),
}));

const note = (id: string, date: number, part: number, seconds: number): AlignedNote => ({
    'xml:id': id,
    part,
    staff: String(part),
    layer: '1',
    date,
    duration: 720,
    pitchname: 'c',
    accidentals: 0,
    octave: 4,
    'milliseconds.date': seconds * 1000,
    'milliseconds.date.end': seconds * 1000 + 500,
    'midi.pitch': 60,
    velocity: 64,
});

/**
 * Two parts that do not play alike: part one on every quarter, part two on every half.
 *
 * Part two's dates are a subset of part one's, so a desk that ignores the scope draws part one's
 * boxes under either choice — which is the whole subject of this file.
 */
const alignment = () =>
    new Alignment([
        note('a1', 0, 1, 0),
        note('a2', 720, 1, 0.5),
        note('a3', 1440, 1, 1),
        note('a4', 2160, 1, 1.5),
        note('b1', 0, 2, 0),
        note('b2', 1440, 2, 1),
    ]);

const mount = (part: Scope, secondary: SecondaryData = {}) => {
    const msm = alignment();
    const mpm = createMpm();
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
                            <TempoDesk
                                part={part}
                                msm={msm}
                                mpm={mpm}
                                residual={deriveResidual(msm, mpm)}
                                projected={[]}
                                performanceXml=""
                                secondary={secondary}
                                setSecondary={vi.fn()}
                                addTransformer={vi.fn()}
                            />
                        </DeskToolbarProvider>
                    </CallSelectionProvider>
                </ScrollSyncProvider>
            </NotesProvider>
        </ZoomContext>,
    );

    const boxes = [...document.querySelectorAll('polygon.box')].map((box) => ({
        start: Number(box.getAttribute('data-start')),
        length: Number(box.getAttribute('data-length')),
    }));

    unmount();
    bar.remove();
    return boxes.sort((a, b) => a.start - b.start);
};

describe('the skyline follows the scope', () => {
    it('seeds its boxes from the selected part alone', () => {
        expect(mount(0)).toEqual([
            { start: 0, length: 720 },
            { start: 720, length: 720 },
            { start: 1440, length: 720 },
            { start: 2160, length: 720 },
        ]);

        // Two boxes, not one: the last chord of a part is bounded by its own longest note
        // rather than by a next onset, which is `extractTempoSegments`'s closing case.
        expect(mount(1)).toEqual([
            { start: 0, length: 1440 },
            { start: 1440, length: 720 },
        ]);
    });

    it('does not hand a part the boxes a pre-scope file stored', () => {
        // The shape `latest/work.json` carries: one undivided bag, written when every edit was
        // made under Global. Before this it was preferred over the seed in every scope, so the
        // picker changed the skyline not at all.
        const stored: SecondaryData = {
            tempo: { tempoCluster: [{ date: { start: 0, end: 2880 }, selected: false, silent: false }] },
        };

        expect(mount('global', stored)).toEqual([{ start: 0, length: 2880 }]);
        expect(mount(1, stored)).toEqual([
            { start: 0, length: 1440 },
            { start: 1440, length: 720 },
        ]);
    });
});
