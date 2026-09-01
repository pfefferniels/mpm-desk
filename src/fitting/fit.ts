/**
 * The fold at the centre of the editor: a work file in, a performance and its provenance out.
 *
 * One function, called from two places that must not disagree — the worker the editor drives,
 * and `scripts/verifyChain.ts`, which checks the result against the shipped reconstruction. It is
 * deliberately free of React, of the DOM and of the worker protocol, so that the thing under test
 * is the thing that runs.
 *
 * ## What crosses, and why it is text
 *
 * {@link FitResult} is plain data: strings, numbers, arrays and plain objects, and nothing else.
 * The MPM crosses as XML rather than as espressivo's `Mpm`, because that object is a live XML
 * tree and structured clone cannot carry one — the main thread parses it back into a
 * `PerformanceReader` for drawing. That is the same boundary espressivo's own facade draws, for
 * the same reason, and it costs about ten milliseconds on a document of this size against three
 * seconds of fitting.
 *
 * ## What it does NOT do
 *
 * It does not decide anything. The chain is the reconstruction's, the segmentation is the
 * reconstruction's, and this runs what it is given in the one order the fitters compose in. A
 * call naming a transformer this build does not have is reported, never skipped silently.
 */
import { buildChain } from './chain';
import { validate } from './transformers/Order';
import { createMpm, exportMPM, getInstructions } from './instructions/index';
import { getRange } from './transformers/Transformer';
import { clearResidualCache, deriveResidual, residualStats } from './residual';
import type { AlignedNote, AlignedPedal, Alignment } from './alignment';
import type { DatedTimeSignature } from './timeSignature';
import type { Call, WorkFile } from '../model/Work';
import { projectReconstruction, type CallOutcome, type ProjectionStats } from '../model/Reconstruction';
import type { Reconstruction } from '../model/Reconstruction';

/**
 * The recording as the chain left it, flattened enough to cross a worker boundary.
 *
 * `AlignedNote` and `AlignedPedal` are plain records — no methods, no live nodes — so they cross
 * structured clone unchanged. What cannot cross is `Alignment` itself, which is a class; the
 * editor rebuilds one from these on the far side.
 *
 * It is the recording **as the chain left it**, not as it arrived: `MakeChoice` chooses between
 * readings, `Modify` shifts an onset or a velocity by hand, and `InsertTempo` shifts every onset
 * so the first lands on zero. A desk drawing the pristine recording would be drawing something
 * the fit was never measured against.
 *
 * Every field is kept rather than the handful a desk was thought to need: the articulation desk
 * wants `midi.pitch`, the choice desk wants `source`, and a projection that has to be widened
 * every time a desk asks a new question is a projection that should not exist.
 */
export interface Ground {
    notes: AlignedNote[];
    pedals: AlignedPedal[];
    /** Needed to rebuild an `Alignment`; the accentuation and tempo desks read the metre off it. */
    timeSignatures: DatedTimeSignature[];
}

export interface FitResult {
    /** The performance the chain wrote, as MPM XML. */
    mpm: string;
    /** The recording the chain was fitted to, as the chain left it — every desk's ground. */
    ground: Ground;
    /** What the tree draws — segments and spans, projected onto the ticks the calls acted on. */
    reconstruction: Reconstruction;
    /** Per call: the elements it is answerable for, where it acted, and under which claim. */
    outcomes: CallOutcome[];
    /** Calls naming a transformer this build does not have. Reported, never dropped in silence. */
    unknown: Call[];
    projection: ProjectionStats;
    timing: {
        /** Milliseconds spent running the chain. */
        chainMs: number;
        /** How much of that went on residuals, and how much the caches saved. */
        residual: typeof residualStats;
    };
}

export class ChainInvalidError extends Error {
    constructor(readonly problems: readonly string[]) {
        super(problems.join('\n'));
        this.name = 'ChainInvalidError';
    }
}

/**
 * Run a work file's chain over an alignment.
 *
 * @param alignment written through as the chain runs — `MakeChoice` and `Modify` edit the
 * observations, and `InsertTempo` shifts every onset to the first — so a caller that also wants
 * the recording as it arrived needs a second one. The editor keeps a pristine copy and clones.
 * @throws {ChainInvalidError} a call requires a transformer the chain does not run before it.
 * That is a statement about the chain rather than about the recording, and running the part of
 * it that happens to be well-ordered would produce a document that looks fitted and is not.
 */
export function runFit(work: WorkFile, alignment: Alignment): FitResult {
    // The caches are module state keyed on a document and an alignment. Both are fresh here, so
    // anything still held is the previous run's and can only be a false hit.
    clearResidualCache();

    const { transformers, unknown, title, author } = buildChain(work.provenance);

    const problems = validate(transformers);
    if (problems.length) throw new ChainInvalidError(problems.map((p) => p.message));

    const mpm = createMpm();
    const startedAt = Date.now();
    for (const transformer of transformers) transformer.run(alignment, mpm);
    const chainMs = Date.now() - startedAt;

    // Read once, after the run. A `<pedal>` has no symbolic date of its own, so placing one is
    // derived from the finished document — which is why the ranges cannot be read as the chain
    // goes. `without: ['movement']` is the probe `InsertPedal` itself fits against.
    const residual = deriveResidual(alignment, mpm, { without: ['movement'] });

    // Every instruction has an `xml:id` by now — `AbstractTransformer.run` refuses to let a call
    // finish having left one without, because an unnamed instruction cannot be attributed to the
    // call that wrote it. The narrowing is the type system catching up with that guarantee, not a
    // case being handled.
    const elementTypes = new Map(
        getInstructions(mpm)
            .filter((instruction): instruction is typeof instruction & { id: string } =>
                instruction.id !== undefined,
            )
            .map((instruction) => [instruction.id, instruction.type]),
    );
    // Which claim a call's instructions are made under is the file's to say, not the run's —
    // see `Call.segment`. A transformer the chain substituted has no entry here and stays
    // unclaimed, which is the honest answer for something nobody wrote down.
    const segmentOf = new Map(
        work.provenance.map((call) => [call.id, call.segment] as const),
    );
    const outcomes: CallOutcome[] = transformers.map((transformer) => {
        const range = getRange(transformer.options, alignment, residual);
        const segment = segmentOf.get(transformer.id);
        return {
            id: transformer.id,
            elements: [...transformer.created],
            range: range ? { from: range.from, to: range.to ?? null } : null,
            ...(segment !== undefined && { segment }),
        };
    });

    const { reconstruction, stats } = projectReconstruction({
        title,
        author,
        claims: work.segments,
        outcomes,
        elementTypes,
    });

    return {
        mpm: exportMPM(mpm),
        ground: {
            notes: alignment.allNotes,
            pedals: alignment.pedals,
            timeSignatures: alignment.timeSignatures,
        },
        reconstruction,
        outcomes,
        unknown,
        projection: stats,
        timing: { chainMs, residual: { ...residualStats } },
    };
}
