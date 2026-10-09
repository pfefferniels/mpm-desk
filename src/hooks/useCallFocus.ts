import {
    useCallback,
    useEffect,
    useEffectEvent,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';
import { correspondingDesks } from '../desks/DeskSwitch';
import { TRANSFORMER_ALIASES } from '../desks/transformerAliases';
import { isScope } from '../fitting/instructions/index';
import type { Call } from '../model/Work';
import { useLatest } from './useLatest';

interface UseCallFocusParams {
    calls: readonly Call[];
    /** Open a desk, by the name it shows. */
    selectDesk: (desk: string) => void;
    setScope: (scope: 'global' | number) => void;
}

interface CallFocus {
    activeCallIds: Set<string>;
    setActiveCallIds: Dispatch<SetStateAction<Set<string>>>;
    /** Switch to the desk that made a call, put the scope on it, and name it in the hash. */
    focusCall: (id: string) => void;
    /** Select the call the URL's hash names, if one of these is it. */
    selectCallInHash: (calls: readonly Call[]) => void;
}

/**
 * Which calls are selected, kept in step with the URL's hash.
 *
 * A call is named in the hash by the first eight characters of its id, so a link into a
 * reconstruction can point at one call.
 */
export const useCallFocus = ({ calls, selectDesk, setScope }: UseCallFocusParams): CallFocus => {
    const [activeCallIds, setActiveCallIds] = useState<Set<string>>(new Set());

    const callsRef = useLatest(calls);

    const focusCall = useCallback(
        (id: string) => {
            const call = callsRef.current.find((entry) => entry.id === id);
            if (!call) return;

            const name = TRANSFORMER_ALIASES.get(call.name) ?? call.name;
            const entry = correspondingDesks.find(
                ({ transformerName }) => transformerName === name,
            );
            if (entry) selectDesk(entry.displayName ?? entry.aspect);

            const { scope } = call.options;
            if (isScope(scope)) setScope(scope);

            const prefix = call.id.slice(0, 8);
            if (window.location.hash.slice(1) !== prefix)
                window.history.pushState(null, '', '#' + prefix);

            setActiveCallIds(new Set([id]));
        },
        [callsRef, selectDesk, setScope],
    );

    const selectCallInHash = useCallback((candidates: readonly Call[]) => {
        const hash = window.location.hash.slice(1);
        const match = hash ? candidates.find((call) => call.id.startsWith(hash)) : undefined;
        if (match) setActiveCallIds(new Set([match.id]));
    }, []);

    const onHashChange = useEffectEvent(() => {
        const hash = window.location.hash.slice(1);
        if (!hash) {
            if (activeCallIds.size > 0) {
                setActiveCallIds(new Set());
                window.history.replaceState(
                    null,
                    '',
                    window.location.pathname + window.location.search,
                );
            }
            return;
        }
        if (activeCallIds.size === 1) {
            const [only] = activeCallIds;
            if (only.startsWith(hash)) return;
        }
        const match = calls.find((call) => call.id.startsWith(hash));
        if (match) setActiveCallIds(new Set([match.id]));
    });

    useEffect(() => {
        window.addEventListener('hashchange', onHashChange);
        return () => {
            window.removeEventListener('hashchange', onHashChange);
        };
    }, []);

    return { activeCallIds, setActiveCallIds, focusCall, selectCallInHash };
};
