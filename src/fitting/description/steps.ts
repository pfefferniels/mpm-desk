/**
 * The fitted steps of a description: a tempo and a level read off the recording.
 *
 * A reader who draws a tempo hands over a number; one who says "steady on half bars" does not.
 * Each of these runs the plain Desk call a drawn line would have made and keeps its options, so
 * that a document can hold that call in the step's place.
 *
 * Known to the registry wherever this module is loaded, and nowhere else: no document holds one
 * outside a remark's `steps`.
 */
import '../transformers/Order';
import { Alignment } from '../alignment';
import { fingerprintInstructions, type Mpm, type Scope } from '../instructions/index';
import { PULSES_PER_WHOLE } from '../ppq';
import {
    InsertDynamics,
    type InsertDynamicsOptions,
} from '../transformers/dynamics/InsertDynamics';
import type { Range } from '../transformers/range';
import { InsertTempo, type InsertTempoOptions } from '../transformers/tempo/InsertTempo';
import { placeTempos } from '../transformers/tempo/placedTempos';
import { millisecondsAt, resolveSpan } from '../transformers/tempo/tempoCalculations';
import {
    AbstractTransformer,
    type ScopedTransformationOptions,
    type Transformer,
} from '../transformers/Transformer';
import { registerTransformer } from '../transformers/TransformerRegistry';

/** A score date, in ticks, and when it sounded, in ms. */
interface Moment {
    date: number;
    ms: number;
}

/** A tempo as `InsertTempo` takes it, and how it lies against the onsets it was read off. */
interface FittedTempo {
    bpm: number;
    transitionTo?: number;
    meanTempoAt?: number;
    /** RMS distance of the fit from the onsets, in ms. */
    rmsMs: number;
    /** The number of chords fitted to. */
    onsets: number;
}

/** The chords of the score with a recorded onset, ascending: the first note on a date times it. */
export const chordsOf = (msm: Alignment): Moment[] => {
    const onsets = new Map<number, number>();
    for (const note of msm.in('global').notes()) {
        if (!onsets.has(note.date) && Number.isFinite(note['milliseconds.date'])) {
            onsets.set(note.date, note['milliseconds.date']);
        }
    }
    return [...onsets].map(([date, ms]) => ({ date, ms })).sort((a, b) => a.date - b.date);
};

const beats = (ticks: number, beatLength: number) => ticks / (PULSES_PER_WHOLE * beatLength);

/** The constant tempo from `start` at which the last of `chords` (ascending) falls as played. */
export const steadyTempo = (
    start: Moment,
    chords: readonly Moment[],
    beatLength: number,
): FittedTempo | undefined => {
    const last = chords.at(-1);
    if (!last || last.date <= start.date || last.ms <= start.ms) return undefined;
    const perTick = (last.ms - start.ms) / (last.date - start.date);
    const squares = chords.map(
        (chord) => (start.ms + (chord.date - start.date) * perTick - chord.ms) ** 2,
    );
    return {
        bpm: (60000 * beats(last.date - start.date, beatLength)) / (last.ms - start.ms),
        rmsMs: Math.sqrt(squares.reduce((a, b) => a + b, 0) / chords.length),
        onsets: chords.length,
    };
};

/**
 * The tempo transition fitted to `chords`, arriving at `end` (ticks). Searches `transitionTo / bpm`
 * and `meanTempoAt`; `bpm` then follows from the last chord falling where it was played.
 */
