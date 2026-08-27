import { useMemo } from 'react';
import type { Alignment } from '../../fitting/alignment';
import type { Scope } from '../../fitting/instructions/index';
import type { ModifyOptions } from '../../fitting/transformers/modification/Modify';
import { useCallSelection } from '../../hooks/CallSelection';

/**
 * Which events the chain has already corrected in one aspect, and by how much.
 *
 * Read off the **calls**, not off the alignment: the alignment shows the corrected value and has
 * no memory of what it was before, so the only record that a note was touched by hand is the call
 * that touched it. The options of a `Modify` are plain JSON, so they can be read straight off.
 *
 * Keyed by `xml:id`, which serves notes and pedals alike — a `pedalIDs` call keys by the pedal's.
 *
 * @param pending what has just been sent and is not in `msm` yet. Its delta is **subtracted**:
 * the desk that sent it is already drawing the event at its corrected value, so counting the call
 * as well would draw the ghost on the wrong side until the fit comes back. Desks that only read
 * the ghosts — the dynamics desk — pass nothing.
 */
export const useModifyDeltas = (
    msm: Alignment,
    part: Scope,
    aspect: ModifyOptions['aspect'],
    pending?: ModifyOptions,
): Map<string, number> => {
    const { calls } = useCallSelection();

    return useMemo(() => {
        const deltas = new Map<string, number>();

        const add = (id: string, change: number) => {
            const next = (deltas.get(id) ?? 0) + change;
            if (next === 0) deltas.delete(id);
            else deltas.set(id, next);
        };

        const apply = (options: ModifyOptions, sign: 1 | -1) => {
            if (options.aspect !== aspect) return;
            // A global call reaches every part; a call on some other part reaches none of this
            // desk's events. `scope` predates the field being required, so absent means global.
            if (options.scope !== undefined && options.scope !== 'global' && options.scope !== part)
                return;

            const change = sign * options.change;
            if ('noteIDs' in options) {
                for (const id of options.noteIDs) add(id, change);
            } else if ('pedalIDs' in options) {
                for (const id of options.pedalIDs) add(id, change);
            } else {
                for (const note of msm.notesInRange(options.from, options.to, part))
                    add(note['xml:id'], change);
            }
        };

        for (const call of calls) {
            if (call.name !== 'Modify') continue;
            apply(call.options as unknown as ModifyOptions, 1);
        }

        if (pending) apply(pending, -1);

        return deltas;
    }, [calls, msm, part, aspect, pending]);
};
