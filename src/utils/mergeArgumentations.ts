import { Argumentation, getRange, MSM, Transformer } from "mpmify";
import { cloneTransformerWithArgumentation } from "../transformer-stack/cloneTransformer";

/**
 * Reconcile metadata from an absorbed argumentation into the winner.
 * Notes are concatenated; motivation/certainty come from the winner.
 */
function reconcileArgumentation(winner: Argumentation, absorbed: Argumentation): Argumentation {
    const notes = [winner.note, absorbed.note].filter(Boolean);
    const conclusionNotes = [winner.conclusion.note, absorbed.conclusion.note].filter(Boolean);

    return {
        ...winner,
        note: notes.length > 0 ? notes.join('; ') : undefined,
        conclusion: {
            ...winner.conclusion,
            note: conclusionNotes.length > 0 ? conclusionNotes.join('; ') : undefined,
        },
    };
}

/**
 * Find groups of argumentations sharing the same (from, to) range,
 * merge them into one argumentation each, and return a new transformer
 * array with all losers' transformers cloned to the winner's argumentation.
 *
 * Returns the same array reference if nothing needs merging (idempotent).
 */
export function mergeOverlappingArgumentations(transformers: Transformer[], msm: MSM): Transformer[] {
    const grouped = Map.groupBy(transformers, t => t.argumentation);

    // Compute each argumentation's composite range
    const rangeByArg = new Map<Argumentation, { from: number; to: number }>();
    for (const [arg, ts] of grouped) {
        const range = getRange(ts, msm);
        if (range) {
            rangeByArg.set(arg, { from: range.from, to: range.to ?? range.from });
        }
    }

    // Group argumentations by their (from, to) key
    const byRangeKey = new Map<string, Argumentation[]>();
    for (const [arg, range] of rangeByArg) {
        const key = `${range.from}:${range.to}`;
        let list = byRangeKey.get(key);
        if (!list) {
            list = [];
            byRangeKey.set(key, list);
        }
        list.push(arg);
    }

    // Find groups that need merging (more than one argumentation per range)
    const merges = new Map<Argumentation, Argumentation>(); // loser → winner
    const reconciledWinners = new Map<Argumentation, Argumentation>(); // original winner → reconciled

    for (const args of byRangeKey.values()) {
        if (args.length <= 1) continue;

        // Pick the argumentation with the most transformers as winner
        args.sort((a, b) => (grouped.get(b)?.length ?? 0) - (grouped.get(a)?.length ?? 0));
        const winner = args[0];

        let reconciled = winner;
        for (let i = 1; i < args.length; i++) {
            reconciled = reconcileArgumentation(reconciled, args[i]);
            merges.set(args[i], winner);
        }
        reconciledWinners.set(winner, reconciled);
    }

    if (merges.size === 0) return transformers;

    return transformers.map(t => {
        const loserTarget = merges.get(t.argumentation);
        if (loserTarget) {
            // This transformer belongs to a loser — reassign to winner's reconciled argumentation
            return cloneTransformerWithArgumentation(t, reconciledWinners.get(loserTarget) ?? loserTarget);
        }
        if (reconciledWinners.has(t.argumentation)) {
            // This transformer belongs to the winner — update with reconciled metadata
            return cloneTransformerWithArgumentation(t, reconciledWinners.get(t.argumentation)!);
        }
        return t;
    });
}

/**
 * Find an existing argumentation whose composite range matches the given range.
 * Used for preventive merge when adding a new transformer.
 */
export function findMatchingArgumentation(
    existingTransformers: Transformer[],
    newRange: { from: number; to?: number },
    msm: MSM,
): Argumentation | undefined {
    const grouped = Map.groupBy(existingTransformers, t => t.argumentation);

    for (const [arg, ts] of grouped) {
        const range = getRange(ts, msm);
        if (!range) continue;
        const existingFrom = range.from;
        const existingTo = range.to ?? range.from;
        const newFrom = newRange.from;
        const newTo = newRange.to ?? newRange.from;
        if (existingFrom === newFrom && existingTo === newTo) {
            return arg;
        }
    }

    return undefined;
}
