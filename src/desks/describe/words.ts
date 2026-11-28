import type { StepReport } from '../../fitting/description/client';
import { PULSES_PER_QUARTER } from '../../fitting/ppq';
import type { DescribedPlace } from '../../fitting/transformers/description/Describe';
import type { Call } from '../../model/Work';
import type { Failure } from './asking';

/**
 * What the desk says in words: where a remark is, what became of it, and why nothing did.
 */

type Bars = readonly { n: number; from: number; to: number }[];

const barAt = (bars: Bars, tick: number) => bars.findLast((bar) => tick >= bar.from - 1e-6) ?? bars[0];

/** A stretch of the score by its bars: `bar 3`, `bars 3–8`. */
const stretchOf = (bars: Bars, from: number, to: number): string => {
    const first = barAt(bars, from);
    const last = barAt(bars, Math.max(from, to - 1));
    if (!first || !last) return '';
    return first.n === last.n ? `bar ${String(first.n)}` : `bars ${String(first.n)}–${String(last.n)}`;
};

/** Where a remark was made, as it is said beside it. */
export const placeOf = (about: DescribedPlace, bars: Bars): string => {
    if (about.kind === 'piece') return 'the whole piece';
    const stretch = stretchOf(bars, about.from, about.to);
    if (about.kind === 'span') return stretch;
    if (about.kind === 'arrow') return `towards a note, ${stretch}`;
    const count = about.notes.length;
    return `${count === 1 ? 'one note' : `${String(count)} notes`}, ${stretch}`;
};

/** What the pen asks for while nothing is written in it yet. */
export const askedFor = (about: DescribedPlace, bars: Bars): string => {
    if (about.kind === 'piece') return 'about the whole piece…';
    if (about.kind === 'span') return `about ${stretchOf(bars, about.from, about.to)}…`;
    if (about.kind === 'arrow') return 'where is it going…';
    return about.notes.length === 1 ? 'about this note…' : `about these ${String(about.notes.length)} notes…`;
};

/** Why no answer came, as the reader is told. */
export const failureOf = (failure: Failure): string =>
    ({
        key: 'The API did not accept the key. Enter another one under Expert.',
        busy: 'The expert is taking too many requests just now. Ask again in a moment.',
        declined: 'The expert declined to answer this.',
        unreadable: 'An answer came, but not one that can be read as steps.',
        stopped: 'Stopped before an answer came.',
        failed: 'No answer came. Ask again, or look at the connection.',
    })[failure];

/** What a step wrote into the MPM, counted by element: `tempo ×8, dynamics`. */
export const wroteOf = (report: Pick<StepReport, 'elements' | 'written'>): string => {
    const counts = new Map<string, number>();
    report.elements.forEach((id, i) => {
        const kind = /^<([\w.:-]+)/.exec(report.written[i] ?? '')?.[1] ?? /^[A-Za-z]+/.exec(id)?.[0] ?? 'element';
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
    });
    return [...counts].map(([kind, count]) => (count > 1 ? `${kind} ×${String(count)}` : kind)).join(', ');
};

/**
 * Where a call acts, for telling the calls of one step apart: its bar, with the quarter it is on
 * where that is not the first; or its place in the list, where it names no date.
 */
export const whereOf = (call: Call, index: number, bars: Bars): string => {
    const at = [call.options['from'], call.options['date']].find((value): value is number => typeof value === 'number');
    const bar = at === undefined ? undefined : barAt(bars, at);
    if (at === undefined || !bar) return String(index + 1);
    const beat = Math.round((1 + (at - bar.from) / PULSES_PER_QUARTER) * 100) / 100;
    return beat === 1 ? `bar ${String(bar.n)}` : `bar ${String(bar.n)}, beat ${String(beat)}`;
};

/** A day, as it is written beside who answered. */
export const dayOf = (date: string | null): string | null => {
    const parsed = date === null ? NaN : Date.parse(date);
    return Number.isNaN(parsed)
        ? null
        : new Date(parsed).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
