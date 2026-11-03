/**
 * The reconstruction's instructions as signs in the score: what the band draws over the notes.
 *
 * Every MPM instruction a segment claims becomes a mark a musician would recognise, placed at
 * the stretch of music the instruction acts on and drawn to its own values, so that two
 * instructions of a kind differ on the page as they differ in the sound:
 *
 * - `<tempo>`: a flat line over the stretch it governs, its arrow pointing right where it moves
 *   forward and left where it slows down; a constant tempo has no arrow.
 * - `<dynamics>`: a hairpin opened as far as the volume changes.
 * - `<rubato>`: a slur over the notes of its frame, read as the old practice reads one: the
 *   first note under it lengthened.
 * - `<accentuationPattern>`: a stress mark on every beat the pattern weights, `>` for the strong
 *   and `◡` for the weak, as large as the velocity it adds or takes; a level dash where it weights
 *   nothing audible.
 * - `<articulation>`: staccato, staccatissimo, tenuto or an accent at the note, and a held arc
 *   as long as a note is held over.
 * - `<ornament>`: an arpeggio line before the chord, its head showing which way it rolls.
 * - `<movement>`: a pedal line below the staves, tracing how far the pedal is down.
 *
 * Pure: everything it needs to know about the engraving comes in as {@link BandGeometry}, which
 * the band measures off the rendered score.
 */
import type { Segment } from '../../model/Reconstruction';
import type { Instruction, PerformanceReader } from '../../utils/mpm';
import { beatTicksAt } from '../../utils/score';
import { timeSignatureAt } from '../../fitting/timeSignature';

export interface NotePlacement {
    /** The notehead's left edge, in the band's pixels. */
    x: number;
    width: number;
    top: number;
    bottom: number;
    /** 1 for the upper staff. */
    staff: number;
}

export interface BandGeometry {
    /** The band's pixel for a tick — the tree's own axis. */
    x: (tick: number) => number;
    staffSpace: number;
    /** By staff number. */
    staves: ReadonlyMap<number, { top: number; bottom: number }>;
    /** Where each notehead was engraved, by the note's `xml:id`. */
    notes: ReadonlyMap<string, NotePlacement>;
    /** Notated date and duration of every note, by `xml:id`. */
    scoreNotes: ReadonlyMap<string, { date: number; duration: number }>;
    /** Where the piece ends, for instructions that hold to the end. */
    end: number;
}

export interface Sign {
    /** The MPM instruction this is the sign of. */
    elementId: string;
    type: string;
    /** Every segment claiming it — a dynamics endpoint can be two segments' business. */
    segmentIds: string[];
    /** The span it belongs to in the first of them. */
    spanId: string;
    /** Path data drawn with a stroke… */
    stroke: string;
    /** …and drawn filled: arrowheads, dots, wedges. */
    fill: string;
    dashed?: boolean;
    /** Where a pointer is most likely to be, for anchoring the instruction's card. */
    anchor: { x: number; y: number };
}

/** The lanes the signs are set in, from the staves outward. */
interface Lanes {
    stress: number;
    tempo: number;
    hairpin: number;
    pedal: number;
    soft: number;
}

const r = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The attributes of an MPM element, read off the same serialisation the attribute view quotes. */
const attributesOf = (xml: string | undefined): { attrs: Record<string, string>; children: Record<string, string>[] } => {
    if (!xml) return { attrs: {}, children: [] };
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const root = doc.documentElement;
    const read = (element: Element) =>
        Object.fromEntries([...element.attributes].map((a) => [a.localName === 'id' ? 'xml:id' : a.name, a.value]));
    return { attrs: read(root), children: [...root.children].map((child) => ({ ...read(child), '#name': child.localName })) };
};

const num = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return value !== undefined && Number.isFinite(n) ? n : fallback;
};

