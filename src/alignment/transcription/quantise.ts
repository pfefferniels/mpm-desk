/**
 * Where in the score a played note belongs that the score does not write.
 *
 * Rhythm transcription in the line of Cemgil, Desain and Kappen (2000) and of the metrical
 * hidden Markov models after Raphael (2002) and Nakamura, Yoshii and Sagayama (2017): every
 * candidate place in the bar has a prior, how ordinary it is to write a note there, and a
 * likelihood, how well the moment the note was struck fits it, and the most probable assignment
 * of a whole run of notes is found by dynamic programming.
 *
 * What is different here is everything those models have to infer. They do not know the tempo,
 * so they track it; here it is read off the matched notes on either side (see `./timeMap`). They
 * do not know whether a passage moves in triplets, so they learn a prior from a corpus; here the
 * bars around the note say so themselves (see `./grid`). What is left is small enough to solve
 * exactly, one gap between two matched moments at a time.
 *
 * A note too quick for any place on the grid is not measured at all: it is a grace note, and
 * the model holds that as one more hypothesis beside the grid positions, after the "k grace
 * notes and a note" symbols of Foscarin, Jacquemard, Rigaux and Sakai (2019).
 */

import { gridPositions, levelOf, levelPrior, placesAt, type Level } from "./grid";
import { measureAt, type MeasureModel, type ScoreEvent, type ScoreModel } from "./scoreModel";
import { intervalAt, isUnaccounted, localPace, type Anchor, type TimeMap } from "./timeMap";

/** One played note, as much of it as the transcription needs. */
export interface Played {
    id: string;
    onsetMs: number;
    offsetMs: number;
    pitch: number;
    velocity: number;
}

/** Played notes struck together: one moment, however many keys. */
interface Cluster {
    notes: Played[];
    /** When the first of them was struck */
    ms: number;
}

type Placement =
    /** On the grid: `onset` in quarter notes from the start of the piece */
    | { kind: "measured"; onset: number; level: Level; coincides: boolean }
    /** Before the next thing that sounds, unmeasured */
    | { kind: "grace" }
    /** In a stretch of the recording the score does not account for, or beyond its ends */
    | { kind: "unplaced"; because: string };

interface Quantised {
    cluster: Cluster;
    placement: Placement;
    /**
     * P(this placement | everything else it could have been), each weighed alone.
     *
     * Not the posterior of the whole run: a run of five notes has one most probable reading and
     * that reading has no single number per note. This is the share the chosen place takes of
     * this note's own candidates, which is what a reader deciding whether to look wants.
     */
    confidence: number;
    /** The best measured place, even where a grace note won: what `measured` would write */
    measured?: { onset: number; level: Level; coincides: boolean };
    /** Whether a grace note is a reading the timing allows at all */
    graceable: boolean;
    /**
     * Every place it could have been written at, in score order: the two written moments it
     * was played between and the grid between them. What a reader moves it along.
     */
    places: number[];
}

interface QuantiseOptions {
    /** Written events to read the score without, for holding notes out of it. */
    hidden?: ReadonlySet<ScoreEvent>;
    /**
     * What the reader has asked for, by cluster; absent lets the model decide.
     *
     * A `kind` says which notation and leaves the place to the model. An `onset` says the place
     * outright, one of the cluster's own {@link Quantised.places}: the note is put there and
     * the notes around it are placed as though it were not theirs to argue with.
     */
    force?: (cluster: Cluster) => { kind?: "measured" | "grace"; onset?: number } | undefined;
    settings?: Partial<QuantiseSettings>;
}

/**
 * The numbers of the model.
 *
 * Every one of them is measured or taken from a measurement, and `scripts/transcription` is
 * where: the timing scales are fitted to matched notes of 33 SUPRA rolls held out of their own
 * scores, the grace-note timing to the grace notes those scores write.
 */
