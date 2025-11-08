type Interval = {
    start: number; // e.g., ms since epoch (or any comparable scalar)
    end: number;   // must satisfy end >= start
};

type LayoutOptions = {
    // consider two intervals overlapping if next.start < prev.end + trackPadding
    trackPadding?: number;     // default 0 (in timeline units)
    // optional mapping to pixels
    viewport?: { pxWidth: number; timeStart: number; timeEnd: number };
};

type Placed = Interval & {
    track: number; // vertical lane index, 0-based
    // pixel positioning (if viewport provided)
    x?: number;
    w?: number;
};

// Simple min-heap keyed by "track availability time"
class MinHeap<T> {
    private a: T[] = [];
    constructor(private key: (v: T) => number) { }
    push(v: T) { this.a.push(v); this.bubbleUp(this.a.length - 1); }
    peek(): T | undefined { return this.a[0]; }
    pop(): T | undefined {
        if (this.a.length === 0) return undefined;
        const top = this.a[0], last = this.a.pop()!;
        if (this.a.length) { this.a[0] = last; this.bubbleDown(0); }
        return top;
    }
    private bubbleUp(i: number) {
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.key(this.a[i]) >= this.key(this.a[p])) break;
            [this.a[i], this.a[p]] = [this.a[p], this.a[i]];
            i = p;
        }
    }
    private bubbleDown(i: number) {
        for (; ;) {
            const l = i * 2 + 1;
            const r = l + 1
            let m = i;
            
            if (l < this.a.length && this.key(this.a[l]) < this.key(this.a[m])) m = l;
            if (r < this.a.length && this.key(this.a[r]) < this.key(this.a[m])) m = r;
            if (m === i) break;
            [this.a[i], this.a[m]] = [this.a[m], this.a[i]];
            i = m;
        }
    }
    get size() { return this.a.length; }
}

export function layoutIntervals<T extends Interval>(
    intervals: T[],
    opts: LayoutOptions = {}
): (Placed & T)[] {
    const pad = opts.trackPadding ?? 0;

    // Sort by start time, tie-break by longer first (helps packing visually)
    const sorted = [...intervals].sort((a, b) =>
        a.start !== b.start ? a.start - b.start : (b.end - b.start) - (a.end - a.start)
    );

    // Each heap item tracks when a track becomes free again and which index it is
    type TrackState = { track: number; availableAt: number };
    const heap = new MinHeap<TrackState>(t => t.availableAt);
    const trackCountForNow = () => heap.size; // used only for intuition

    const placed: (Placed & T)[] = [];

    for (const it of sorted) {
        // Reuse the earliest-free track if it’s available before this starts
        const top = heap.peek();
        if (top && it.start >= top.availableAt + pad) {
            const t = heap.pop()!;
            placed.push({ ...it, track: t.track });
            // update availability for that track
            heap.push({ track: t.track, availableAt: it.end });
        } else {
            // need a new track
            const newTrack = trackCountForNow();
            placed.push({ ...it, track: newTrack });
            heap.push({ track: newTrack, availableAt: it.end });
        }
    }

    // Optional pixel mapping
    const vp = opts.viewport;
    if (vp) {
        const span = Math.max(1, vp.timeEnd - vp.timeStart); // avoid div by zero
        for (const p of placed) {
            const clampedStart = Math.max(p.start, vp.timeStart);
            const clampedEnd = Math.min(p.end, vp.timeEnd);
            p.x = ((clampedStart - vp.timeStart) / span) * vp.pxWidth;
            p.w = Math.max(0, ((clampedEnd - clampedStart) / span) * vp.pxWidth);
        }
    }

    // Keep original order if needed by caller; otherwise, return as placed
    return placed;
}