/** A filled arrowhead with its tip at (x, y), pointing along `angle`. */
const arrowHead = (x: number, y: number, angle: number, size: number) => {
    const back = (a: number) => [x - size * Math.cos(angle + a), y - size * Math.sin(angle + a)];
    const [x1, y1] = back(0.42);
    const [x2, y2] = back(-0.42);
    return `M${r(x)} ${r(y)}L${r(x1)} ${r(y1)}L${r(x2)} ${r(y2)}Z`;
};

const polyline = (points: [number, number][]) =>
    points.map(([x, y], i) => `${i ? 'L' : 'M'}${r(x)} ${r(y)}`).join('');

export function laneLayout(g: BandGeometry): Lanes {
    const ss = g.staffSpace;
    const upper = g.staves.get(1) ?? { top: 0, bottom: 4 * ss };
    const lower = g.staves.get(2) ?? { top: upper.bottom + 6 * ss, bottom: upper.bottom + 10 * ss };
    let ceiling = upper.top;
    let floor = lower.bottom;
    for (const note of g.notes.values()) {
        if (note.staff === 1) ceiling = Math.min(ceiling, note.top);
        else floor = Math.max(floor, note.bottom);
    }
    return {
        stress: ceiling - 0.9 * ss,
        // Clear of the highest slur arch, which stands at most 2.8 staff spaces over its notes.
        tempo: ceiling - 3.5 * ss,
        hairpin: (upper.bottom + lower.top) / 2,
        pedal: floor + 2.6 * ss,
        soft: floor + 4.4 * ss,
    };
}

interface Drawn {
    stroke: string;
    fill: string;
    dashed?: boolean;
    anchor: { x: number; y: number };
}

