/* eslint-disable react-hooks/refs -- deliberate, and the only file that may; see below. */
import { useRef } from "react";

/**
 * A ref that always holds the latest `value`, written during render.
 *
 * This is the one file in the codebase allowed to write a ref during render. The disable at the
 * top is a decision, not a leftover.
 *
 * `react-hooks/refs` is right to forbid this everywhere else. A ref is invisible to the renderer:
 * write one during render and *read* it during render, and the component is drawing from a value
 * React never knew had changed, so it shows something other than what its state says. That is a
 * real bug and it is why the rule is an error rather than a warning.
 *
 * Nothing here reads the ref during render — the hook writes it and hands it back. Every caller
 * reads `.current` later: from an event handler, from an effect, or from a getter on a context
 * value. They read it there precisely because they need the *current* value inside a callback
 * whose identity must not change. That is the shape the rule cannot tell apart from the dangerous
 * one, because both are `ref.current = value` sitting in a render body.
 *
 * Keeping it to one file is the point. `CallSelectionProvider` is the case that forces the hatch
 * to exist: everything a desk draws sits under that context, so a callback that is fresh on every
 * render re-renders the whole desk on every chain edit, and chain edits happen on every gesture.
 * It reads `calls`, `outcomes` and the active set through these refs so that only `activeCallIds`
 * can re-render a consumer. The two dozen-odd call sites behind this hook all want that same
 * thing, and routing them through here means the exception is one reviewable file — rather than
 * the same two lines and a fresh disable comment scattered across the tree, each one having to be
 * judged on its own by whoever next reads it.
 */
export function useLatest<T>(value: T) {
    const ref = useRef(value);
    ref.current = value;
    return ref;
}
