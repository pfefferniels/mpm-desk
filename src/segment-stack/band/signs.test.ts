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

    it('raises the tempo arrow into an accelerando and lowers it into a ritardando', () => {
        const [accelStart, accelEnd] = ends(byElement.get('tempo_0')!.stroke);
        expect(accelEnd[1]).toBeLessThan(accelStart[1]);
        const [ritStart, ritEnd] = ends(byElement.get('tempo_720')!.stroke);
        expect(ritEnd[1]).toBeGreaterThan(ritStart[1]);
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

    it('keeps the lanes apart: tempo over rubato over stress over the staff, pedal under it', () => {
        const lanes = laneLayout(geometry);
        expect(lanes.tempo).toBeLessThan(lanes.rubato);
        expect(lanes.rubato).toBeLessThan(lanes.stress);
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
