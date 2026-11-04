/**
 * The data of welte225.org/journey/, the page that follows the roll from an idea to a physical
 * object: the reconstruction's claims, the MPM instructions drawn into the score, the performance
 * they render, the versions of the roll's text from R1 to R4, and the copy St2 that carries the
 * last of them.
 *
 * Everything the page draws is worked out here, with this repository's own code — the score band
 * is engraved and its signs built as the viewer engraves and builds them, the claims' words are
 * packed as the viewer packs them, the performance is rendered as playback renders it — so the
 * page itself needs nothing but a browser. It writes `journey/data.json` and `journey/score.svg`
 * into the checkout of welte225.org, beside the files it reads.
 *
 *     npx vite-node scripts/recordJourney.ts
 *
 * Run it after a change to the reconstruction or to the edition, and commit there.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

// The readers below parse XML with the platform's DOMParser, which node has not got.
const window = new JSDOM().window;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).DOMParser ??= window.DOMParser;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).XMLSerializer ??= window.XMLSerializer;

import { read } from 'midifile-ts';
import { publishedPath } from '../src/test/published';
import { parseWorkFile } from '../src/model/Work';
import { outcomesOf, projectReconstruction, type Segment } from '../src/model/Reconstruction';
import { readPerformance } from '../src/utils/mpm';
import { readMeter } from '../src/utils/score';
import { renderPerformance } from '../src/utils/espressivo';
import { asSpans, type NoteSpan, type PedalSpan } from '../src/performance/midiSpans';
import { loadVerovio, renderScore } from '../src/verovio/toolkit';
import { prepareBandMei, readScoreNotes, SYMBOLIC_RECORDING, type ScoreNote } from '../src/segment-stack/band/bandMei';
import { buildSigns, laneLayout, type BandGeometry, type NotePlacement } from '../src/segment-stack/band/signs';
import { encodingOf } from '../src/segment-stack/encoding';
import {
    arcPathD,
    containmentDepths,
    fadeOpacities,
    LINE_HEIGHT_RATIO,
    packLabels,
    pointSpanFallback,
    tickRange,
    treeGeometry,
    typeScale,
} from '../src/segment-stack/StackModel';
import { wordFor, wordWidth } from '../src/segment-stack/words';

/** How wide a bar is drawn: within what the viewer opens at, so the score reads as it does there. */
const BAR_PX = 260;

/**
 * The versions the page passes through, from the root of the stemma to the text of the copy it
 * ends on, with the sigla of the stemma of 16 September 2026. The edition stores no sigla (see
 * the README of welte225.org), so they are named here; a change of the stemma has to be
 * followed here by hand.
 */
const VERSIONS = [
    { siglum: 'R1', id: '0e5f443d-0dd9-4810-9dbe-7f5007df490f' },
    { siglum: 'R2', id: '19fd4209-81cc-4d03-b2c3-fc7518dbba14' },
    { siglum: 'R3', id: 'bab25aef-f80d-4ff0-b187-63030df8305a' },
    { siglum: 'R4', id: 'c9050e75-97a8-4862-9533-0f4b1439802b' },
];

/** The copy the page ends on. */
const COPY = { siglum: 'St2', id: '88460599-2e0d-4759-851c-903a5a521997' };

/** The system whose copies give a symbol its place: the red rolls, which share St1's axis. */
const T100 = 'https://w3id.org/reo/type/system/welte-t100';

const checkout = resolve(dirname(publishedPath('work')), '..');
const text = (file: string) => readFileSync(resolve(checkout, file), 'utf-8');

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------------------------
// The reconstruction: its claims and the instructions they are made of
// ---------------------------------------------------------------------------------------------

const scoreMsm = readFileSync(publishedPath('score'), 'utf-8');
const performanceMpm = readFileSync(publishedPath('performance'), 'utf-8');
const transcriptionMei = readFileSync(publishedPath('mei'), 'utf-8');
const workFile = parseWorkFile(readFileSync(publishedPath('work'), 'utf-8'));

