import { useCallback, useLayoutEffect, useRef } from "react";
import { useLatest } from "../hooks/useLatest";

/** Everything pinned to a tick sits at that tick, unsheared by the viewBox's X scale. */
function place(node: SVGGraphicsElement, tick: number, stretchX: number) {
    node.setAttribute("transform", `translate(${tick}, 0) scale(${1 / stretchX}, 1)`);
}

/**
 * Slides everything that is pinned to a tick as the zoom changes, without React.
 *
 * A zoom step moves all 128 branch feet and every bar number, which is one
 * transform each. The browser rewrites and re-lays-out that many curved words
 * inside a single frame — measured at a steady 60fps — but only just: setting
 * type along a curve is what fills the frame, and the few milliseconds React
 * spends reconciling the same 128 labels are enough to push the whole step past
 * the next refresh and halve the rate.
 *
 * So zoom is kept out of their props altogether and written straight to the DOM
 * here, the way scroll already is in `ScrollSyncProvider`. What is anchored then
 * re-renders only when something about *it* changes.
 *
 * Returns a ref callback per tick, kept for the life of the component: handing a
 * fresh function to a memo'd child every render would defeat the point.
 */
export function useTickAnchors(stretchX: number) {
    const anchored = useRef(new Map<SVGGraphicsElement, number>());
    const refs = useRef(new Map<number, (node: SVGGraphicsElement | null) => void>());
    const stretchXRef = useLatest(stretchX);

    const anchorRef = useCallback((tick: number) => {
        const known = refs.current.get(tick);
        if (known) return known;
        const ref = (node: SVGGraphicsElement | null) => {
            if (node) {
                anchored.current.set(node, tick);
                place(node, tick, stretchXRef.current);
            } else {
                // React reports the departure, not who departed — so sweep out
                // whatever has since left the document.
                for (const gone of anchored.current.keys()) {
                    if (!gone.isConnected) anchored.current.delete(gone);
                }
            }
        };
        refs.current.set(tick, ref);
        return ref;
    }, [stretchXRef]);

    useLayoutEffect(() => {
        for (const [node, tick] of anchored.current) place(node, tick, stretchX);
    }, [stretchX]);

    return anchorRef;
}