export interface QuantiseSettings {
    /** Notes struck within this of the first are one moment. Nakamura et al. (2017) use 35 ms. */
    clusterMs: number;
    /**
     * How far a note falls from where a straight line between its neighbours puts it, at best:
     * the scale of the timing noise, in milliseconds.
     */
    noiseMs: number;
    /**
     * How much further it may fall the longer the stretch nothing was matched in, as a share of
     * that stretch. Rubato inside a gap is unobserved, and a wide gap hides more of it.
     */
    rubato: number;
    /** How far outside a chord's own spread a note may be struck and still belong to it. */
    chordMs: number;
    /** P(a played note the score does not write is a grace note), before its timing is looked at. */
    graceShare: number;
    /** The median time a grace note takes before the note it leans on, in milliseconds. */
    graceMs: number;
    /** The spread of that time, as the standard deviation of its logarithm. */
    graceSpread: number;
    /** How much less likely a grace note is a third from what it leans on than a step from it. */
    graceThird: number;
    /** And further off than that. */
    graceLeap: number;
    /** The quickest a measured note can follow another, in milliseconds. */
    fastestMs: number;
    /**
     * How far apart two moments may be struck and still be written at one place, in
     * milliseconds: the scale of a hand running ahead of the other, or of a chord being spread.
     */
    spreadMs: number;
    /**
     * The longest a grace note may take, as a share of the quickest notes the bars around it
     * write. A note as long as those is one of them.
     */
    graceCeiling: number;
}

export const QUANTISE_DEFAULTS: QuantiseSettings = {
    clusterMs: 35,
    noiseMs: 20,
    rubato: 0.08,
    chordMs: 30,
    graceShare: 0.05,
    graceMs: 150,
    graceSpread: 0.95,
    graceThird: 0.5,
    graceLeap: 0.15,
    fastestMs: 45,
    spreadMs: 100,
    graceCeiling: 0.5,
};

/** Degrees of freedom of the timing error: heavy-tailed, as rubato is. */
const TAIL = 3;

/** -log of a Student-t density with {@link TAIL} degrees of freedom and the given scale. */
const timingCost = (error: number, scale: number): number => {
    // Γ(2) / (√(3π) Γ(3/2)) = 2 / (π √3)
    const z = error / scale;
    return Math.log(scale) - Math.log(2 / (Math.PI * Math.sqrt(3))) + ((TAIL + 1) / 2) * Math.log(1 + (z * z) / TAIL);
};

/** -log of a log-normal density. */
const logNormalCost = (value: number, medianValue: number, spread: number): number => {
    if (value <= 0) return Infinity;
    const z = (Math.log(value) - Math.log(medianValue)) / spread;
    return Math.log(value * spread * Math.sqrt(2 * Math.PI)) + 0.5 * z * z;
};

/** Gather played notes into moments. */
function clusterPlayed(played: readonly Played[], clusterMs: number): Cluster[] {
    const sorted = [...played].sort((a, b) => a.onsetMs - b.onsetMs || a.pitch - b.pitch);
    const clusters: Cluster[] = [];
    for (const note of sorted) {
        const current = clusters[clusters.length - 1];
        if (current && note.onsetMs - current.ms <= clusterMs) current.notes.push(note);
        else clusters.push({ notes: [note], ms: note.onsetMs });
    }
    return clusters;
}

interface Candidate {
    onset: number;
    level: Level;
    /** The anchor it stands on, where it stands on one */
    anchor?: Anchor;
    /** P(place) while the candidates are gathered, and -log of it over the gap once they are */
    prior: number;
}

/**
 * Place every played note.
 *
 * The notes are taken a gap at a time, a gap being the stretch between two matched moments that
 * follow each other in the score: a note struck between them belongs between them, on one of
 * them, or leaning on whatever comes next.
 */
