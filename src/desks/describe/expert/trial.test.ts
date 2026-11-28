import { beforeAll, describe, expect, it, vi } from 'vitest';
import { about, bar, loadFixture, said, step, type Fixture } from './fixture';
import { reportOf, trialOf, TRIES } from './trial';
import type { ExpertRequest } from './types';

/**
 * The expert's tool, over the published transcription: what a trial reports of each step and of
 * what is left, and that a remark gets three of them.
 */

let fixture: Fixture;
/** A direction over the last eighths of bar 1, into the downbeat of bar 2. */
const ARROW = about('arrow', 2520, 3960, ['nrbga5m', 'n10g2bbj']);

beforeAll(() => {
    fixture = loadFixture();
});

const report = async (request: ExpertRequest, steps: ReturnType<typeof step>[]) =>
    reportOf(request, steps, await request.tryOut(steps));

describe('what a trial reports', () => {
    let request: ExpertRequest;
    let tried: Awaited<ReturnType<typeof report>>;
    beforeAll(async () => {
        const earlier = said('earlier', 'arpeggio in bar 20', about('span', bar(20), bar(21)), [
            step('FitSpread', { from: bar(20), to: bar(21) }),
        ]);
        request = fixture.request(said('asked', 'pull towards the downbeat', ARROW), [earlier]);
        tried = await report(request, [
            step('FitTempo', { from: 2520, to: 3600, shape: 'transition' }),
            step('InsertTempo', { from: 0, to: 720 }),
            step('InsertTemporalSpread'),
            step('InsertMetricalAccentuation', { from: bar(9), to: bar(10), beatLength: 0.25 }),
            step('FitTempo', { from: bar(9), to: bar(33), step: 360 }),
        ]);
    });

    it('says of a fitted step what it wrote and what it read off the recording', () => {
        expect(tried.steps[0]).toEqual({
            step: 0,
            name: 'FitTempo',
            wrote: ['tempo x1'],
            written: [expect.stringMatching(/^<tempo date="2520" bpm="[\d.]+" transition\.to="[\d.]+" /)],
            fitted: [expect.stringMatching(/^1:3\.5–2:1 {2}[\d.]+ → [\d.]+ bpm, 3 chords, rms \d+ ms$/)],
            fitted_to_notes: 4,
        });
    });

    it('says of a step that could not run why, and nothing else', () => {
        expect(tried.steps[1]).toEqual({
            step: 1,
            name: 'InsertTempo',
            error: 'InsertTempo needs a number for "bpm"',
        });
    });

    it('counts what a step wrote by element, and shows the first eight with their definitions', () => {
        const rolled = tried.steps[2]!;
        expect(rolled.wrote).toEqual([expect.stringMatching(/^ornament x\d+$/)]);
        const count = Number(/x(\d+)/.exec(rolled.wrote![0]!)?.[1]);
        expect(count).toBeGreaterThan(50);
        expect(rolled.written_shown).toBe(`8 of ${count} elements, with the definitions they name`);

        const elements = rolled.written!.filter((tag) => tag.startsWith('<ornament '));
        const definitions = rolled.written!.filter((tag) => tag.startsWith('<ornamentDef '));
        expect(elements).toHaveLength(8);
        expect(elements.length + definitions.length).toBe(rolled.written!.length);
        // The definitions shown are those the elements shown name, which hold the fitted frames.
        const named = elements.map((tag) => /name\.ref="([^"]+)"/.exec(tag)![1]);
        const defined = definitions.map((definition) => /name="([^"]+)"/.exec(definition)![1]);
        expect(defined.sort()).toEqual([...new Set(named)].sort());
        expect(definitions.every((definition) => definition.includes('<temporalSpread '))).toBe(true);
        expect(rolled.fitted).toBeUndefined();
    });

    it('says where what a step came to is withheld from the document', () => {
        expect(tried.steps[3]).toMatchObject({
            wrote: ['accentuationPattern x1'],
            withheld: expect.stringMatching(/requires InsertDynamics.*only assumed/),
        });
        expect(tried.steps[0]).not.toHaveProperty('withheld');
    });

    it('shows the first forty-eight of the lines a step fitted, and says how many there were', () => {
        const { fitted, fitted_shown } = tried.steps[4]!;
        expect(fitted).toHaveLength(48);
        expect(fitted_shown).toMatch(/^48 of \d+$/);
        expect(fitted![0]).toMatch(/^9:1–9:[\d.]+ {2}[\d.]+ bpm, \d+ chords, rms \d+ ms$/);
    });

    it('measures the passage and the piece as the document stands and as the trial leaves them', () => {
        const { left_in_passage: passage, left_in_piece: piece } = tried;
        expect(passage.before.notes).toBe(4);
        expect(passage.after.notes).toBe(4);
        expect(passage.after.pulse_ms).toBeLessThan(passage.before.pulse_ms);
        expect(piece.before.notes).toBe(450);
        // The rolls of the whole piece and the tempo of two thirds of it, tried.
        expect(piece.after.spread_ms).toBeLessThan(piece.before.spread_ms / 2);
        expect(piece.after.pulse_ms).toBeLessThan(piece.before.pulse_ms / 2);
    });

    it('reads a level off the recording in a line of its own kind', async () => {
        const { steps } = await report(request, [step('FitDynamics', { from: bar(3), to: bar(4) })]);
        expect(steps[0]).toMatchObject({
            wrote: ['dynamics x1'],
            fitted: [expect.stringMatching(/^3:1–4:1 {2}level [\d.]+ over \d+ chords$/)],
        });
    });

    it('tries the steps in place of the ones the remark already has', async () => {
        const standing = said('asked', 'steady', ARROW, [step('FitTempo', { from: 2520, to: 3600 })]);
        const mended = fixture.request(standing);
        const { steps } = await report(mended, [step('FitDynamics', { from: 2520, to: 3600 })]);
        expect(steps).toHaveLength(1);
        expect(steps[0]).toMatchObject({ name: 'FitDynamics', wrote: ['dynamics x1'] });
    });
});

