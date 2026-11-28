/**
 * Score positions as a musician names them: a tick by its bar and beat, a stretch by its bars.
 */
import { timeSignatureAt, type DatedTimeSignature } from '../../../fitting/timeSignature';
import type { ExpertRequest } from './types';

export interface Places {
    /** `bar:beat`, the beat to two decimals where it is not a whole one. */
    place: (tick: number) => string;
    /** "bar 3" on a downbeat, "bar 3, beat 2.5" elsewhere. */
    where: (tick: number) => string;
    /** "bars 3–4" for whole bars, from where to where for anything else. */
    span: (from: number, to: number) => string;
}

/** A piece whose score states no metre has no bars, and its places are given in ticks. */
export const placesOf = (
    { bars, ppq }: ExpertRequest['piece'],
    signatures: readonly DatedTimeSignature[],
): Places => {
    const barAt = (tick: number) => bars.findLast((bar) => tick >= bar.from - 1e-6) ?? bars[0];
    const beatOf = (tick: number) => {
        const bar = barAt(tick);
        if (!bar) return undefined;
        const length = (4 * ppq) / (timeSignatureAt(signatures, bar.from)?.denominator ?? 4);
        const beat = Math.round((1 + (tick - bar.from) / length) * 100) / 100;
        return {
            bar: bar.n,
            beat: Number.isInteger(beat) ? String(beat) : beat.toFixed(2).replace(/0+$/, ''),
        };
    };

    const place = (tick: number) => {
        const at = beatOf(tick);
        return at ? `${at.bar}:${at.beat}` : `tick ${tick}`;
    };
    const where = (tick: number) => {
        const at = beatOf(tick);
        if (!at) return `tick ${tick}`;
        return at.beat === '1' ? `bar ${at.bar}` : `bar ${at.bar}, beat ${at.beat}`;
    };
    const span = (from: number, to: number) => {
        const first = barAt(from);
        const last = barAt(Math.max(from, to - 1));
        if (first && last && from === first.from && to === last.to) {
            return first === last ? `bar ${first.n}` : `bars ${first.n}–${last.n}`;
        }
        return `${where(from)} to ${where(to)}`;
    };
    return { place, where, span };
};