export function quantise(
    model: ScoreModel,
    map: TimeMap,
    played: readonly Played[],
    options: QuantiseOptions = {},
): Quantised[] {
    const settings = { ...QUANTISE_DEFAULTS, ...options.settings };
    const clusters = clusterPlayed(played, settings.clusterMs);
    const levels = surroundingsOf(model, options.hidden);

    // By gap, keeping the order they were played in
    const byGap = new Map<number, Cluster[]>();
    const results = new Map<Cluster, Quantised>();
    for (const cluster of clusters) {
        const reach = reachOf(map, cluster.ms, settings.chordMs);
        const gap = intervalAt(map, cluster.ms);

        if (gap < 0 && reach === undefined) {
            results.set(cluster, unplaced(cluster, "Played before the first note the score accounts for."));
            continue;
        }
        if (gap >= map.anchors.length - 1 && reach === undefined) {
            results.set(cluster, unplaced(cluster, "Played after the last note the score accounts for."));
            continue;
        }
        if (reach === undefined && isUnaccounted(map, gap)) {
            results.set(
                cluster,
                unplaced(
                    cluster,
                    "Played in a stretch of the recording the score has nothing written for: " +
                        "a repeat shown once, or a passage this edition does not have.",
                ),
            );
            continue;
        }

        // A note inside the first or last chord's own spread has a gap on one side only
        const index = Math.min(Math.max(gap, 0), map.anchors.length - 2);
        const list = byGap.get(index);
        if (list) list.push(cluster);
        else byGap.set(index, [cluster]);
    }

    for (const [gap, inGap] of byGap) {
        const solved = solveGap(model, map, gap, inGap, clusters, levels, settings, options.force);
        solved.forEach((entry) => results.set(entry.cluster, entry));
    }

    return clusters.map((cluster) => results.get(cluster) ?? unplaced(cluster, "Not placed."));
}

const unplaced = (cluster: Cluster, because: string): Quantised => ({
    cluster,
    placement: { kind: "unplaced", because },
    confidence: 1,
    graceable: false,
    places: [],
});

/** The anchor whose own notes a moment falls among, if it falls among any. */
function reachOf(map: TimeMap, ms: number, chordMs: number): Anchor | undefined {
    const index = intervalAt(map, ms);
    for (const candidate of [map.anchors[index], map.anchors[index + 1]]) {
        if (candidate && ms >= candidate.first - chordMs && ms <= candidate.last + chordMs) {
            return candidate;
        }
    }
    return undefined;
}

/**
 * How many written onsets lie at each metrical level in the bars around a measure.
 *
 * The bar itself and one either side, every staff together: wide enough to know the figuration
 * and narrow enough to follow it when it changes.
 */
interface Surroundings {
    /** How many written onsets lie at each level */
    levels: Map<Level, number>;
    /** The step the quickest written notes move in, in quarter notes */
    quickest: number;
}

function surroundingsOf(
    model: ScoreModel,
    hidden: ReadonlySet<ScoreEvent> | undefined,
): (measure: MeasureModel) => Surroundings {
    const perMeasure = new Map<MeasureModel, { counts: Map<Level, number>; onsets: number[] }>();

    const own = (measure: MeasureModel): { counts: Map<Level, number>; onsets: number[] } => {
        const cached = hidden ? undefined : perMeasure.get(measure);
        if (cached) return cached;

        const onsets = new Set<number>();
        for (const staff of measure.staves) {
            for (const layer of staff.layers) {
                for (const event of layer.events) {
                    if (event.grace || event.notes.length === 0) continue;
                    if (hidden?.has(event)) continue;
                    onsets.add(Math.round((event.onset - measure.onset) * 1e6) / 1e6);
                }
            }
        }
        const counts = new Map<Level, number>();
        for (const onset of onsets) {
            const level = levelOf(onset, measure.meter);
            counts.set(level, (counts.get(level) ?? 0) + 1);
        }
        const entry = { counts, onsets: [...onsets].map((onset) => onset + measure.onset) };
        if (!hidden) perMeasure.set(measure, entry);
        return entry;
    };

    return (measure) => {
        const levels = new Map<Level, number>();
        const onsets: number[] = [];
        for (const index of [measure.index - 1, measure.index, measure.index + 1]) {
            const neighbour = model.measures[index];
            if (!neighbour) continue;
            const entry = own(neighbour);
            onsets.push(...entry.onsets);
            for (const [level, count] of entry.counts) {
                levels.set(level, (levels.get(level) ?? 0) + count);
            }
        }

        // The lower quartile of the steps between one written moment and the next: quick
        // enough to be the figuration, and not the one grace-like value in three bars
        onsets.sort((a, b) => a - b);
        const steps: number[] = [];
        for (let index = 1; index < onsets.length; index++) {
            const step = onsets[index] - onsets[index - 1];
            if (step > 1e-6) steps.push(step);
        }
        steps.sort((a, b) => a - b);
        const quickest = steps.length > 0 ? steps[Math.floor(steps.length / 4)] : 1;

        return { levels, quickest };
    };
}

