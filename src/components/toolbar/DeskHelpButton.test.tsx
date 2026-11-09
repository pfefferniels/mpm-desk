/**
 * The help a desk gives, which in the viewer leaves out the gestures the viewer does not offer.
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

    it('is the summary alone where every gesture edits', () => {
        open(false, { summary: help.summary, actions: [help.actions![1]] });
        expect(screen.getByText(help.summary)).toBeInTheDocument();
        expect(screen.queryByText('Drag in Draw mode')).not.toBeInTheDocument();
    });
});