const movingTempo = (
    start: Moment,
    chords: readonly Moment[],
    end: number,
    beatLength: number,
): FittedTempo | undefined => {
    const steady = steadyTempo(start, chords, beatLength);
    const last = chords.at(-1);
    // Two more parameters need at least three chords.
    if (!steady || !last || chords.length < 3) return steady;

    const played = last.ms - start.ms;
    const errorOf = (ratio: number, meanTempoAt: number) => {
        // Probed at 60 bpm: scaling both ends of the tempo scales the times inversely.
        const probe = resolveSpan({
            date: start.date,
            endDate: end,
            beatLength,
            bpm: 60,
            transitionTo: 60 * ratio,
            meanTempoAt,
        });
        const unscaled = millisecondsAt(last.date, probe);
        if (!Number.isFinite(unscaled) || unscaled <= 0) return undefined;
        const scale = played / unscaled;
        let squares = 0;
        for (const chord of chords) {
            squares += (start.ms + millisecondsAt(chord.date, probe) * scale - chord.ms) ** 2;
        }
        return { squares, bpm: 60 / scale };
    };

    let best = { squares: Infinity, ratio: 1, meanTempoAt: 0.5, bpm: steady.bpm };
    const consider = (ratio: number, meanTempoAt: number) => {
        const found = errorOf(ratio, meanTempoAt);
        if (found && found.squares < best.squares) best = { ...found, ratio, meanTempoAt };
    };
    // A coarse grid over ratios from 0.5 to 2, then a finer one round the best of it.
    for (let r = -12; r <= 12; r++) {
        for (let m = 3; m <= 17; m++) consider(2 ** (r / 12), m / 20);
    }
    const coarse = best;
    for (let r = -5; r <= 5; r++) {
        for (let m = -4; m <= 4; m++) {
            const mean = Math.min(0.9, Math.max(0.1, coarse.meanTempoAt + m / 80));
            consider(Math.min(2, Math.max(0.5, coarse.ratio * 2 ** (r / 72))), mean);
        }
    }

    const rmsMs = Math.sqrt(best.squares / chords.length);
    // Steady unless the tempo changes by 3% or more and the fit gains 15% or more by it.
    if (Math.abs(best.ratio - 1) < 0.03 || rmsMs > 0.85 * steady.rmsMs) return steady;
    return {
        bpm: best.bpm,
        transitionTo: best.bpm * best.ratio,
        meanTempoAt: best.meanTempoAt,
        rmsMs,
        onsets: chords.length,
    };
};

/**
 * When a span's first tick sounds: its chord's onset, else where the tempo standing before it
 * puts it, else the first chord inside it.
 */
export const startOf = (
    msm: Alignment,
    mpm: Mpm,
    scope: Scope,
    from: number,
    chords: readonly Moment[],
): Moment | undefined => {
    const [first] = chords;
    if (first?.date === from) return first;

    const segment = placeTempos(msm, mpm, scope).findLast((placed) => placed.tempo.date <= from);
    if (segment) {
        const ms = segment.startMs + millisecondsAt(from, segment.resolved);
        if (Number.isFinite(ms)) return { date: from, ms };
    }
    return first;
};

/**
 * Runs the plain call a fitted step makes, and says what of the document that call changed
 * without being answerable for it: a tempo it wrote back at its span's end, which is another
 * call's and must not be credited to the step.
 */
const make = (call: Transformer, msm: Alignment, mpm: Mpm): string[] => {
    const before = fingerprintInstructions(mpm);
    call.run(msm, mpm);
    return [...fingerprintInstructions(mpm)]
        .filter(([id, xml]) => before.get(id) !== xml && !call.created.includes(id))
        .map(([id]) => id);
};

interface FitTempoOptions extends ScopedTransformationOptions {
    /** In ticks. */
    from: number;
    /** In ticks, exclusive; a chord on it is still fitted to. */
    to: number;
    /** As a fraction of a whole note. */
    beatLength: number;
    shape: 'steady' | 'transition';
}

/**
 * `InsertTempo` with the tempo read off the recorded onsets.
 *
 * Runs in score order among the tempo calls: a span that does not start on a chord is measured
 * from where the tempo before it ends.
 */
export class FitTempo extends AbstractTransformer<FitTempoOptions> {
    readonly name = 'FitTempo';
    readonly requires = [];
    /** What the last run made: the tempo it fitted, as `InsertTempo` takes it, and how it lies. */
    fitted?: InsertTempoOptions & { rmsMs: number; onsets: number };
    /** The constant tempo a transition closed on the score's last chord is followed by. */
    closing?: InsertTempoOptions;
    private restored: string[] = [];

    constructor(options?: FitTempoOptions) {
        super(options ?? { scope: 'global', from: 0, to: 0, beatLength: 0.25, shape: 'steady' });
    }

    range(): Range {
        return { from: this.options.from, to: this.options.to };
    }