describe('a trial over what was made by hand', () => {
    /** Bars 16 and 17 of the published reconstruction, described by hand in every respect. */
    const [FROM, TO] = [bar(16), bar(18)];
    const PRESSES = ['sustain-43920', 'sustain-45000', 'sustain-45720', 'sustain-47520'];
    let request: ExpertRequest;

    beforeAll(() => {
        request = fixture.request(said('asked', 'one tempo here', about('span', FROM, TO)), [], {
            byHand: fixture.published,
        });
    });

    it('says what a step would take the place of, how many in all, and what that leaves', async () => {
        const tried = await report(request, [step('FitTempo', { from: FROM, to: TO })]);
        expect(tried.steps[0]).toMatchObject({
            replaces: ['InsertTempo ×5: ticks 43920 to 49680 (16:1 to 18:1)'],
            wrote: ['tempo x1'],
        });
        expect(tried.steps[0]).not.toHaveProperty('behind');
        expect(tried.replaces_made_by_hand).toBe(5);
        // One tempo for two bars is coarser than the five drawn ones, and the trial shows it.
        const { before, after } = tried.left_in_passage;
        expect(after.pulse_ms).toBeGreaterThan(before.pulse_ms);
    });

    it('tells each step its own share: what goes, what is only cut back, and where', async () => {
        const tried = await report(request, [
            step('FitTempo', { from: FROM, to: TO, shape: 'transition' }),
            step('FitDynamics', { from: FROM, to: TO }),
            step('InsertTemporalSpread', { date: FROM, placement: 'on-beat' }),
            ...PRESSES.map((pedal) => step('InsertPedal', { pedal })),
        ]);
        const [tempo, dynamics, roll, ...pedals] = tried.steps;
        expect(tempo?.replaces).toEqual(['InsertTempo ×5: ticks 43920 to 49680 (16:1 to 18:1)']);
        // Two of the four spans reach beyond the bars, and keep what lies outside them.
        expect(dynamics?.replaces).toEqual([
            'InsertDynamics ×4: ticks 42480 to 50400 (15:3 to 18:2); 2 of them only cut back',
        ]);
        expect(roll?.replaces).toEqual(['InsertTemporalSpread ×1: tick 43920 (16:1)']);
        // A line drawn by hand for a press is placed by its guides.
        for (const pedal of pedals) {
            expect(pedal.replaces).toEqual([
                expect.stringMatching(/^InsertPedal ×1: ticks \d+ to \d+ \(1[567]:[\d.]+ to 1[67]:[\d.]+\)$/),
            ]);
        }
        expect(tried.replaces_made_by_hand).toBe(14);
        expect(tried.steps.every((one) => one.error === undefined && !one.behind)).toBe(true);
    });

    it('says where a step stands behind what is said of every chord, and wrote nothing', async () => {
        const steps = [
            step('InsertDynamicsGradient', { date: FROM }),
            step('InsertArticulation', { noteIDs: ['nxbdd6x'], aspects: ['relativeVelocity'] }),
        ];
        const tried = await report(request, steps);
        expect(tried.steps[0]).toEqual({
            step: 0,
            name: 'InsertDynamicsGradient',
            behind: 'stands behind what was made by hand in its place: InsertDynamicsGradient ×1',
            gave_way_to: ['InsertDynamicsGradient ×1'],
        });
        // An articulation is not settled against anything: it runs beside what stands.
        expect(tried.steps[1]).toMatchObject({ wrote: ['articulation x1'] });
        expect(tried.steps[1]).not.toHaveProperty('replaces');
        expect(tried.replaces_made_by_hand).toBe(0);

        // Not told which calls were made by hand, it can still say how many it gave way to.
        const untold = { ...request, byHand: undefined };
        const again = reportOf(untold, steps, await request.tryOut(steps));
        expect(again.steps[0]?.gave_way_to).toEqual(['1 call made by hand']);
    });

    it('replaces nothing where nothing made by hand stands in the way', async () => {
        const alone = fixture.request(said('asked', 'one tempo here', about('span', FROM, TO)));
        const tried = await report(alone, [step('FitTempo', { from: FROM, to: TO })]);
        expect(tried.replaces_made_by_hand).toBe(0);
        expect(tried.steps[0]).not.toHaveProperty('replaces');
    });
});

