/**
 * The grace notes desk in the editor and in the viewer: a table of groups, Insert in the editor
 * only, and the groups a selected call was fitted to marked in both.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Alignment, type AlignedGrace, type AlignedNote } from '../../fitting/alignment';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { EditingContext } from '../../hooks/Editing';
import type { CallOutcome } from '../../fitting/fit';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { createMpm } from '../../fitting/instructions/index';
import type { Residual } from '../../fitting/residual';
import { GraceNotesDesk } from './GraceNotesDesk';

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

const grace = (id: string, group: string, principal: string, date: number): AlignedGrace => ({
    'xml:id': id,
    group,
    principal,
    tied: false,
    part: 1,
    date,
    slot: 0,
    'midi.pitch': 62,
    velocity: 50,
    'milliseconds.date': date - 100,
    'milliseconds.date.end': date - 20,
});

/** Two groups, each decorating a principal of its own. */
const alignment = () => {
    const msm = new Alignment([note('p1', 720), note('p2', 1440)]);
    msm.graces = [grace('g1', 'grp1', 'p1', 720), grace('g2', 'grp2', 'p2', 1440)];
    return msm;
};

interface MountOptions {
    editable?: boolean;
    selected?: { ids: string[]; outcomes: CallOutcome[] };
}

const mount = ({ editable = true, selected }: MountOptions = {}) => {
    const addTransformer = vi.fn();
    const bar = document.createElement('div');
    document.body.appendChild(bar);

    const view = render(
        <EditingContext value={editable}>
            <CallSelectionProvider
                calls={[]}
                outcomes={selected?.outcomes ?? []}
                activeCallIds={new Set(selected?.ids ?? [])}
                setActiveCallIds={vi.fn()}
                onRemoveCalls={vi.fn()}
                focusCall={vi.fn()}
            >
                <DeskToolbarProvider target={bar}>
                    <GraceNotesDesk
                        part='global'
                        msm={alignment()}
                        mpm={createMpm()}
                        residual={{} as Residual}
                        performanceXml=''
                        secondary={{}}
                        setSecondary={vi.fn()}
                        addTransformer={addTransformer}
                    />
                </DeskToolbarProvider>
            </CallSelectionProvider>
        </EditingContext>,
    );
    return { ...view, bar, addTransformer };
};

const rowOf = (group: string) => screen.getByText(group).closest('tr')!;

describe('the grace notes desk', () => {
    it('writes the group clicked, in the editor', () => {
        const { bar, addTransformer } = mount();
        fireEvent.click(rowOf('grp2'));
        fireEvent.click(bar.querySelector('button[aria-label="Insert"]') ?? screen.getByText('Insert'));
        expect(addTransformer).toHaveBeenCalledTimes(1);
    });

    it('offers nothing that writes in the viewer, and a click writes nothing', () => {
        const { bar, addTransformer } = mount({ editable: false });
        expect(bar.textContent).toBe('');
        fireEvent.click(rowOf('grp2'));
        expect(addTransformer).not.toHaveBeenCalled();
    });

    it('marks the groups the selected call was fitted to, and no others', () => {
        for (const editable of [true, false]) {
            const { unmount } = mount({
                editable,
                selected: {
                    ids: ['grace call'],
                    outcomes: [
                        {
                            id: 'grace call',
                            elements: [],
                            range: { from: 1440, to: null },
                            evidence: ['g2', 'p2'],
                        },
                    ],
                },
            });
            expect(rowOf('grp2')).toHaveAttribute('data-evidence');
            expect(rowOf('grp1')).not.toHaveAttribute('data-evidence');
            unmount();
        }
    });

    it('marks nothing while nothing is selected', () => {
        const { container } = mount();
        expect(container.querySelectorAll('[data-evidence]')).toHaveLength(0);
    });
});
