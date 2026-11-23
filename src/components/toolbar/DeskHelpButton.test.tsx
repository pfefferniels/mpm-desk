/**
 * The help a desk gives, which in the viewer leaves out the gestures the viewer does not offer,
 * and in the editor those the viewer alone offers.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EditingContext } from '../../hooks/Editing';
import type { DeskHelp } from '../../desks/DeskSwitch';
import { DeskHelpButton } from './DeskHelpButton';

const help: DeskHelp = {
    summary: 'The tempo, against the recording.',
    actions: [
        { gesture: 'Hover a box', does: 'sound the passage it covers' },
        { gesture: 'Drag in Draw mode', does: 'draw a tempo curve', edits: true },
    ],
};

const open = (editable: boolean, deskHelp: DeskHelp = help) => {
    render(
        <EditingContext value={editable}>
            <DeskHelpButton deskName='tempo' help={deskHelp} />
        </EditingContext>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'About the tempo desk' }));
};

describe('a desk’s help', () => {
    it('lists every gesture in the editor', () => {
        open(true);
        expect(screen.getByText('Hover a box')).toBeInTheDocument();
        expect(screen.getByText('Drag in Draw mode')).toBeInTheDocument();
    });

    it('lists only the gestures that read in the viewer', () => {
        open(false);
        expect(screen.getByText('Hover a box')).toBeInTheDocument();
        expect(screen.queryByText('Drag in Draw mode')).not.toBeInTheDocument();
    });

    it('says what the viewer alone does with a gesture, there and not in the editor', () => {
        const both: DeskHelp = {
            summary: help.summary,
            actions: [
                { gesture: 'Click a box', does: 'select it alone', edits: true },
                { gesture: 'Click a box', does: 'open Base Text at its notes', viewOnly: true },
            ],
        };

        open(false, both);
        expect(screen.getByText('open Base Text at its notes', { exact: false })).toBeInTheDocument();
        expect(screen.queryByText('select it alone', { exact: false })).not.toBeInTheDocument();
    });

    it('leaves the viewer’s own gestures out of the editor’s', () => {
        open(true, {
            summary: help.summary,
            actions: [{ gesture: 'Click a box', does: 'open Base Text at its notes', viewOnly: true }],
        });
        expect(screen.queryByText('Click a box')).not.toBeInTheDocument();
    });

    it('is the summary alone where every gesture edits', () => {
        open(false, { summary: help.summary, actions: [help.actions![1]] });
        expect(screen.getByText(help.summary)).toBeInTheDocument();
        expect(screen.queryByText('Drag in Draw mode')).not.toBeInTheDocument();
    });
});