/** How far around the place the timing points at a wide gap is searched, in quarter notes. */
const SEARCH = 4;

function solveGap(
    model: ScoreModel,
    map: TimeMap,
    gap: number,
    clusters: Cluster[],
    all: Cluster[],
    levels: (measure: MeasureModel) => Surroundings,
    settings: QuantiseSettings,
    force: QuantiseOptions["force"],
): Quantised[] {
    const before = map.anchors[gap];
    const after = map.anchors[gap + 1];
    const span = after.ms - before.ms;
    const pace = localPace(map, gap);

    // The finest step the fingers could have meant, at the pace of the passage
    const finest = settings.fastestMs / pace;

    const firstMs = clusters[0].ms;
    const lastMs = clusters[clusters.length - 1].ms;
    const pointsAt = (ms: number) =>
        before.onset + Math.min(1, Math.max(0, (ms - before.ms) / span)) * (after.onset - before.onset);
    const from = Math.max(before.onset, pointsAt(firstMs) - SEARCH);
    const to = Math.min(after.onset, pointsAt(lastMs) + SEARCH);

    // Every place a note of this gap could be written at: the two anchors, and the grid between
    const candidates: Candidate[] = [];
    const add = (onset: number, anchor: Anchor | undefined) => {
        const measure = measureAt(model, onset);
        if (!measure) return;
        const level = levelOf(onset - measure.onset, measure.meter);
        const share =
            levelPrior(levels(measure).levels, measure.meter)(level) / placesAt(level, measure.meter);
        candidates.push({ onset, level, anchor, prior: share });
    };

    add(before.onset, before);
    let measure = measureAt(model, from);
    while (measure && measure.onset < to) {
        for (const onset of gridPositions(measure, Math.max(from, before.onset), Math.min(to, after.onset), finest)) {
            add(onset, undefined);
        }
        measure = model.measures[measure.index + 1];
    }
    add(after.onset, after);

    // The shares become a distribution over the places of this gap, and then a cost
    const total = candidates.reduce((sum, candidate) => sum + candidate.prior, 0);
    for (const candidate of candidates) candidate.prior = -Math.log(candidate.prior / total);

    /** -log p(this moment | written at this candidate) */
    const fit = (candidate: Candidate, cluster: Cluster): number => {
        const { ms } = cluster;
        if (candidate.anchor) {
            // Struck with a written chord means struck with one of its notes. The chord's own
            // spread is no measure of that: these pianists set one hand a tenth of a second
            // before the other, and a note between the two is with neither.
            let nearest = Infinity;
            for (const note of candidate.anchor.notes) nearest = Math.min(nearest, Math.abs(ms - note.ms));
            return timingCost(nearest, settings.chordMs);
        }

        // Read between the two anchors in the hand that played it. The median of a chord is
        // the wrong clock for a melody whose bass arrives a tenth of a second early: the note
        // of each anchor nearest in pitch is the one that was played by the same hand.
        const pitch = cluster.notes[0].pitch;
        const start = handTime(before, pitch);
        const end = handTime(after, pitch);
        const share = (candidate.onset - before.onset) / (after.onset - before.onset);
        const expected = start + share * (end - start);
        const scale = Math.sqrt(
            settings.noiseMs ** 2 + (settings.rubato * (end - start)) ** 2 * 4 * share * (1 - share),
        );
        return timingCost(ms - expected, scale);
    };

    const places = candidates.map((candidate) => candidate.onset);

    // What a reader has put somewhere is there. It is taken out of the question before the
    // others are asked it, so that one note moved by hand cannot make the rest unplaceable.
    const pinned = new Map<Cluster, Candidate>();
    for (const cluster of clusters) {
        const asked = force?.(cluster);
        if (asked?.onset === undefined || asked.kind === "grace") continue;
        const at = candidates.find((candidate) => Math.abs(candidate.onset - (asked.onset ?? NaN)) < 1e-6);
        if (at) pinned.set(cluster, at);
    }
    const everything = clusters;
    clusters = clusters.filter((cluster) => !pinned.has(cluster));

    const settled: Quantised[] = [...pinned].map(([cluster, candidate]) => ({
        cluster,
        placement: {
            kind: "measured",
            onset: candidate.onset,
            level: candidate.level,
            coincides: candidate.anchor !== undefined,
        },
        confidence: 1,
        measured: { onset: candidate.onset, level: candidate.level, coincides: candidate.anchor !== undefined },
        graceable: true,
        places,
    }));
    if (clusters.length === 0) return settled;

    // A grace note is quicker than anything the bars around it write. Where the left hand runs
    // in sixteenths a tenth of a second apart, a note a tenth of a second before the next is
    // one of them; in a nocturne's quavers the same tenth of a second is an acciaccatura.
    const home = measureAt(model, pointsAt(firstMs));
    const ceiling = home
        ? settings.graceCeiling * levels(home).quickest * pace
        : Infinity;

    // What each cluster costs in each state. The last state is the grace note.
    const GRACE = candidates.length;
    const measuredShare = -Math.log(1 - settings.graceShare);
    const graceShare = -Math.log(settings.graceShare);

    const costs = clusters.map((cluster) => {
        const forced = force?.(cluster)?.kind;
        const row = candidates.map((candidate) =>
            forced === "grace" ? Infinity : measuredShare + candidate.prior + fit(candidate, cluster),
        );

        // A grace note leans on whatever sounds next: the next played moment, or the next
        // written one, whichever comes first
        const next = nextMoment(cluster, all, map, settings.clusterMs);
        const lean = next === undefined ? Infinity : next.ms - cluster.ms;
        const grace =
            forced === "measured" || (forced !== "grace" && lean > ceiling)
                ? Infinity
                : graceShare +
                  stepCost(cluster, next?.pitches ?? [], settings) +
                  logNormalCost(lean, settings.graceMs, settings.graceSpread);
        row.push(forced === "grace" && !Number.isFinite(grace) ? 0 : grace);
        return row;
    });

    // Viterbi. A later moment may not be written before an earlier one, and two moments at one
    // place pay for it unless that place is a written chord they are both part of.
    const best: number[][] = [];
    const back: number[][] = [];
    costs.forEach((row, k) => {
        best.push(new Array<number>(row.length).fill(Infinity));
        back.push(new Array<number>(row.length).fill(-1));
        if (k === 0) {
            row.forEach((cost, state) => (best[0][state] = cost));
            return;
        }

        for (let state = 0; state <= GRACE; state++) {
            if (!Number.isFinite(row[state])) continue;
            for (let previous = 0; previous <= GRACE; previous++) {
                const carried = best[k - 1][previous];
                if (!Number.isFinite(carried)) continue;

                let step = 0;
                if (state !== GRACE && previous !== GRACE) {
                    if (previous > state) continue;
                    if (previous === state && !candidates[state].anchor) {
                        // Two moments at one place are a chord with its notes struck apart,
                        // which costs what that much spread is unlikely
                        const apart = (clusters[k].ms - clusters[k - 1].ms) / settings.spreadMs;
                        step = ((TAIL + 1) / 2) * Math.log(1 + (apart * apart) / TAIL);
                    }
                } else if (state !== GRACE && previous === GRACE) {
                    // What a grace note leans on is written after everything before the grace
                    const earlier = lastMeasured(back, best, k - 1, GRACE);
                    if (earlier > state) continue;
                }

                const cost = carried + step + row[state];
                if (cost < best[k][state]) {
                    best[k][state] = cost;
                    back[k][state] = previous;
                }
            }
        }
    });

    const states = new Array<number>(clusters.length).fill(GRACE);
    let state = argmin(best[best.length - 1]);
    for (let k = clusters.length - 1; k >= 0; k--) {
        states[k] = state;
        state = back[k][state];
    }

    const solved: Quantised[] = clusters.map((cluster, k) => {
        const row = costs[k];
        const chosen = states[k];
        const finite = row.filter((cost) => Number.isFinite(cost));
        const floor = Math.min(...finite);
        const mass = finite.reduce((sum, cost) => sum + Math.exp(floor - cost), 0);
        const confidence = Number.isFinite(row[chosen]) ? Math.exp(floor - row[chosen]) / mass : 0;

        const bestMeasured = argmin(row.slice(0, GRACE));
        const measured =
            bestMeasured >= 0 && Number.isFinite(row[bestMeasured])
                ? {
                      onset: candidates[bestMeasured].onset,
                      level: candidates[bestMeasured].level,
                      coincides: candidates[bestMeasured].anchor !== undefined,
                  }
                : undefined;

        const next = nextMoment(cluster, all, map, settings.clusterMs);
        const graceable = next !== undefined && next.ms - cluster.ms <= GRACE_REACH_MS;

        const placement: Placement =
            chosen === GRACE
                ? { kind: "grace" }
                : {
                      kind: "measured",
                      onset: candidates[chosen].onset,
                      level: candidates[chosen].level,
                      coincides: candidates[chosen].anchor !== undefined,
                  };

        return { cluster, placement, confidence, measured, graceable, places };
    });

    // In the order they were played, the pinned ones among the rest
    return everything.map(
        (cluster) => solved.find((entry) => entry.cluster === cluster) ?? settled.find((entry) => entry.cluster === cluster)!,
    );
}

