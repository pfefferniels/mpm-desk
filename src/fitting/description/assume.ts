/**
 * What a run assumes where nothing is described.
 *
 * A rendering needs a `<tempo>` and a `<dynamics>` everywhere, and an ornament sounds only once it
 * has a definition. So where no call states a tempo a steady one is assumed, joining what is
 * described on either side; where none states a level, one level; and where ornaments are written
 * and nothing gives them their definitions, `StylizeOrnamentation` with its usual tolerances.
 *
 * None of it is a call of the document: it serves the describe desk's own picture, and is
 * reported apart.
 */
import { Alignment } from '../alignment';
import type { Mpm } from '../instructions/index';
import type { Call } from '../../model/Work';
import { InsertDynamics } from '../transformers/dynamics/InsertDynamics';
import type { Range } from '../transformers/range';
import { InsertTempo } from '../transformers/tempo/InsertTempo';
import { AbstractTransformer, type ScopedTransformationOptions } from '../transformers/Transformer';
import { registerTransformer } from '../transformers/TransformerRegistry';
import { STYLIZE } from './complete';
import { DYNAMICS, TEMPO } from './settle';
import { chordsOf, startOf, steadyTempo } from './steps';

const BEAT_LENGTH = 0.25;

interface AssumeTempoOptions extends ScopedTransformationOptions {
    from: number;
    to: number;
}

/** A steady tempo over a span no call states one for, read off the recording as `FitTempo` does. */
export class AssumeTempo extends AbstractTransformer<AssumeTempoOptions> {
    readonly name = 'AssumeTempo';
    readonly requires = [];
    /** The tempo the last run assumed. */
    bpm?: number;

    constructor(options?: AssumeTempoOptions) {
        super(options ?? { scope: 'global', from: 0, to: 0 });
    }

    range(): undefined {
        return undefined;
    }

    override evidence(): string[] {
        return [];
    }

    protected transform(msm: Alignment, mpm: Mpm): void {
        this.bpm = undefined;
        msm.shiftToFirstOnset();
        const { scope, from, to } = this.options;

        const all = chordsOf(msm);
        const inside = all.filter((chord) => chord.date >= from && chord.date <= to);
        const start = startOf(msm, mpm, scope, from, inside);
        const fit =
            start &&
            steadyTempo(
                start,
                inside.filter((chord) => chord.date > from),
                BEAT_LENGTH,
            );
        // A span without chords still needs a tempo, to end the one before it: the whole piece's.
        const whole = all[0] && steadyTempo(all[0], all.slice(1), BEAT_LENGTH);

        const bpm = fit?.bpm ?? whole?.bpm ?? 60;
        new InsertTempo({ scope, from, to, beatLength: BEAT_LENGTH, bpm }).run(msm, mpm);
        this.bpm = bpm;
    }
}

const median = (values: number[]): number => {
    if (values.length === 0) return 64;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** The one level a rendering has where no dynamics are described: the median velocity. */
export const levelOf = (msm: Alignment): number =>
    Math.round(median(msm.allNotes.map((note) => note.velocity)));

interface AssumeLevelOptions extends ScopedTransformationOptions {
    /** Where the level is stated: the first chord of every stretch without dynamics. */
    dates: number[];
}

/** One level wherever no dynamics are described, the same in every gap. */
export class AssumeLevel extends AbstractTransformer<AssumeLevelOptions> {
    readonly name = 'AssumeLevel';
    readonly requires = [];
    /** The level the last run assumed. */
    level?: number;

    constructor(options?: AssumeLevelOptions) {
        super(options ?? { scope: 'global', dates: [] });
    }

    range(): undefined {
        return undefined;
    }

    override evidence(): string[] {
        return [];
    }

    protected transform(msm: Alignment, mpm: Mpm): void {
        const level = levelOf(msm);
        this.level = level;
        for (const date of this.options.dates) {
            new InsertDynamics({
                scope: 'global',
                from: date,
                to: date,
                guides: new Map([[date, level]]),
            }).run(msm, mpm);
        }
    }
}

// Before the fitted steps, and so before the calls those make: what is described is written
// over what is assumed, never the other way round.
registerTransformer(AssumeTempo, { before: 'FitTempo' });
registerTransformer(AssumeLevel, { before: 'FitDynamics' });

/** The built-in transformer an assumption or a fitted step runs: what meets a `requires`. */
export const STANDS_FOR = new Map([
    ['AssumeTempo', 'InsertTempo'],
    ['FitTempo', 'InsertTempo'],
    ['AssumeLevel', 'InsertDynamics'],
    ['FitDynamics', 'InsertDynamics'],
]);

/** The global span a call states, if it states one. */
const spanOf = ({ options }: Call): [number, number] | undefined => {
    const { from, to, scope } = options;
    if (typeof from !== 'number' || typeof to !== 'number') return undefined;
    if (scope !== undefined && scope !== 'global') return undefined;
    return [from, to];
};

const spansOf = (calls: readonly Call[], family: Set<string>): [number, number][] =>
    calls
        .filter((call) => family.has(call.name))
        .map(spanOf)
        .filter((span): span is [number, number] => span !== undefined);

/** The parts of `[start, end)` that no span covers. */
const gaps = (spans: [number, number][], start: number, end: number): Range[] => {
    const sorted = spans.filter(([from, to]) => to > from).sort((a, b) => a[0] - b[0]);
    const free: Range[] = [];
    let cursor = start;
    for (const [from, to] of sorted) {
        if (from > cursor) free.push({ from: cursor, to: Math.min(from, end) });
        cursor = Math.max(cursor, to);
        if (cursor >= end) break;
    }
    if (cursor < end) free.push({ from: cursor, to: end });
    return free;
};

const ORNAMENTS = new Set(['InsertTemporalSpread', 'InsertDynamicsGradient']);

/**
 * The calls that stand in for what `calls` leave undescribed.
 *
 * @param piece the recording as played: its chords' dates and where the score ends.
 */
export const assume = (calls: readonly Call[], piece: Alignment): Call[] => {
    const tempos = gaps(spansOf(calls, TEMPO), 0, piece.end).map((gap, index) => ({
        id: `assume-tempo-${index}`,
        name: 'AssumeTempo',
        options: { scope: 'global', from: gap.from, to: gap.to },
    }));

    // A dynamics span holds the chord on its last date, so a gap starts on the chord after it.
    const spans = spansOf(calls, DYNAMICS);
    const described = (date: number) => spans.some(([from, to]) => date >= from && date <= to);
    const dates = [...new Set(piece.allNotes.map((note) => note.date))].sort((a, b) => a - b);
    const level = {
        id: 'assume-level',
        name: 'AssumeLevel',
        options: {
            scope: 'global',
            dates: dates.filter(
                (date, index) => !described(date) && (index === 0 || described(dates[index - 1]!)),
            ),
        },
    };

    const unstyled =
        calls.some((call) => ORNAMENTS.has(call.name)) &&
        !calls.some((call) => call.name === 'StylizeOrnamentation');
    const style = {
        id: 'assume-ornament-style',
        name: 'StylizeOrnamentation',
        options: { ...STYLIZE },
    };

    return [...tempos, level, ...(unstyled ? [style] : [])];
};
