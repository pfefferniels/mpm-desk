/**
 * The reader's own API key, kept in the reader's browser and nowhere else: not in the work
 * document, which is shared, and not in anything that is logged.
 */
import { useSyncExternalStore } from 'react';

const STORED_AS = 'mpm-desk.expert-key';

/**
 * The key as last read or set; `undefined` until it is first asked for. Where the browser keeps
 * nothing, in a private window or with site data blocked, this is what holds it for the visit.
 */
let held: string | null | undefined;
const listeners = new Set<() => void>();

const read = (): string | null => {
    if (held === undefined) {
        try {
            held = localStorage.getItem(STORED_AS)?.trim() || null;
        } catch {
            held = null;
        }
    }
    return held;
};

const keep = (key: string | null) => {
    held = key?.trim() || null;
    try {
        if (held === null) localStorage.removeItem(STORED_AS);
        else localStorage.setItem(STORED_AS, held);
    } catch {
        // Kept for the visit, then.
    }
    for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

/** The key, and how it is set or, with `null`, forgotten. */
export const useExpertKey = (): [string | null, (key: string | null) => void] => [
    useSyncExternalStore(subscribe, read),
    keep,
];
