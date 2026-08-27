import { useCallback } from 'react';
import { useScrollSync } from './ScrollSyncProvider';

type ScrollDomain = 'symbolic' | 'physical';

/**
 * Join the scroll sync, as a ref.
 *
 * ```tsx
 * const scrollRef = useScrollRegistration('tempo-desk', 'physical');
 * return <div ref={scrollRef}>…</div>;
 * ```
 *
 * Nine desks each carried the same eight lines of this, differing only in the two arguments.
 * They also predate React 19: a ref callback may now **return its own cleanup**, which is
 * exactly the shape `register`/`unregister` wanted, so the `else` branch that used to stand in
 * for one is gone. React calls the cleanup instead of calling the ref again with `null`.
 *
 * The domain defaults to symbolic for the same reason `ScrollSyncProvider.register` does: a
 * scroller that lives in ticks registers by naming itself and nothing else.
 */
export const useScrollRegistration = (id: string, domain: ScrollDomain = 'symbolic') => {
    const { register, unregister } = useScrollSync();

    return useCallback(
        (element: HTMLElement | null) => {
            if (!element) return;
            register(id, element, domain);
            return () => unregister(id);
        },
        [register, unregister, id, domain],
    );
};
