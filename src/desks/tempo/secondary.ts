/**
 * What the tempo desk keeps in the work file, divided by scope.
 *
 * The boxes, the split onsets and the drawn curves are measurements of one part's playing, so
 * they belong to the scope they were measured in. They used to sit in one undivided bag, which
 * made the picker look broken: with anything stored, the desk drew the same skyline whichever
 * part was selected, because the stored boxes were preferred over the seed the scope would have
 * produced.
 */
import type { Scope } from '../../fitting/instructions/index';
import type { DrawnLine, TempoSegment } from './Tempo';

/**
 * The onset of a date the recording does not sound — the second half of a segment the user
 * split, in seconds, as `work.json` stores it.
 *
 * Stated here rather than imported: it is this desk's own editorial input, it never reaches the
 * chain, and nothing else reads it.
 */
export interface SilentOnset {
    date: number;
    onset: number;
}

/** What the desk keeps for one scope. */
export interface TempoScopeData {
    tempoCluster?: TempoSegment[];
    silentOnsets?: SilentOnset[];
    drawnLines?: DrawnLine[];
}

/**
 * The desk's whole bag.
 *
 * A file written before the desk was scope-aware carries one `TempoScopeData` here directly, with
 * no `byScope`. {@link scopeData} reads that as the global scope's, which is what it was: the
 * picker offers no way to draw a curve or split a box under a part without the scope being on it,
 * and until now nothing under a part was ever stored. The first write through
 * {@link withScopeData} rewrites the bag in the divided shape.
 */
export interface TempoSecondaryData extends TempoScopeData {
    byScope?: Record<string, TempoScopeData>;
}

/** A `Scope` as a JSON object key. */
const scopeKey = (scope: Scope): string => (scope === 'global' ? 'global' : String(scope));

const isUndivided = (data: TempoSecondaryData): boolean =>
    data.tempoCluster !== undefined ||
    data.silentOnsets !== undefined ||
    data.drawnLines !== undefined;

const divided = (data: TempoSecondaryData | undefined): Record<string, TempoScopeData> => {
    if (!data) return {};
    if (data.byScope) return data.byScope;
    if (!isUndivided(data)) return {};
    return {
        global: {
            tempoCluster: data.tempoCluster,
            silentOnsets: data.silentOnsets,
            drawnLines: data.drawnLines,
        },
    };
};

/** What this scope has stored, or nothing. */
export const scopeData = (
    data: TempoSecondaryData | undefined,
    scope: Scope,
): TempoScopeData => divided(data)[scopeKey(scope)] ?? {};

/** The bag with one scope's entry updated, in the divided shape whatever shape it arrived in. */
export const withScopeData = (
    data: TempoSecondaryData | undefined,
    scope: Scope,
    update: TempoScopeData,
): TempoSecondaryData => {
    const byScope = divided(data);
    const key = scopeKey(scope);
    return { byScope: { ...byScope, [key]: { ...byScope[key], ...update } } };
};
