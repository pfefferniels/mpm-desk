import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolGroup } from './ToolGroup';

describe('ToolGroup', () => {
    it('renders the label and the children', () => {
        render(
            <ToolGroup label='Tempo'>
                <button>Draw</button>
                <button>Split</button>
            </ToolGroup>,
        );

        expect(screen.getByText('Tempo')).toBeInTheDocument();
        expect(screen.getByText('Draw')).toBeInTheDocument();
        expect(screen.getByText('Split')).toBeInTheDocument();
    });

    it('exposes the label as the group’s accessible name', () => {
        render(
            <ToolGroup label='Tempo'>
                <button>Draw</button>
            </ToolGroup>,
        );

        expect(screen.getByRole('group', { name: 'Tempo' })).toBeInTheDocument();
    });

    /**
     * The accentuation desk's regression, and the case worth the most here.
     *
     * Every control in that desk's toolbar is written `{cond && <Button/>}`, so with nothing
     * selected the old `Ribbon` drew an empty labelled box and a vertical rule beside it — a group
     * announcing a heading over no controls at all, which is the state the bar sat in most of the
     * time.
     */
    it('renders nothing when every child is falsy', () => {
        // Read out of state rather than written `false` inline, so the condition is the one a
        // desk actually has — `no-constant-binary-expression` folds a literal away, and folding
        // it away is precisely what this test must not let the compiler do.
        const selected: readonly string[] = [];

        const { container } = render(
            <ToolGroup label='X'>
                {selected.length > 0 && <button>Never</button>}
                {null}
            </ToolGroup>,
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('renders an unlabelled group’s children', () => {
        render(
            <ToolGroup>
                <button>Play</button>
            </ToolGroup>,
        );

        expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
        expect(screen.getByRole('group')).toBeInTheDocument();
    });
});
