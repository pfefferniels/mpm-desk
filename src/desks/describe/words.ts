import type { StepReport } from '../../fitting/description/client';
import { PULSES_PER_QUARTER } from '../../fitting/ppq';
import type { DescribedPlace } from '../../fitting/transformers/description/Describe';
import type { Call } from '../../model/Work';
import type { Failure } from './asking';
import type { Displaced } from './document';

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

/**
 * What a call is called on the desk it is made on, one of them and several: the reader is told
 * of calls made by hand in the words those desks use, and never by a transformer's name.
 */
const MADE_BY_HAND: Readonly<Record<string, readonly [one: string, several: string]>> = {
    InsertTempo: ['tempo', 'tempos'],
    InsertRubato: ['rubato', 'rubatos'],
    InsertDynamics: ['dynamics curve', 'dynamics curves'],
    InsertTemporalSpread: ['spread', 'spreads'],
    InsertDynamicsGradient: ['gradient', 'gradients'],
    InsertMetricalAccentuation: ['accentuation pattern', 'accentuation patterns'],
    InsertArticulation: ['articulation', 'articulations'],
    InsertPedal: ['pedal line', 'pedal lines'],
    Modify: ['correction', 'corrections'],
};

/** `a`, `a and b`, `a, b and c`. */
const listed = (parts: readonly string[]): string =>
    parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;

/** Calls made by hand, counted by kind in the words of their desks: `5 tempos and 1 dynamics curve`. */
export const countedOf = (calls: readonly Pick<Call, 'name'>[]): string =>
    listed(
        [...Map.groupBy(calls, (call) => call.name)].map(([name, alike]) => {
            const [one, several] = MADE_BY_HAND[name] ?? [`${name} call`, `${name} calls`];
            return `${String(alike.length)} ${alike.length === 1 ? one : several}`;
        }),
    );

/**
 * The stretch some calls speak of, by its bars; empty where none of them names a date.
 *
 * @param within a stretch not to look beyond: a call may run on outside the remark that meets it.
 */
const reachOf = (calls: readonly Pick<Call, 'options'>[], bars: Bars, within?: { from: number; to: number }): string => {
    const spans = calls.flatMap(({ options }) => {
        const from = [options['from'], options['date']].find((value): value is number => typeof value === 'number');
        if (from === undefined) return [];
        const to = typeof options['to'] === 'number' ? options['to'] : from;
        return [{ from, to: Math.max(from, to) }];
    });
    if (spans.length === 0) return '';
    const from = Math.max(Math.min(...spans.map((span) => span.from)), within?.from ?? -Infinity);
    const to = Math.min(Math.max(...spans.map((span) => span.to)), within?.to ?? Infinity);
    return stretchOf(bars, from, Math.max(from, to));
};

/**
 * What an answer would take the place of, as the reader is asked: `take the place of 5 tempos
 * drawn by hand in bars 16–17`, and, where a call is only cut into, that the rest of it stays.
 */
export const displacingOf = (displaced: readonly Displaced[], about: DescribedPlace, bars: Bars): string => {
    const where = reachOf(
        displaced.map(({ call }) => call),
        bars,
        about.kind === 'piece' ? undefined : about,
    );
    const cut = displaced.filter(({ left }) => left.length > 0).length;
    const whose = cut === displaced.length ? (cut === 1 ? 'it says' : 'they say') : `${String(cut)} of them say`;
    return [
        `take the place of ${countedOf(displaced.map(({ call }) => call))} drawn by hand`,
        where === '' ? '' : ` in ${where}`,
        cut === 0 ? '' : `, leaving what ${whose} elsewhere`,
    ].join('');
};

/**
 * What a step gave way to, counted in the words of the desks: `4 tempos`. Where the document no
 * longer shows a call, the calls are only counted.
 */
export const gaveWayOf = (ids: readonly string[], madeByHand: ReadonlyMap<string, Call>): string => {
    const calls = ids.flatMap((id) => madeByHand.get(id) ?? []);
    return calls.length === ids.length ? countedOf(calls) : `${String(ids.length)} ${ids.length === 1 ? 'call' : 'calls'}`;
};

/** A day, as it is written beside who answered. */
export const dayOf = (date: string | null): string | null => {
    const parsed = date === null ? NaN : Date.parse(date);
    return Number.isNaN(parsed)
        ? null
        : new Date(parsed).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
