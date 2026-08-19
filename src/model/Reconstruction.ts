/**
 * What the viewer reads: intensity segments that name MPM elements outright.
 *
 * There is no derivation step. `public/segments.json` holds exactly this shape,
 * `public/performance.mpm` holds the elements it names, and the two are baked
 * together by `scripts/bakeSegments.ts` from the transformer pipeline that used
 * to run in the browser on every load.
 */

/**
 * The activity motivations the intensity curve responds to: the first two raise
 * it, the last two lower it.
 */
export type Motivation = 'move' | 'intensify' | 'relax' | 'calm';

/**
 * One performance gesture inside a segment: a run of MPM elements of a single
 * type, over the ticks the gesture covers.
 *
 * The range is not derivable from the elements. An instruction's `date` says
 * where it takes effect, never how far it reaches — a single `<dynamics>` can
 * govern a whole phrase — so the span carries the range explicitly.
 */
export interface Span {
    /** Stable id for selection; also the first entry of `elements`. */
    id: string;
    /** MPM element type: tempo, dynamics, rubato, articulation, … */
    type: string;
    from: number;
    to: number;
    /** `xml:id`s of the MPM elements this gesture consists of. */
    elements: string[];
}

/** A stretch of the piece argued to move, intensify, relax or calm. */
export interface Segment {
    id: string;
    /** A {@link Motivation}, or another word the corpus uses — `unknown` leaves the curve flat. */
    motivation: string;
    /** How sure the claim is: `plausible`, `likely`, `possible`, `speculative`, `unlikely`. */
    certainty: string;
    /** Why — shown when the segment is hovered or opened. */
    note?: string;
    /** Id of the segment this one continues, forming a chain. */
    continue?: string;
    from: number;
    /** Equal to `from` for a segment that acts on a single point in time. */
    to: number;
    spans: Span[];
}

export interface Reconstruction {
    title: string;
    author: string;
    segments: Segment[];
}
