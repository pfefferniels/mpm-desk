import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Where a desk's own controls go.
 *
 * The node itself, not a ref to it. Every desk used to portal into `appBarRef?.current ??
 * document.body`, which reads a ref during render: on the commit where the app bar and the desk
 * first render together the ref is still null, so the desk's controls mounted into the document
 * body and only moved to the bar on some later render. The bar's node arrives here through a
 * callback ref held in state instead, so by the time a desk reads it it is either the real bar or
 * honestly nothing.
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
 *     <Ribbon title='Mode'>…</Ribbon>
 * </DeskToolbar>
 * ```
 *
 * Renders nothing at all where there is no bar, which is what the old `appBarRef && …` guard was
 * for. A desk no longer needs `appBarRef` in its props, nor to import `react-dom`.
 */
export const DeskToolbar = ({ children }: { children: ReactNode }) => {
    const target = useContext(DeskToolbarContext);
    if (!target) return null;
    return createPortal(children, target);
};
