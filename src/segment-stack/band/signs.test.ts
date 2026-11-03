import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSigns, laneLayout, type BandGeometry, type NotePlacement } from './signs';
import { readScoreNotes } from './bandMei';
import { outcomesOf, projectReconstruction } from '../../model/Reconstruction';
import { parseWorkFile } from '../../model/Work';
import { readPerformance } from '../../utils/mpm';
import { readMeter } from '../../utils/score';
import { publishedPath } from '../../test/published';

const msm = readFileSync(publishedPath('score'), 'utf-8');
const mpm = readPerformance(readFileSync(publishedPath('performance'), 'utf-8'), readMeter(msm));
const work = parseWorkFile(readFileSync(publishedPath('work'), 'utf-8'));
const { reconstruction } = projectReconstruction({
    title: '',
    author: '',
    claims: work.segments,
    outcomes: outcomesOf(work.provenance),
    elementTypes: new Map(mpm.instructions.map((i) => [i.id, i.type])),
});

/** An engraving that is exactly linear: a tick is a tenth of a pixel, every note on staff 1 or 2 by pitch. */
const scoreNotes = readScoreNotes(msm);
const pitch = new Map([...msm.matchAll(/xml:id="([^"]+)"[^>]*midi\.pitch="(\d+)"/g)].map((m) => [m[1], Number(m[2])]));
const geometry: BandGeometry = {
    x: (tick) => tick / 10,
    staffSpace: 10,
    staves: new Map([[1, { top: 100, bottom: 140 }], [2, { top: 200, bottom: 240 }]]),
    notes: new Map(scoreNotes.map((n): [string, NotePlacement] => {
        const upper = (pitch.get(n.id) ?? 60) >= 60;
        return [n.id, { x: n.date / 10, width: 12, top: upper ? 110 : 210, bottom: upper ? 120 : 220, staff: upper ? 1 : 2 }];
    })),
    scoreNotes: new Map(scoreNotes.map((n) => [n.id, n])),
    end: Math.max(...scoreNotes.map((n) => n.date + n.duration)),
};
const signs = buildSigns(reconstruction.segments, mpm, geometry);
const byElement = new Map(signs.map((s) => [s.elementId, s]));

/** The y of the first and last point of a path. */
const ends = (d: string) => {
    const points = [...d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    return [points[0], points[points.length - 1]];
};

describe('the signs the band draws', () => {
    it('gives every instruction a segment claims a sign, once', () => {
        const claimed = new Set(reconstruction.segments.flatMap((s) => s.spans.flatMap((span) => span.elements)));
        const drawnTypes = new Set(signs.map((s) => s.type));
        expect([...drawnTypes].sort()).toEqual(
            ['accentuationPattern', 'articulation', 'dynamics', 'movement', 'ornament', 'rubato', 'tempo'],
        );
        expect(new Set(signs.map((s) => s.elementId)).size).toBe(signs.length);
        // Everything claimed is drawn, but the moment a pedal is fully up, which has no extent.
        const missing = [...claimed].filter((id) => !byElement.has(id)).map((id) => mpm.byId(id)?.type);
        expect(new Set(missing)).toEqual(new Set(['movement']));
        for (const sign of signs) expect(sign.stroke.length + sign.fill.length, sign.elementId).toBeGreaterThan(0);
    });

    it('draws tempo flat, its arrow right where it moves forward and left where it slows down', () => {
        const tip = (id: string) => {
            const sign = byElement.get(id)!;
            const [[x0, y0], [x1, y1]] = ends(sign.stroke);
            const [tx] = sign.fill.match(/^M([-\d.]+)/)!.slice(1).map(Number);
            expect(y0).toBe(y1);
            return { tx, x0, x1 };
        };
        const accel = tip('tempo_0'); // 59 → 66
        expect(accel.tx).toBe(accel.x1);
        const rit = tip('tempo_720'); // 76 → 48
        expect(rit.tx).toBe(rit.x0);
    });

    it('draws a rubato as a slur from the first note of its frame to the last', () => {
        // rubato_2880: a quarter's frame at 1.4, struck at 1.4 and 1.4½ (ticks 2880 and 3240)
        const slur = byElement.get('rubato_2880')!
        expect(slur.stroke).toBe('')
        const xs = [...slur.fill.matchAll(/([-\d.]+) ([-\d.]+)/g)].map((m) => Number(m[1]))
        expect(Math.min(...xs)).toBeCloseTo(2880 / 10 + 6, 0)
        expect(Math.max(...xs)).toBeCloseTo(3240 / 10 + 6, 0)
        // arched upwards, over its notes
        const ys = [...slur.fill.matchAll(/([-\d.]+) ([-\d.]+)/g)].map((m) => Number(m[2]))
        expect(Math.max(...ys)).toBeLessThan(110)
    });

    it('opens a crescendo towards its end and a decrescendo towards its start', () => {
        // 36 → 44 from 1.3½, then 40 → 36 from 1.1
        const cres = byElement.get('dynamics_2520')!.stroke;
        const dim = byElement.get('dynamics_720')!.stroke;
        const width = (d: string, at: 'start' | 'end') => {
            const xs = [...d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
            const x = at === 'start' ? Math.min(...xs.map((p) => p[0])) : Math.max(...xs.map((p) => p[0]));
            const ys = xs.filter((p) => p[0] === x).map((p) => p[1]);
            return Math.max(...ys) - Math.min(...ys);
        };
        expect(width(cres, 'end')).toBeGreaterThan(width(cres, 'start'));
        expect(width(dim, 'start')).toBeGreaterThan(width(dim, 'end'));
    });

    it('keeps the lanes apart: tempo over stress over the staff, pedal under it', () => {
        const lanes = laneLayout(geometry);
        // The tempo line and its arrowhead stay over the highest slur arch, 2.8 spaces over the top note.
        const ceiling = lanes.stress + 0.9 * geometry.staffSpace;
        expect(lanes.tempo + 0.4 * geometry.staffSpace).toBeLessThan(ceiling - 2.8 * geometry.staffSpace);
        expect(lanes.stress).toBeLessThan(110);
        expect(lanes.hairpin).toBeGreaterThan(140);
        expect(lanes.hairpin).toBeLessThan(200);
        expect(lanes.pedal).toBeGreaterThan(240);
    });

    it('gives a ramp to the segment it opens, not to the one it closes', () => {
        // dynamics_3600 closes the crescendo of „Hinspielen zur 1“ and opens the diminuendo after it.
        const opener = reconstruction.segments.find((s) => s.id.startsWith('3603c14a'));
        const closer = reconstruction.segments.find((s) => s.id.startsWith('047fa902'));
        const sign = byElement.get('dynamics_3600')!;
        expect(sign.segmentIds).toContain(opener?.id);
        expect(sign.segmentIds).not.toContain(closer?.id);
    });
});