/** When the note of an anchor nearest a pitch was struck: the same hand's, as near as can be told. */
function handTime(anchor: Anchor, pitch: number): number {
    let best = anchor.ms;
    let distance = Infinity;
    for (const note of anchor.notes) {
        const away = Math.abs(note.pitch - pitch);
        if (away < distance) {
            distance = away;
            best = note.ms;
        }
    }
    return best;
}

/** The longest a grace note is offered for: beyond this a note has a length of its own. */
const GRACE_REACH_MS = 400;

/** The last state before `k` that is a place on the grid, following the path back. */
function lastMeasured(back: number[][], best: number[][], k: number, grace: number): number {
    let state = grace;
    for (let step = k; step >= 0; step--) {
        if (state !== grace) return state;
        const previous = back[step][state];
        if (previous < 0) return -1;
        state = previous;
    }
    void best;
    return state === grace ? -1 : state;
}

const argmin = (values: number[]): number => {
    let index = -1;
    let least = Infinity;
    values.forEach((value, at) => {
        if (value < least) {
            least = value;
            index = at;
        }
    });
    return index;
};

/** When the next thing after a cluster sounds, a played moment or a written one, and what. */
function nextMoment(
    cluster: Cluster,
    all: Cluster[],
    map: TimeMap,
    clusterMs: number,
): { ms: number; pitches: number[] } | undefined {
    let next: { ms: number; pitches: number[] } | undefined;

    const index = all.indexOf(cluster);
    const following = all[index + 1];
    if (following) next = { ms: following.ms, pitches: following.notes.map((note) => note.pitch) };

    const gap = intervalAt(map, cluster.ms);
    for (let at = Math.max(0, gap); at < map.anchors.length; at++) {
        const anchor = map.anchors[at];
        // The first note of a written chord is when it starts to sound
        if (anchor.first > cluster.ms + clusterMs) {
            if (next === undefined || anchor.first < next.ms) {
                next = { ms: anchor.first, pitches: anchor.notes.map((note) => note.pitch) };
            }
            break;
        }
    }
    return next;
}

/**
 * What it costs a note to be a grace note, for how far it lies from what it leans on.
 *
 * A grace note that is a step from its note is the ordinary acciaccatura. One a sixth or an
 * octave away is far more often a note of the chord struck early, which these pianists do all
 * the time and which is not a different text but a different way of playing the same one.
 */
function stepCost(cluster: Cluster, onto: number[], settings: QuantiseSettings): number {
    let nearest = Infinity;
    for (const note of cluster.notes) {
        for (const pitch of onto) nearest = Math.min(nearest, Math.abs(note.pitch - pitch));
    }
    if (nearest <= 2) return 0;
    return -Math.log(nearest <= 4 ? settings.graceThird : settings.graceLeap);
}