    protected override disowned(): readonly string[] {
        return this.restored;
    }

    protected transform(msm: Alignment, mpm: Mpm): void {
        this.fitted = undefined;
        this.closing = undefined;
        this.restored = [];
        msm.shiftToFirstOnset();
        const { scope, from, beatLength, shape } = this.options;
        let { to } = this.options;
        if (!(to > from))
            throw new Error(`FitTempo: "to" (${to}) has to lie after "from" (${from})`);

        const inside = chordsOf(msm).filter((chord) => chord.date >= from && chord.date <= to);
        const chords = inside.filter((chord) => chord.date > from);
        const last = chords.at(-1);
        const start = startOf(msm, mpm, scope, from, inside);
        if (!last || !start) {
            throw new Error(
                `FitTempo: no chord sounds after tick ${from} up to tick ${to}, so there is no tempo ` +
                    'to read off. Widen the span.',
            );
        }

        // A transition needs a tempo to arrive at. At the score's end there is none to follow, so
        // it stops on the last chord and a constant tempo takes over.
        const closes = shape === 'transition' && to >= msm.end;
        if (closes) to = last.date;

        const fit =
            shape === 'transition'
                ? movingTempo(start, chords, to, beatLength)
                : steadyTempo(start, chords, beatLength);
        if (!fit) {
            throw new Error(
                `FitTempo: the chords between ticks ${from} and ${to} do not follow one another in time`,
            );
        }

        const options: InsertTempoOptions = {
            scope,
            from,
            to,
            beatLength,
            bpm: fit.bpm,
            ...(fit.transitionTo !== undefined && {
                transitionTo: fit.transitionTo,
                meanTempoAt: fit.meanTempoAt,
            }),
        };
        this.restored.push(...make(new InsertTempo(options), msm, mpm));
        this.fitted = { ...options, rmsMs: fit.rmsMs, onsets: fit.onsets };

        if (closes && fit.transitionTo !== undefined) {
            const closing = { scope, from: to, to: msm.end, beatLength, bpm: fit.transitionTo };
            const follows = new InsertTempo(closing);
            const more = make(follows, msm, mpm);
            // It may stand where the first wrote one back, and that date is then its own.
            this.restored = [
                ...this.restored.filter((id) => !follows.created.includes(id)),
                ...more,
            ];
            this.closing = closing;
        }
    }
}

interface FitDynamicsOptions extends ScopedTransformationOptions {
    /** In ticks. */
    from: number;
    /** In ticks; the chord on it is still read. */
    to: number;
}

/** One level over a span: the mean of its chords' velocities, stated on its first date. */
export class FitDynamics extends AbstractTransformer<FitDynamicsOptions> {
    readonly name = 'FitDynamics';
    readonly requires = [];
    /** What the last run made: the call, as `InsertDynamics` takes it, and what it was read off. */
    fitted?: { call: InsertDynamicsOptions; volume: number; chords: number };

    constructor(options?: FitDynamicsOptions) {
        super(options ?? { scope: 'global', from: 0, to: 0 });
    }

    range(): Range {
        return { from: this.options.from, to: this.options.to };
    }

    protected transform(msm: Alignment, mpm: Mpm): void {
        this.fitted = undefined;
        const { scope, from, to } = this.options;
        const notes = msm.in(scope).notesInRange(from, to);
        if (notes.length === 0) {
            throw new Error(
                `FitDynamics: no note of this scope lies between ticks ${from} and ${to}`,
            );
        }
        const means = [...Map.groupBy(notes, (note) => note.date).values()].map(
            (chord) => chord.reduce((sum, note) => sum + note.velocity, 0) / chord.length,
        );
        const volume = means.reduce((a, b) => a + b, 0) / means.length;
        const call = { scope, from, to: from, guides: new Map([[from, volume]]) };
        new InsertDynamics(call).run(msm, mpm);
        this.fitted = { call, volume, chords: means.length };
    }
}

// Each just before the call it makes, so that a requirement the one meets the other meets too.
registerTransformer(FitTempo, { before: 'InsertTempo' });
registerTransformer(FitDynamics, { before: 'InsertDynamics' });