export function buildSigns(segments: readonly Segment[], mpm: PerformanceReader, g: BandGeometry): Sign[] {
    const ss = g.staffSpace;
    const lanes = laneLayout(g);
    const X = (tick: number) => g.x(Math.min(tick, g.end));
    const onsets = new Map<number, string[]>();
    for (const [id, note] of g.scoreNotes) {
        const at = onsets.get(note.date);
        if (at) at.push(id);
        else onsets.set(note.date, [id]);
    }
    const dates = [...onsets.keys()].sort((a, b) => a - b);
    const reachEnd = (instruction: Instruction) => {
        const to = mpm.reachOf(instruction).to;
        return Number.isFinite(to) ? to : g.end;
    };

    const tempo = (i: Instruction): Drawn | null => {
        const t = mpm.tempoOf(i);
        if (!t) return null;
        const x0 = X(i.date) + 0.2 * ss;
        const x1 = Math.max(x0 + ss, X(reachEnd(i)) - 0.3 * ss);
        const y = lanes.tempo;
        const line = polyline([[x0, y], [x1, y]]);
        const anchor = { x: (x0 + x1) / 2, y };
        if (t.kind !== 'transitioning' || t.transitionTo === t.bpm) return { stroke: line, fill: '', anchor };
        // Forward to the right, holding back to the left.
        const forward = t.transitionTo > t.bpm;
        return {
            stroke: line,
            fill: forward ? arrowHead(x1, y, 0, 0.8 * ss) : arrowHead(x0, y, Math.PI, 0.8 * ss),
            anchor,
        };
    };

    const dynamics = (i: Instruction): Drawn | null => {
        const d = mpm.dynamicsOf(i);
        if (!d) return null;
        const x0 = X(i.date) + 0.2 * ss;
        const x1 = Math.max(x0 + ss, X(reachEnd(i)) - 0.4 * ss);
        const y = lanes.hairpin;
        const change = d.transitionTo - d.volume;
        if (Math.abs(change) < 0.5) {
            const gap = 0.2 * ss;
            return { stroke: `${polyline([[x0, y - gap], [x1, y - gap]])}${polyline([[x0, y + gap], [x1, y + gap]])}`, fill: '', anchor: { x: (x0 + x1) / 2, y } };
        }
        const w = clamp(Math.abs(change) * 0.16 * ss, 0.45 * ss, 1.8 * ss) / 2;
        const [closed, open] = change > 0 ? [x0, x1] : [x1, x0];
        return {
            stroke: `${polyline([[open, y - w], [closed, y], [open, y + w]])}`,
            fill: '',
            anchor: { x: (x0 + x1) / 2, y },
        };
    };

    /** The topmost of these noteheads, or the staff's top line where that is higher. */
    const upperTop = g.staves.get(1)?.top ?? lanes.stress + 0.9 * ss;
    const localTop = (heads: readonly NotePlacement[]) => Math.min(upperTop, ...heads.map((n) => n.top));
    /** The noteheads struck at `date` on the upper staff, or on any where it has none. */
    const headsAt = (date: number) => {
        const heads = (onsets.get(date) ?? []).map((id) => g.notes.get(id)).filter((n): n is NotePlacement => !!n);
        const upper = heads.filter((n) => n.staff === 1);
        return upper.length ? upper : heads;
    };

    const rubato = (i: Instruction): Drawn | null => {
        const { attrs } = attributesOf(i.element.toXML());
        const length = num(attrs.frameLength, 0);
        if (length <= 0) return null;
        const struck = dates.filter((d) => d >= i.date && d < i.date + length).map(headsAt).filter((h) => h.length);
        if (struck.length === 0) return null;
        const centre = (heads: readonly NotePlacement[]) => {
            const top = heads.reduce((a, b) => (b.top < a.top ? b : a));
            return top.x + top.width / 2;
        };
        // From the first note of the frame to its last; a frame struck once reaches to its end.
        const xa = centre(struck[0]);
        const xb = struck.length > 1 ? centre(struck[struck.length - 1]) : Math.max(xa + ss, X(i.date + length) - 0.3 * ss);
        // Over the stress marks of its own notes, as a slur stands over the articulation it binds.
        const y = localTop(struck.flat()) - 1.8 * ss;
        const arch = clamp((xb - xa) * 0.12, 0.5 * ss, 1.0 * ss);
        const thick = 0.24 * ss;
        const third = (xb - xa) / 3;
        const outer = y - arch / 0.75;
        const inner = y - (arch - thick) / 0.75;
        const fill =
            `M${r(xa)} ${r(y)}C${r(xa + third)} ${r(outer)} ${r(xb - third)} ${r(outer)} ${r(xb)} ${r(y)}` +
            `C${r(xb - third)} ${r(inner)} ${r(xa + third)} ${r(inner)} ${r(xa)} ${r(y)}Z`;
        return { stroke: '', fill, anchor: { x: (xa + xb) / 2, y: y - arch } };
    };

    const accentuation = (i: Instruction): Drawn | null => {
        const { attrs } = attributesOf(i.element.toXML());
        const def = attributesOf(mpm.defFor(i)?.toXML());
        const scale = num(attrs.scale, 1);
        const length = num(def.attrs.length, 0);
        const accents = def.children
            .filter((child) => child['#name'] === 'accentuation')
            .map((child) => ({ beat: num(child.beat, NaN), value: num(child.value, 0) }))
            .filter((a) => Number.isFinite(a.beat))
            .sort((a, b) => a.beat - b.beat);
        if (!length || accents.length === 0) return null;
        const { from, to } = mpm.reachOf(i);
        const sticks = attrs.stickToMeasures !== 'false';
        let stroke = '';
        for (const date of dates) {
            if (date < from || date >= to) continue;
            const signature = timeSignatureAt(mpm.meter.signatures, date);
            const beatTicks = beatTicksAt(mpm.meter, date);
            const tsDate = signature?.date ?? 0;
            const cycle = sticks ? beatTicks * (signature?.numerator ?? 4) : length * beatTicks;
            const beat = 1 + ((date - tsDate) % cycle) / beatTicks;
            const at = accents.find((a) => Math.abs(a.beat - beat) < 1e-6);
            if (!at) continue;
            const weight = at.value * scale;
            if (Math.abs(weight) < 0.5) continue;
            const ids = onsets.get(date) ?? [];
            const tops = ids.map((id) => g.notes.get(id)).filter((n): n is NotePlacement => !!n && n.staff === 1);
            const x = tops.length ? Math.min(...tops.map((n) => n.x)) + tops[0].width / 2 : X(date);
            const y = localTop(tops) - 0.9 * ss;
            const size = clamp(Math.abs(weight) / 6, 0.4, 1.3) * ss;
            if (weight > 0) stroke += polyline([[x - size, y - size / 2], [x + size, y], [x - size, y + size / 2]]);
            else stroke += `M${r(x - size)} ${r(y - size / 3)}Q${r(x)} ${r(y + size)} ${r(x + size)} ${r(y - size / 3)}`;
        }
        // A pattern that weights nothing audibly is still there to be pointed at: a level dash.
        if (!stroke) stroke = polyline([[X(from), lanes.stress], [X(from) + 0.8 * ss, lanes.stress]]);
        return { stroke, fill: '', anchor: { x: X(from), y: lanes.stress } };
    };

    const articulation = (i: Instruction): Drawn | null => {
        const { attrs } = attributesOf(i.element.toXML());
        const def = attributesOf(mpm.defFor(i)?.toXML()).attrs;
        const noteId = (attrs.noteid ?? '').replace(/^#/, '');
        const note = g.notes.get(noteId);
        const score = g.scoreNotes.get(noteId);
        if (!note) return null;
        const above = note.staff === 1;
        const cx = note.x + note.width / 2;
        const edge = above ? note.top - 0.7 * ss : note.bottom + 0.7 * ss;
        const away = above ? -1 : 1;
        let stroke = '';
        let fill = '';
        const relDuration = def.relativeDuration !== undefined ? num(def.relativeDuration, 1) : null;
        if (relDuration !== null && relDuration > 1.08 && score) {
            const held = X(score.date + score.duration * relDuration);
            const y0 = above ? note.top - 0.2 * ss : note.bottom + 0.2 * ss;
            stroke += `M${r(note.x + note.width)} ${r(y0)}Q${r((note.x + held) / 2)} ${r(y0 + away * 1.1 * ss)} ${r(held)} ${r(y0)}`;
        } else if (relDuration !== null && relDuration < 0.45) {
            fill += polyline([[cx - 0.22 * ss, edge - away * 0.5 * ss], [cx + 0.22 * ss, edge - away * 0.5 * ss], [cx, edge + away * 0.3 * ss]]) + 'Z';
        } else if (relDuration !== null && relDuration < 0.85) {
            const rad = 0.2 * ss;
            fill += `M${r(cx - rad)} ${r(edge)}a${r(rad)} ${r(rad)} 0 1 0 ${r(2 * rad)} 0a${r(rad)} ${r(rad)} 0 1 0 ${r(-2 * rad)} 0Z`;
        } else if (relDuration !== null || def.absoluteDuration !== undefined) {
            stroke += polyline([[cx - 0.55 * ss, edge], [cx + 0.55 * ss, edge]]);
        }
        const relVelocity = def.relativeVelocity !== undefined ? num(def.relativeVelocity, 1) : 1;
        if (Math.abs(relVelocity - 1) > 0.02) {
            const y = edge + away * 0.9 * ss;
            const size = clamp(Math.abs(relVelocity - 1) * 5, 0.45, 1.1) * ss;
            if (relVelocity > 1) stroke += polyline([[cx - size, y - size / 2], [cx + size, y], [cx - size, y + size / 2]]);
            else stroke += `M${r(cx - size)} ${r(y - size / 3)}Q${r(cx)} ${r(y + size)} ${r(cx + size)} ${r(y - size / 3)}`;
        }
        if (!stroke && !fill) return null;
        return { stroke, fill, anchor: { x: cx, y: edge } };
    };

    const ornament = (i: Instruction): Drawn | null => {
        const { attrs } = attributesOf(i.element.toXML());
        const def = attributesOf(mpm.defFor(i)?.toXML());
        const spread = def.children.find((child) => child['#name'] === 'temporalSpread');
        const order = (attrs['note.order'] ?? '').trim();
        const named = order.startsWith('#') ? order.split(/\s+/).map((id) => id.replace(/^#/, '')) : null;
        const ids = named ?? onsets.get(i.date) ?? [];
        const heads = ids.map((id) => g.notes.get(id)).filter((n): n is NotePlacement => !!n);
        if (heads.length === 0) return null;
        const before = num(spread?.['frame.start'], 0) < 0;
        const x = Math.min(...heads.map((n) => n.x)) - (before ? 1.1 : 0.7) * ss;
        const top = Math.min(...heads.map((n) => n.top)) - 0.3 * ss;
        const bottom = Math.max(...heads.map((n) => n.bottom)) + 0.3 * ss;
        // Which way the chord rolls: the named order where there is one, else upwards.
        let rising = !order.startsWith('descending');
        if (named && named.length > 1) {
            const first = g.notes.get(named[0]);
            const last = g.notes.get(named[named.length - 1]);
            if (first && last) rising = last.top < first.top;
        }
        const amplitude = 0.16 * ss;
        const step = 0.5 * ss;
        const points: [number, number][] = [];
        for (let y = bottom, k = 0; y >= top; y -= step / 2, k++) points.push([x + (k % 2 ? amplitude : -amplitude), y]);
        if (!rising) points.reverse();
        const [tx, ty] = points[points.length - 1];
        return {
            stroke: polyline(points),
            fill: arrowHead(tx, ty + (rising ? -0.4 : 0.4) * ss, rising ? -Math.PI / 2 : Math.PI / 2, 0.6 * ss),
            anchor: { x, y: (top + bottom) / 2 },
        };
    };

    const movement = (i: Instruction): Drawn | null => {
        const m = mpm.movementOf(i);
        if (!m) return null;
        const soft = m.controller === 'soft';
        const base = soft ? lanes.soft : lanes.pedal;
        const depth = 1.3 * ss;
        const from = m.position;
        const to = m.kind === 'transitioning' ? m.transitionTo : from;
        if (from <= 0 && to <= 0) return null;
        const x0 = X(i.date);
        const x1 = Math.max(x0 + 0.5, X(reachEnd(i)));
        return {
            stroke: polyline([[x0, base - from * depth], [x1, base - to * depth]]),
            fill: '',
            dashed: soft,
            anchor: { x: (x0 + x1) / 2, y: base - depth / 2 },
        };
    };

    const draw: Record<string, (i: Instruction) => Drawn | null> = {
        tempo, dynamics, rubato, accentuationPattern: accentuation, articulation, ornament, movement,
    };

    const signs = new Map<string, Sign>();
    const closing: { id: string; segment: Segment; spanId: string }[] = [];
    const add = (id: string, segment: Segment, spanId: string, instruction: Instruction) => {
        const drawn = draw[instruction.type]?.(instruction);
        if (drawn) signs.set(id, { elementId: id, type: instruction.type, segmentIds: [segment.id], spanId, ...drawn });
    };
    for (const segment of segments) {
        for (const span of segment.spans) {
            for (const id of span.elements) {
                const instruction = mpm.byId(id);
                if (!instruction) continue;
                // A ramp's closing instruction is the next ramp's opening one: it is drawn by the
                // segment it opens, not by the one it closes.
                if (instruction.type === 'dynamics' && span.to > span.from && instruction.date >= span.to) {
                    closing.push({ id, segment, spanId: span.id });
                    continue;
                }
                const known = signs.get(id);
                if (known) {
                    if (!known.segmentIds.includes(segment.id)) known.segmentIds.push(segment.id);
                    continue;
                }
                add(id, segment, span.id, instruction);
            }
        }
    }
    // A closing instruction no segment opens is still drawn, under the one that closes it. One
    // that a segment opens is that segment's sign alone: lighting it with the segment it closes
    // would show the next ramp as part of a claim that ends where the ramp begins.
    for (const { id, segment, spanId } of closing) {
        if (signs.has(id)) continue;
        const instruction = mpm.byId(id);
        if (instruction) add(id, segment, spanId, instruction);
    }
    return [...signs.values()];
}