describe('the tool', () => {
    const request = (tryOut: ExpertRequest['tryOut']): ExpertRequest => ({
        ...fixture.request(said('asked', 'pull towards the downbeat', ARROW)),
        tryOut,
    });
    const once = { steps: [{ name: 'InsertPedal', options: {} }] };

    it('tries a remark three times, and refuses a fourth', async () => {
        const tryOut = vi.fn(() => Promise.resolve(fixture.base));
        const trial = trialOf(request(tryOut));
        for (let tries = 0; tries < TRIES; tries++) {
            const { content, failed } = await trial(once);
            expect(failed).toBe(false);
            expect(JSON.parse(content)).toHaveProperty('left_in_piece');
        }
        const refused = await trial(once);
        expect(refused.failed).toBe(true);
        expect(refused.content).toMatch(/used 3 times .* Answer now/);
        expect(tryOut).toHaveBeenCalledTimes(3);
        expect(tryOut).toHaveBeenLastCalledWith(once.steps);
    });

    it('answers an input that is no list of steps as one that could not be read, and counts no try', async () => {
        const tryOut = vi.fn(() => Promise.resolve(fixture.base));
        const trial = trialOf(request(tryOut));
        for (const input of [undefined, {}, { steps: 'FitTempo' }, { steps: [{ options: {} }] }]) {
            const { content, failed } = await trial(input);
            expect(failed).toBe(true);
            expect(JSON.parse(content)).toEqual({ INVALID_JSON: JSON.stringify(input ?? null) });
        }
        expect(tryOut).not.toHaveBeenCalled();
        for (let tries = 0; tries < TRIES; tries++) expect((await trial(once)).failed).toBe(false);
    });

    it('says so where the steps could not be tried at all', async () => {
        const trial = trialOf(request(() => Promise.reject(new Error('the worker is gone'))));
        expect(await trial(once)).toEqual({
            content: 'The steps could not be tried: the worker is gone',
            failed: true,
        });
    });

    it('says what it is doing while it does it', async () => {
        const lines: string[] = [];
        const trial = trialOf(
            request(() => Promise.resolve(fixture.base)),
            (line) => lines.push(line),
        );
        await trial(once);
        await trial({ steps: [...once.steps, ...once.steps] });
        expect(lines).toEqual(['Trying 1 step on the roll…', 'Trying 2 steps on the roll…']);
    });
});
