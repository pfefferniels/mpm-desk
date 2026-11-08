import { useMemo } from 'react';
import type { AlignedNote, AlignedPedal, Alignment } from '../../fitting/alignment';
import { isCallOf } from '../../fitting/calls';
import { expansion, inverseExpansion } from '../../fitting/expansion';
import type { Scope } from '../../fitting/instructions/index';
import type { ExpandOptions } from '../../fitting/transformers/modification/Expand';
import type { ModifyOptions } from '../../fitting/transformers/modification/Modify';
import { useCallSelection } from '../../hooks/CallSelection';
import type { Call } from '../../model/Work';

type Aspect = ModifyOptions['aspect'];

/** An event's value in one aspect, as the alignment has it now. */
const valueOf = (event: AlignedNote | AlignedPedal, aspect: Aspect): number =>
    aspect === 'onset'
        ? event['milliseconds.date']
        : aspect === 'duration'
          ? event['milliseconds.date.end'] - event['milliseconds.date']
          : 'velocity' in event
            ? event.velocity
            : NaN;

/** The ids of this desk's events an expansion reaches, read as `Expand` reads its selector. */
const reachOf = (options: ExpandOptions, msm: Alignment, part: Scope): ReadonlySet<string> => {
    if ('noteIDs' in options && options.noteIDs) return new Set(options.noteIDs);
    if ('pedalIDs' in options && options.pedalIDs)
        return new Set(options.aspect === 'velocity' ? [] : options.pedalIDs);
    if ('from' in options && options.from !== undefined && options.to !== undefined)
        return new Set(msm.in(part).notesInRange(options.from, options.to).map((n) => n['xml:id']));

    const ids = new Set(msm.in(part).notes().map((n) => n['xml:id']));
    if (options.aspect !== 'velocity' && (options.scope ?? 'global') === 'global')
        for (const pedal of msm.pedals) ids.add(pedal['xml:id']);
    return ids;
};

/**
 * Which events the chain has already corrected in one aspect, and by how much: by hand
 * (`Modify`) and by an expansion of the scale (`Expand`).
 *
 * Read off the **calls**, not off the alignment: the alignment shows the corrected value and has
 * no memory of what it was before, so the only record that an event was touched is the call that
 * touched it. The options of a `Modify` are plain JSON, so its shift can be read straight off.
 * An `Expand` moves each event by an amount that depends on where it was, so its share is found
 * by running its map backwards from the value the alignment holds: first the shifts by hand are
 * taken off, since they ran after it, then each expansion undone, the last first. An expansion
 * whose map does not rise throughout has no way back, and the event keeps the ghost of its shifts
 * alone.
 *
 * An onset is mapped from the first note's onset, as `Expand` maps it, and that zero moves with
 * the expansion that reaches the first note; both are taken into account. The shifts of the first
 * note by hand are not, as they are not for `Modify` alone either.
 *
 * Keyed by `xml:id`, which serves notes and pedals alike — a `pedalIDs` call keys by the pedal's.
 *
 * @param pending a `Modify` that has just been sent and is not in `msm` yet. Its delta is
 * **subtracted**: the desk that sent it is already drawing the event at its corrected value, so
 * counting the call as well would draw the ghost on the wrong side until the fit comes back.
 * Desks that only read the ghosts — the dynamics desk — pass nothing.
 * @param unfitted the id of an `Expand` that has just been sent and is not in `msm` yet. It is
 * left out until the fit answers: the alignment does not show it, so there is nothing to undo.
 */
const correctionDeltas = (
    calls: readonly Call[],
    msm: Alignment,
    part: Scope,
    aspect: Aspect,
    pending?: ModifyOptions,
    unfitted?: string,
): Map<string, number> => {
    const deltas = new Map<string, number>();

    // A global call reaches every part; a call on some other part reaches none of this desk's
    // events. `scope` predates the field being required, so absent means global.
    const here = (scope: Scope | undefined) => scope === undefined || scope === 'global' || scope === part;

    const add = (id: string, change: number) => {
        const next = (deltas.get(id) ?? 0) + change;
        if (next === 0) deltas.delete(id);
        else deltas.set(id, next);
    };

    const apply = (options: ModifyOptions, sign: 1 | -1) => {
        if (options.aspect !== aspect || !here(options.scope)) return;

        const change = sign * options.change;
        if ('noteIDs' in options) {
            for (const id of options.noteIDs) add(id, change);
        } else if ('pedalIDs' in options) {
            for (const id of options.pedalIDs) add(id, change);
        } else {
            for (const note of msm.in(part).notesInRange(options.from, options.to))
                add(note['xml:id'], change);
        }
    };

    for (const call of calls.filter(isCallOf('Modify'))) apply(call.options, 1);
    if (pending) apply(pending, -1);

    const expansions = calls
        .filter(isCallOf('Expand'))
        .filter((call) => call.id !== unfitted)
        .map((call) => call.options)
        .filter((options) => options.aspect === aspect && here(options.scope));
    if (expansions.length === 0) return deltas;

    const reach = expansions.map((options) => reachOf(options, msm, part));
    /** The expansions that reached an event, in the order they ran. */
    const reaching = (id: string) => expansions.filter((_, k) => reach[k].has(id));

    // Where the first note is now, and how far the expansions that reached it moved it.
    let zero = 0;
    let moved = 0;
    if (aspect === 'onset') {
        const first = msm.allNotes
            .filter((note) => Number.isFinite(note['milliseconds.date']))
            .reduce<AlignedNote | undefined>(
                (earliest, note) =>
                    !earliest || note['milliseconds.date'] < earliest['milliseconds.date'] ? note : earliest,
                undefined,
            );
        if (!first) return deltas;
        zero = first['milliseconds.date'];
        moved = reaching(first['xml:id']).reduce((at, options) => expansion(options.points)?.(at) ?? at, 0);
    }

    const events = new Map<string, AlignedNote | AlignedPedal>();
    for (const note of msm.in(part).notes()) if (!events.has(note['xml:id'])) events.set(note['xml:id'], note);
    if (aspect !== 'velocity') for (const pedal of msm.pedals) events.set(pedal['xml:id'], pedal);

    for (const [id, event] of events) {
        const undo = reaching(id).reverse();
        if (undo.length === 0) continue;
        const now = valueOf(event, aspect);
        if (!Number.isFinite(now)) continue;

        let value = now - (deltas.get(id) ?? 0) - zero + moved;
        let back = true;
        for (const options of undo) {
            const inverse = inverseExpansion(options.points);
            if (!inverse) {
                back = false;
                break;
            }
            value = inverse(value);
        }
        if (!back) continue;

        const recorded = aspect === 'onset' ? value + zero - moved : value;
        const total = now - recorded;
        if (Math.abs(total) < 1e-9) deltas.delete(id);
        else deltas.set(id, total);
    }

    return deltas;
};

/** {@link correctionDeltas} over the calls the editor holds. */
export const useCorrectionDeltas = (
    msm: Alignment,
    part: Scope,
    aspect: Aspect,
    pending?: ModifyOptions,
    unfitted?: string,
): Map<string, number> => {
    const { calls } = useCallSelection();

    return useMemo(
        () => correctionDeltas(calls, msm, part, aspect, pending, unfitted),
        [calls, msm, part, aspect, pending, unfitted],
    );
};
