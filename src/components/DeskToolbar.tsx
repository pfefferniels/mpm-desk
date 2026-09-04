import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Where a desk's own controls go.
 *
 * The node itself rather than a ref to it. Portalling into `appBarRef?.current ?? document.body`
 * reads a ref during render: on the commit where the app bar and the desk first render together
 * it is still null, so a desk's controls mount into the document body and move to the bar on some
 * later render. The bar's node arrives here through a callback ref held in state, so by the time
 * a desk reads it it is either the real bar or honestly nothing.
 */
const DeskToolbarContext = createContext<HTMLElement | null>(null);

/**
 * Publishes the app bar as the target for `DeskToolbar`.
 *
 * `target` is null wherever there is no bar to portal into — the viewer tree — and a desk under a
 * null target simply renders no toolbar.
 */
export const DeskToolbarProvider = ({
    target,
    children,
}: {
    target: HTMLElement | null;
    children: ReactNode;
}) => <DeskToolbarContext value={target}>{children}</DeskToolbarContext>;

/**
 * A desk's controls, in the shared app bar.
 *
 * ```tsx
 * <DeskToolbar>
 *     <ToolGroup label='Mode'>…</ToolGroup>
 * </DeskToolbar>
 * ```
 *
 * The target is the app bar's second row, and it holds nothing but groups — see the note beside
 * `deskRow` in `App.tsx` for why anything else put there lands in the wrong place, and
 * `ToolGroup` for what its separator rule assumes about its siblings.
 *
 * Renders nothing at all where there is no bar, which is what the old `appBarRef && …` guard was
 * for. A desk no longer needs `appBarRef` in its props, nor to import `react-dom`.
 */
export const DeskToolbar = ({ children }: { children: ReactNode }) => {
    const target = useContext(DeskToolbarContext);
    if (!target) return null;
    return createPortal(children, target);
};
