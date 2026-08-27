/**
 * What the app bar's second row assumes about the nodes desks portal into it.
 *
 * `ToolGroup` draws its separator as a left border on itself, skipped when it is the first
 * child. That is only correct if the groups really are direct, ordered siblings in the target's
 * DOM — which is a claim about `createPortal`, not about React's tree, and therefore worth
 * asserting rather than reasoning about.
 */
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, useState, type ReactNode } from 'react';
import { DeskToolbar, DeskToolbarProvider } from './DeskToolbar';
import { ToolGroup } from './toolbar/ToolGroup';

const mount = (target: HTMLElement | null, children: ReactNode) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<DeskToolbarProvider target={target}>{children}</DeskToolbarProvider>);
    });
    return { container, root };
};

describe('DeskToolbar', () => {
    it('lands its groups as direct, ordered children of the target', () => {
        const target = document.createElement('div');
        document.body.appendChild(target);

        mount(
            target,
            <DeskToolbar>
                <ToolGroup label='Mode'>
                    <button>Draw</button>
                </ToolGroup>
                <ToolGroup label='Document'>
                    <button>Translate</button>
                </ToolGroup>
            </DeskToolbar>,
        );

        expect(target.children).toHaveLength(2);
        expect(target.children[0].textContent).toContain('Draw');
        expect(target.children[1].textContent).toContain('Translate');
    });

    it('leaves no node behind for a group that renders nothing, and re-inserts it in place', () => {
        const target = document.createElement('div');
        document.body.appendChild(target);

        // The accentuation and dynamics desks both do exactly this: a group whose controls are
        // all behind one condition. The question the border rule rests on is not whether the
        // group disappears — `ToolGroup` settles that — but whether React puts it *back* before
        // its sibling rather than after it. Among children that all arrived through a portal
        // there is no tracked sibling to insert before, so this is not obvious.
        let show: (value: boolean) => void = () => {};

        const Desk = () => {
            const [visible, setVisible] = useState(false);
            show = setVisible;
            return (
                <DeskToolbar>
                    <ToolGroup label='Mode'>{visible && <button>Modify</button>}</ToolGroup>
                    <ToolGroup label='Document'>
                        <button>Translate</button>
                    </ToolGroup>
                </DeskToolbar>
            );
        };

        mount(target, <Desk />);

        expect(target.children).toHaveLength(1);
        expect(target.firstChild?.textContent).toContain('Translate');

        act(() => {
            show(true);
        });

        expect(target.children).toHaveLength(2);
        expect(target.children[0].textContent).toContain('Modify');
        expect(target.children[1].textContent).toContain('Translate');
    });

    it('renders nothing where there is no bar to portal into', () => {
        // The viewer's tree, and every desk test that mounts without a provider.
        const { container } = mount(
            null,
            <DeskToolbar>
                <ToolGroup label='Mode'>
                    <button>Draw</button>
                </ToolGroup>
            </DeskToolbar>,
        );

        expect(container).toBeEmptyDOMElement();
    });
});
