/* eslint-disable react-hooks/refs -- deliberate, and the only file that may; see below. */
import { useRef } from "react";

/**
 * A ref that always holds the latest `value`, written during render.
 *
 * The one file allowed to write a ref during render, and the disable at the top is a decision.
 *
 * `react-hooks/refs` is right to forbid this elsewhere: a ref is invisible to the renderer, so a
 * component that writes one during render and *reads* it during render draws from a value React
 * never knew had changed.
 *
 * Nothing here reads the ref during render. The hook writes it and hands it back, and every
 * caller reads `.current` later, from an event handler, an effect, or a getter on a context
 * value, because it needs the *current* value inside a callback whose identity must not change.
 * The rule cannot tell that shape from the dangerous one, both being `ref.current = value` in a
 * render body.
 *
 * Keeping it to one file is the point. `CallSelectionProvider` forces the hatch to exist:
 * everything a desk draws sits under that context, so a callback fresh on every render re-renders
 * the whole desk on every chain edit, and chain edits happen on every gesture. Routing the two
 * dozen call sites through here makes the exception one reviewable file rather than a fresh
 * disable comment scattered across the tree.
 */
export function useLatest<T>(value: T) {
    const ref = useRef(value);
    ref.current = value;
    return ref;
}
