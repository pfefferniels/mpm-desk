import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PartsLegend } from './PartsLegend';
import type { LegendPart } from './legendParts';

/**
 * The legend as the viewer has it.
 *
 * The voices desk itself engraves the score with verovio, which is the slow half of mounting it
 * and has nothing to do with what the viewer withholds. Everything the viewer withholds there that
 * is not a toolbar button is here: renaming a part, picking one, and picking a voice out of one.
 */

const parts: LegendPart[] = [
    {
        number: 1,
        name: 'melody',
        voices: [{ staff: '1', layer: '1', key: '1/1', notes: 12, part: 1 }],
    },
    {
        number: 2,
        name: '',
        voices: [
            { staff: '1', layer: '2', key: '1/2', notes: 30, part: 2 },
            { staff: '2', layer: '1', key: '2/1', notes: 40, part: 2 },
        ],
    },
];

const mount = (editable: boolean) => {
    const handlers = {
        onSelect: vi.fn(),
        onSelectVoice: vi.fn(),
        onRename: vi.fn(),
        onIsolate: vi.fn(),
    };
    render(
        <PartsLegend
            parts={parts}
            selected={new Set()}
            selectedVoice={undefined}
            editable={editable}
            {...handlers}
        />,
    );
    return handlers;
};

describe('the parts legend in the viewer', () => {
    it('names the parts as text, and lists their voices as labels rather than buttons', () => {
        mount(false);

        expect(screen.queryByRole('textbox')).toBeNull();
        expect(screen.queryAllByRole('button')).toHaveLength(0);
        expect(screen.getByText('melody')).toBeInTheDocument();
        // An unnamed part reads as the placeholder the editor's field shows.
        expect(screen.getByText('Part 2')).toBeInTheDocument();
        expect(screen.getByText('S2/V1')).toBeInTheDocument();
    });

    it('picks nothing on a click, and still fades the other parts on a hover', () => {
        const { onSelect, onSelectVoice, onIsolate } = mount(false);

        fireEvent.click(screen.getByText('melody'));
        fireEvent.click(screen.getByText('S1/V2'));
        fireEvent.mouseEnter(screen.getByText('Part 2'));

        expect(onSelect).not.toHaveBeenCalled();
        expect(onSelectVoice).not.toHaveBeenCalled();
        expect(onIsolate).toHaveBeenCalledWith(2);
    });

    it('is a form in the editor', () => {
        const { onSelect } = mount(true);

        expect(screen.getAllByRole('textbox')).toHaveLength(2);
        expect(screen.getAllByRole('button', { name: /^Voice / })).toHaveLength(3);
        fireEvent.click(screen.getByLabelText('Name of part 1').closest('div')!.parentElement!);
        expect(onSelect).toHaveBeenCalled();
    });
});