const meter = readMeter(scoreMsm);
const mpm = readPerformance(performanceMpm, meter);
const { reconstruction } = projectReconstruction({
    title: workFile.name,
    author: '',
    claims: workFile.segments,
    outcomes: outcomesOf(workFile.provenance),
    elementTypes: new Map(mpm.instructions.map((instruction) => [instruction.id, instruction.type])),
});
const segments: Segment[] = reconstruction.segments;

const lastSignature = meter.signatures.at(-1);
const barTicks = ((lastSignature?.numerator ?? 4) * 4 * meter.ppq) / (lastSignature?.denominator ?? 4);
const pxPerTick = BAR_PX / barTicks;

const scoreNotes = readScoreNotes(scoreMsm);
const scoreNoteById = new Map(scoreNotes.map((note) => [note.id, note]));
const end = Math.max(0, ...scoreNotes.map((note) => note.date + note.duration));

// ---------------------------------------------------------------------------------------------
// The score band, engraved as the viewer engraves it, and measured off the SVG
// ---------------------------------------------------------------------------------------------

/** verovio's `scale` and `unit` for the band, as in `ScoreBand.tsx`. */
const SCALE = 40;
const UNIT = 9;
const PX_PER_TICK_PER_SCALE = ((UNIT * 10) / 1000) * (SCALE / 1000);

const toolkit = await loadVerovio();
const bandMei = prepareBandMei(transcriptionMei, scoreNotes).mei;
const engraving = renderScore(toolkit, bandMei, {
    performanceAlignment: true,
    performanceRecording: SYMBOLIC_RECORDING,
    performanceBreaks: 'time',
    performanceSystemDuration: 3600,
    performanceScale: Math.min(1000, Math.max(0.1, pxPerTick / PX_PER_TICK_PER_SCALE)),
    performanceUnmatched: 'plain',
    performanceVelocityOpacity: false,
    performanceRuler: false,
    adjustPageWidth: true,
    adjustPageHeight: true,
    scale: SCALE,
    unit: UNIT,
    pageMarginLeft: 0,
    pageMarginRight: 0,
    pageMarginTop: 0,
    pageMarginBottom: 0,
    // the same ids on every run, so that the file changes only where the engraving does
    xmlIdSeed: 225,
})[0] ?? '';
if (!engraving) throw new Error('The score could not be engraved');

/** The box a path's points and control points span: a little generous on curves, which is all a glyph needs. */
const pathBox = (d: string) => {
    const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
    let x = 0, y = 0, startX = 0, startY = 0, command = 'M';
    const xs: number[] = [];
    const ys: number[] = [];
    const take = (n: number) => tokens.splice(0, n).map(Number);
    const visit = (px: number, py: number) => { xs.push(px); ys.push(py); };
    while (tokens.length) {
        if (/[a-zA-Z]/.test(tokens[0] ?? '')) command = tokens.shift() as string;
        const relative = command === command.toLowerCase();
        const ox = relative ? x : 0;
        const oy = relative ? y : 0;
        switch (command.toUpperCase()) {
            case 'M': case 'L': case 'T': {
                const [a, b] = take(2);
                x = ox + a; y = oy + b; visit(x, y);
                if (command.toUpperCase() === 'M') { startX = x; startY = y; command = relative ? 'l' : 'L'; }
                break;
            }
            case 'H': x = (relative ? x : 0) + take(1)[0]; visit(x, y); break;
            case 'V': y = (relative ? y : 0) + take(1)[0]; visit(x, y); break;
            case 'C': {
                const [a, b, c, e, f, g] = take(6);
                visit(ox + a, oy + b); visit(ox + c, oy + e);
                x = ox + f; y = oy + g; visit(x, y);
                break;
            }
            case 'S': case 'Q': {
                const [a, b, c, e] = take(4);
                visit(ox + a, oy + b);
                x = ox + c; y = oy + e; visit(x, y);
                break;
            }
            case 'A': {
                const [, , , , , f, g] = take(7);
                x = ox + f; y = oy + g; visit(x, y);
                break;
            }
            case 'Z': x = startX; y = startY; break;
            default: tokens.shift();
        }
    }
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};

const measureEngraving = (svgText: string) => {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = doc.documentElement;
    const width = parseFloat(root.getAttribute('width') ?? '0');
    const height = parseFloat(root.getAttribute('height') ?? '0');
    const scaled = root.querySelector('svg.definition-scale');
    const viewBox = (scaled?.getAttribute('viewBox') ?? '0 0 1 1').split(/\s+/).map(Number);
    const u = width / viewBox[2];
    const margin = (root.querySelector('g.page-margin')?.getAttribute('transform') ?? '')
        .match(/translate\(\s*([-\d.]+)[,\s]+([-\d.]+)/);
    const [mx, my] = margin ? [Number(margin[1]), Number(margin[2])] : [0, 0];

    // Every glyph a notehead uses, by id, as the box it draws: flipped, as `scale(1,-1)` draws it.
    const glyphs = new Map<string, ReturnType<typeof pathBox>>();
    for (const g of root.querySelectorAll('defs > g[id]')) {
        const d = g.querySelector('path')?.getAttribute('d');
        if (d) {
            const box = pathBox(d);
            glyphs.set(g.id, { x0: box.x0, x1: box.x1, y0: -box.y1, y1: -box.y0 });
        }
    }

    const notes = new Map<string, NotePlacement & { y: number }>();
    for (const g of root.querySelectorAll('g.note[data-id]')) {
        const id = g.getAttribute('data-id');
        const use = g.querySelector('.notehead use');
        const transform = use?.getAttribute('transform')?.match(/translate\(\s*([-\d.]+)[,\s]+([-\d.]+)\)\s*scale\(\s*([-\d.]+)/);
        const glyph = glyphs.get((use?.getAttribute('xlink:href') ?? use?.getAttribute('href') ?? '').replace(/^#/, ''));
        if (!id || !transform || !glyph) continue;
        const [x, y, s] = transform.slice(1, 4).map(Number);
        const staff = Number(g.closest('g.staff')?.getAttribute('data-n') ?? 1);
        notes.set(id, {
            x: (mx + x + glyph.x0 * s) * u,
            width: (glyph.x1 - glyph.x0) * s * u,
            top: (my + y + glyph.y0 * s) * u,
            bottom: (my + y + glyph.y1 * s) * u,
            y: (my + y) * u,
            staff,
        });
    }

    const lineYs = (staff: Element) => [...staff.children]
        .filter((child) => child.tagName.toLowerCase() === 'path')
        .map((line) => Number((line.getAttribute('d') ?? '').match(/^M\s*[-\d.]+\s+([-\d.]+)/)?.[1]))
        .filter(Number.isFinite);
    const staves = new Map<number, { top: number; bottom: number }>();
    for (const g of root.querySelectorAll('g.staff[data-n]')) {
        const n = Number(g.getAttribute('data-n'));
        const ys = lineYs(g);
        if (staves.has(n) || ys.length === 0) continue;
        staves.set(n, { top: (my + Math.min(...ys)) * u, bottom: (my + Math.max(...ys)) * u });
    }

    // Where each bar begins: the left end of its first staff's lines.
    const bars: { n: number; x: number }[] = [];
    for (const g of root.querySelectorAll('g.measure')) {
        const n = Number(g.getAttribute('data-n'));
        const line = g.querySelector('g.staff > path')?.getAttribute('d')?.match(/^M\s*([-\d.]+)/);
        if (Number.isFinite(n) && line) bars.push({ n, x: (mx + Number(line[1])) * u });
    }

    return { width, height, notes, staves, bars };
};

const measured = measureEngraving(engraving);

const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

/** Where the engraving's own tick 0 lies, which the band shifts onto the axis, as in `ScoreBand.tsx`. */
const offset = median([...measured.notes].flatMap(([id, note]) => {
    const score = scoreNoteById.get(id);
    return score ? [note.x - score.date * pxPerTick] : [];
}));

const unshifted: BandGeometry = {
    x: (tick) => tick * pxPerTick,
    staffSpace: (() => {
        const upper = measured.staves.get(1);
        return upper ? (upper.bottom - upper.top) / 4 : 8;
    })(),
    staves: measured.staves,
    notes: new Map([...measured.notes].map(([id, note]) => [id, { ...note, x: note.x - offset }])),
    scoreNotes: new Map(scoreNotes.map((note) => [note.id, note])),
    end,
};
const lanes = laneLayout(unshifted);
const padTop = Math.max(4, unshifted.staffSpace - lanes.tempo);
const padBottom = Math.max(4, lanes.soft + 0.6 * unshifted.staffSpace - measured.height);
const bandHeight = Math.ceil(padTop + measured.height + padBottom);
const down = (y: number) => y + padTop;
const geometry: BandGeometry = {
    ...unshifted,
    staves: new Map([...unshifted.staves].map(([n, s]) => [n, { top: down(s.top), bottom: down(s.bottom) }])),
    notes: new Map([...unshifted.notes].map(([id, n]) => [id, { ...n, top: down(n.top), bottom: down(n.bottom) }])),
};

const signs = buildSigns(segments, mpm, geometry).map((sign) => {
    const instruction = mpm.byId(sign.elementId);
    return {
        id: sign.elementId,
        type: sign.type,
        segments: sign.segmentIds,
        stroke: sign.stroke,
        fill: sign.fill,
        ...(sign.dashed && { dashed: true }),
        ...(sign.weight !== undefined && sign.weight !== 1 && { weight: r2(sign.weight) }),
        anchor: { x: r1(sign.anchor.x), y: r1(sign.anchor.y) },
        encoding: instruction ? encodingOf(instruction.element.toXML()) : '',
    };
});

// ---------------------------------------------------------------------------------------------
// The claims, packed as the viewer packs them at this zoom
// ---------------------------------------------------------------------------------------------

const minPointSpan = pointSpanFallback(segments);
const depths = containmentDepths(segments);
const fontSizes = typeScale({ segments, minPointSpan, fontScale: 1, charsOf: (s) => wordFor(s).length });
const labels = packLabels({
    segments,
    depths,
    minPointSpan,
    stretchX: pxPerTick,
    metricsOf: (s) => {
        const fontSize = fontSizes.get(s.id) ?? 11;
        return { length: wordWidth(s, fontSize), lineHeight: fontSize * LINE_HEIGHT_RATIO };
    },
});
const tree = treeGeometry({ labels, minHeight: 0 });
const opacities = fadeOpacities({ segments, stretchX: pxPerTick, minPointSpan });

const claims = labels.map((label) => {
    const { from, to } = tickRange(label.segment, minPointSpan);
    return {
        id: label.segment.id,
        word: wordFor(label.segment),
        from: r1(from),
        to: r1(to),
        tick: r1(label.tick),
        side: label.side,
        offset: r1(label.offset),
        depth: label.depth,
        fontSize: r2(label.fontSize),
        d: arcPathD(label.length, label.side).replace(/-?\d+\.\d+/g, (n) => String(r1(Number(n)))),
        opacity: r2(opacities.get(label.segment.id) ?? 1),
    };
});

// ---------------------------------------------------------------------------------------------
// The performance the instructions render
// ---------------------------------------------------------------------------------------------

const spans = asSpans(read(renderPerformance({ msm: scoreMsm, mpm: performanceMpm })), true);
const performed = spans
    .filter((span): span is NoteSpan => span.type === 'note')
    .flatMap((span) => {
        const id = span.link?.split(' ')[0];
        return id && scoreNoteById.has(id)
            ? [{ id, pitch: span.pitch, on: span.onsetMs, off: span.offsetMs, velocity: span.velocity }]
            : [];
    });
const pedals = spans
    .filter((span): span is PedalSpan => span.type !== 'note')
    .map((span) => ({ type: span.type, on: span.onsetMs, off: span.offsetMs }));

// ---------------------------------------------------------------------------------------------
// The roll: the versions' text, symbol by symbol, and the copy that carries the last of them
// ---------------------------------------------------------------------------------------------

interface Hole {
    id: string;
    copy: string;
    track: number;
    from: number;
    to: number;
}

interface Carried {
    '@id': string;
    '@type': string;
    pitch?: number;
    expressionType?: string;
    carriers?: { '@id': string }[];
}

interface Edit {
    '@id': string;
    insert?: Carried[];
    delete?: string[];
    motivation?: string;
}

const edition = JSON.parse(text('edition.jsonld'));

/** A copy's places onto the axis: `x_axis = (x + shift) · scale`, see the README of welte225.org. */
const holes = new Map<string, Hole>();
const copyById = new Map<string, { siglum: string; system: string; toAxis: (x: number) => number }>();
for (const copy of edition.copies) {
    const alignment = copy.measurements?.alignment;
    const shift = alignment?.shift?.horizontal ?? 0;
    const scale = alignment?.scale ?? 1;
    const toAxis = (x: number) => (x + shift) * scale;
    copyById.set(copy['@id'], { siglum: copy.siglum, system: copy.production?.system?.['@id'] ?? '', toAxis });
    for (const hole of copy.production?.produced ?? []) {
        if (hole['@type'] !== 'HoleChain') continue;
        holes.set(hole['@id'], {
            id: hole['@id'],
            copy: copy['@id'],
            track: hole.vertical.from,
            from: toAxis(hole.horizontal.from),
            to: toAxis(hole.horizontal.to),
        });
    }
}

const versionById = new Map<string, { edits: Edit[] }>(edition.versions.map((v: { '@id': string; edits: Edit[] }) => [v['@id'], v]));
const motivationNote = new Map<string, string>(edition.motivations.map((m: { '@id': string; note?: string }) => [m['@id'], m.note ?? m['@id']]));

/** A symbol of the roll's text, by its id in the map that holds it. */
interface RollSymbol {
    kind: 'note' | 'expression';
    type?: string;
    pitch?: number;
    track: number;
    from: number;
    to: number;
    /** The index into VERSIONS of the version that brings it, and of the one that drops it. */
    since: number;
    until?: number;
    /** Why it came, and why it went: the motivation of the edit. */
    brought?: string;
    dropped?: string;
    /** The hole of the copy that carries it. */
    hole?: string;
}

const placeOf = (symbol: Carried) => {
    const carriers = (symbol.carriers ?? [])
        .map((carrier) => holes.get(carrier['@id']))
        .filter((hole): hole is Hole => hole !== undefined && copyById.get(hole.copy)?.system === T100);
    if (carriers.length === 0) return null;
    const tracks = carriers.map((hole) => hole.track);
    const track = median(tracks);
    const on = carriers.filter((hole) => hole.track === track);
    return {
        track,
        from: on.reduce((sum, hole) => sum + hole.from, 0) / on.length,
        to: on.reduce((sum, hole) => sum + hole.to, 0) / on.length,
        hole: carriers.find((hole) => hole.copy === COPY.id)?.id,
    };
};

const symbols = new Map<string, RollSymbol>();
const unplaced: string[] = [];
VERSIONS.forEach(({ id }, index) => {
    const version = versionById.get(id);
    if (!version) throw new Error(`The edition has no version ${id}`);
    for (const edit of version.edits) {
        const why = edit.motivation ? motivationNote.get(edit.motivation) : undefined;
        for (const gone of edit.delete ?? []) {
            const symbol = symbols.get(gone);
            if (symbol && symbol.until === undefined) {
                symbol.until = index;
                if (why) symbol.dropped = why;
            }
        }
        for (const carried of edit.insert ?? []) {
            const place = placeOf(carried);
            if (!place) {
                unplaced.push(carried['@id']);
                continue;
            }
            symbols.set(carried['@id'], {
                kind: carried['@type'] === 'note' ? 'note' : 'expression',
                ...(carried.expressionType && { type: carried.expressionType }),
                ...(carried.pitch !== undefined && { pitch: carried.pitch }),
                track: place.track,
                from: place.from,
                to: place.to,
                since: index,
                ...(why && index > 0 && { brought: why }),
                ...(place.hole && { hole: place.hole }),
            });
        }
    }
});

const copy = edition.copies.find((c: { '@id': string }) => c['@id'] === COPY.id);
const toCopyAxis = copyById.get(COPY.id)?.toAxis ?? ((x: number) => x);
const copyHoles = [...holes.values()].filter((hole) => hole.copy === COPY.id);
const holeIndex = new Map(copyHoles.map((hole, index) => [hole.id, index]));
const tears = (copy.conditions ?? [])
    .filter((condition: { conditionType: string }) => condition.conditionType === 'torn')
    .map((condition: { horizontal: { from: number; to: number }; edge: string; depth?: { value: number } }) => ({
        from: r1(toCopyAxis(condition.horizontal.from)),
        to: r1(toCopyAxis(condition.horizontal.to)),
        edge: condition.edge,
        depth: r2(condition.depth?.value ?? 3),
    }));
const writings = (copy.modifications ?? []).flatMap((modification: { purpose: string; actor?: { name: string }; produced?: unknown[] }) =>
    (modification.produced ?? [])
        .filter((feature): feature is { '@type': string; horizontal: { from: number; to: number }; vertical: { from: number; to: number }; transcription?: { text: string } } =>
            (feature as { '@type': string })['@type'] === 'Writing')
        .map((feature) => ({
            text: feature.transcription?.text ?? '',
            purpose: modification.purpose,
            ...(modification.actor && { actor: modification.actor.name }),
            from: r1(toCopyAxis(feature.horizontal.from)),
            to: r1(toCopyAxis(feature.horizontal.to)),
            tracks: [feature.vertical.from, feature.vertical.to],
        })));

// ---------------------------------------------------------------------------------------------
// One axis for the roll: the performance's milliseconds onto the paper, and the paper onto the
// score's ticks, so that the view keeps its place from one step to the next
// ---------------------------------------------------------------------------------------------

/** The roll's symbol for each note of the score, as a take of the transcription links them. */
const symbolOfNote = (source: string) => {
    const doc = new DOMParser().parseFromString(transcriptionMei, 'application/xml');
    const map = new Map<string, string>();
    for (const recording of doc.getElementsByTagName('recording')) {
        if (recording.getAttribute('source') !== source) continue;
        for (const when of recording.getElementsByTagName('when')) {
            const note = when.getAttribute('data')?.replace(/^#/, '');
            const symbol = when.getAttribute('corresp')?.split(' ')[0];
            if (note && symbol) map.set(note, symbol);
        }
    }
    return map;
};
const r1Of = symbolOfNote(VERSIONS[0].id);
const r4Of = symbolOfNote(VERSIONS[3].id);

/** Least squares of a polynomial, on a variable scaled to [0, 1]. */
const fitPolynomial = (points: [number, number][], degree: number) => {
    const xs = points.map(([x]) => x);
    const lo = Math.min(...xs);
    const span = Math.max(...xs) - lo || 1;
    const n = degree + 1;
    const a = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0));
    for (const [x, y] of points) {
        const t = (x - lo) / span;
        const powers = Array.from({ length: n }, (_, i) => t ** i);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) a[i][j] += powers[i] * powers[j];
            a[i][n] += powers[i] * y;
        }
    }
    for (let i = 0; i < n; i++) {
        const pivot = a[i][i];
        for (let j = i; j <= n; j++) a[i][j] /= pivot;
        for (let k = 0; k < n; k++) {
            if (k === i) continue;
            const factor = a[k][i];
            for (let j = i; j <= n; j++) a[k][j] -= factor * a[i][j];
        }
    }
    const coefficients = a.map((row) => row[n]);
    return (x: number) => coefficients.reduce((sum, c, i) => sum + c * ((x - lo) / span) ** i, 0);
};

const pairs = performed.flatMap((note) => {
    const symbol = symbols.get(r4Of.get(note.id) ?? '');
    return symbol ? [[note.on, symbol.from] as [number, number]] : [];
});
const mmOfMs = fitPolynomial(pairs, 3);

// x = a + b · mm, the line that puts the performed notes nearest their places in the score
const tickPairs = performed.flatMap((note) => {
    const score = scoreNoteById.get(note.id) as ScoreNote;
    return [[mmOfMs(note.on), score.date * pxPerTick] as [number, number]];
});
const meanMm = tickPairs.reduce((s, [m]) => s + m, 0) / tickPairs.length;
const meanX = tickPairs.reduce((s, [, x]) => s + x, 0) / tickPairs.length;
const slope = tickPairs.reduce((s, [m, x]) => s + (m - meanMm) * (x - meanX), 0)
    / tickPairs.reduce((s, [m]) => s + (m - meanMm) ** 2, 0);
const intercept = meanX - slope * meanMm;

const residual = Math.sqrt(pairs.reduce((s, [ms, mm]) => s + (mmOfMs(ms) - mm) ** 2, 0) / pairs.length);

// ---------------------------------------------------------------------------------------------

const symbolIndex = new Map([...symbols.keys()].map((id, index) => [id, index]));
const claimIndex = new Map(claims.map((claim, index) => [claim.id, index]));

const data = {
    about: 'Written by scripts/recordJourney.ts in mpm-desk; do not edit by hand.',
    score: {
        file: 'score.svg',
        width: measured.width,
        height: measured.height,
        pxPerTick,
        end,
        offset: r1(offset),
        padTop: r1(padTop),
        bandHeight,
        staffSpace: r2(geometry.staffSpace),
        bars: measured.bars.map((bar) => ({ n: bar.n, x: r1(bar.x - offset) })),
        notes: Object.fromEntries([...geometry.notes].map(([id, n]) => [id, {
            x: r1(n.x), w: r1(n.width), y: r1(down((measured.notes.get(id) as { y: number }).y)), h: r1(n.bottom - n.top), staff: n.staff,
        }])),
    },
    tree: { above: r1(tree.centreY), below: r1(tree.totalHeight - tree.centreY) },
    claims,
    // A sign names its claims by their place in `claims`.
    signs: signs.map((sign) => ({ ...sign, segments: sign.segments.flatMap((id) => claimIndex.has(id) ? [claimIndex.get(id)] : []) })),
    performance: {
        notes: performed.map((note) => ({
            id: note.id,
            pitch: note.pitch,
            from: r1(mmOfMs(note.on)),
            to: r1(mmOfMs(note.off)),
            velocity: note.velocity,
            ...(symbolIndex.has(r1Of.get(note.id) ?? '') && { symbol: symbolIndex.get(r1Of.get(note.id) ?? '') }),
        })),
        pedals: pedals.map((pedal) => ({ type: pedal.type, from: r1(mmOfMs(pedal.on)), to: r1(mmOfMs(pedal.off)) })),
    },
    roll: {
        /** x = a + b · mm, in the band's pixels. */
        axis: { a: r2(intercept), b: slope },
        versions: VERSIONS.map((version) => version.siglum),
        // By their place in this list, as the notes and holes refer to them: ids the page has no use for.
        symbols: [...symbols.values()].map(({ hole, ...symbol }) => ({
            ...symbol,
            from: r1(symbol.from),
            to: r1(symbol.to),
            ...(hole !== undefined && symbol.until === undefined && holeIndex.has(hole) && { hole: holeIndex.get(hole) }),
        })),
    },
    copy: {
        siglum: COPY.siglum,
        punched: copy.production?.date?.within ?? null,
        /** Where its paper begins and ends on the axis. */
        extent: [r1(toCopyAxis(0)), r1(toCopyAxis(copy.measurements?.dimensions?.height ?? 0))],
        width: r2(copy.measurements?.dimensions?.width ?? 0),
        paper: copy.production?.paper?.name ?? null,
        holes: copyHoles.map((hole) => ({ track: hole.track, from: r1(hole.from), to: r1(hole.to) })),
        tears,
        writings,
    },
};

const out = resolve(checkout, 'journey');
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'score.svg'), engraving, 'utf-8');
writeFileSync(resolve(out, 'data.json'), JSON.stringify(data), 'utf-8');

console.log(`${String(claims.length)} claims, ${String(signs.length)} signs, ${String(performed.length)} performed notes, ${String(pedals.length)} pedals`);
console.log(`${String(symbols.size)} symbols (${String(unplaced.length)} without a red copy to place them), ${String(copyHoles.length)} holes of ${COPY.siglum}, ${String(tears.length)} tears, ${String(writings.length)} writings`);
console.log(`performance onto the paper: ${String(pairs.length)} notes, residual ${residual.toFixed(1)} mm`);
console.log(`wrote ${out}`);
