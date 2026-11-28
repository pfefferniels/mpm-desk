/**
 * A rendering on the renderer's own clock, laid on the recording's: note by note as the roll was
 * laid, and as a whole where the first chord that is played stands.
 *
 * On the two bars of `fixture.ts`, and on the published transcription, where the roll is laid
 * tempo by tempo and is in places a sixth of a second from the renderer's clock.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
    bringOut,
    describe as runDescription,
    type DescriptionRun,
} from '../../../fitting/description/index';
import type { DescribedPlace } from '../../../fitting/transformers/description/Describe';
import { bar, loadPublished, remark, step } from '../../../../tests/fitting/description/published';
import { aRun, performed, places } from './fixture';
import { lay, renderingOf, type Rendering } from './laying';
import { wroteOf } from './passage';

const DAMPED = 0.35;

describe('a rendering carried onto the roll', () => {
    const run = aRun();
    /** The second bar was carried 80 ms: the renderer has it that much earlier than the roll. */
    const plain = performed(run).notes.map((note) =>
        note.ms >= 2000 ? { ...note, ms: note.ms - 80, msEnd: note.msEnd - 80 } : note,
    );

    it('stands where the roll has it, rendered as the MPM stands', () => {
        const { notes } = lay(run.roll.notes, plain, plain);
        for (const note of run.roll.notes) expect(notes.get(note.id)).toEqual(note.mpm);
    });

    it('carries each note as far as the roll carried it', () => {
        const out = plain.map((note) => ({
            ...note,
            ms: note.ms + 7,
            msEnd: note.msEnd + 11,
            velocity: 80,
        }));
        const { notes } = lay(run.roll.notes, plain, out);
        expect(notes.get('r1')).toEqual({ ms: 507, msEnd: 961, velocity: 80 });
        expect(notes.get('r5')).toEqual({ ms: 2507, msEnd: 2961, velocity: 80 });
    });

    it('carries a moment of the rendering as far as the note struck last before it', () => {
        const { moment } = lay(run.roll.notes, plain, plain);
        expect(moment(1700)).toBe(1700);
        expect(moment(1920)).toBe(2000);
        expect(moment(3000)).toBe(3080);
        expect(moment(-50)).toBe(-50);
    });

    it('passes over a note one of the renderings does not hold', () => {
        const { notes } = lay(run.roll.notes, plain, plain.slice(1));
        expect(notes.has('r0')).toBe(false);
        expect(notes.size).toBe(9);
    });
});

describe('a remark as it is played', () => {
    const run = aRun();
    const [tempo, , whole] = run.remarks;
    const place = (id: string) => places().get(id)!;
    /** Half as slow again, and louder. */
    const brought = { plain: performed(run), out: performed(run, 1.5, 10) };

    it('is laid where the first chord played stands on the roll, and runs on from there on its own clock', () => {
        const { moved } = renderingOf(run.roll, place('tempo'), wroteOf(tempo), 0, brought)!;
        // Played from the right hand's third note, which stays where it is.
        expect(moved!.get('r2')).toEqual({ ms: 1000, msEnd: 1675, velocity: 70 });
        expect(moved!.get('r3')).toEqual({ ms: 1750, msEnd: 2425, velocity: 70 });
        expect(moved!.get('l1')).toEqual({ ms: 2500, msEnd: 5425, velocity: 70 });
    });

    it('moves the notes struck in the stretch and no other: not what came before, nor what is held into it', () => {
        const { moved } = renderingOf(run.roll, place('tempo'), wroteOf(tempo), 0, brought)!;
        expect([...moved!.keys()]).toEqual(['r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'l1']);
    });

    it('moves the same notes however strongly the remark is brought out, the first of them never', () => {
        // Four times as slow the last chord sounds 3.5 s after the remark's own: further than is
        // played around a passage, and played all the same, the roll as it stands deciding.
        const slow = { plain: performed(run), out: performed(run, 4) };
        const { moved } = renderingOf(run.roll, place('tempo'), wroteOf(tempo), 0, slow)!;
        expect([...moved!.keys()]).toEqual(['r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'l1']);
        expect(moved!.get('r2')!.ms).toBe(1000);
        expect(moved!.get('r7')!.ms - moved!.get('r5')!.ms).toBe(4000);
    });

    it('hands the piano the notes where the roll shows them, the held one softer and with the first', () => {
        const { moved, heard, from, until } = renderingOf(
            run.roll,
            place('tempo'),
            wroteOf(tempo),
            0,
            brought,
        )!;
        expect(heard.notes.map((key) => key.id)).toEqual([
            'r2',
            'l0',
            'r3',
            'r4',
            'l1',
            'r5',
            'r6',
            'r7',
        ]);
        for (const key of heard.notes.filter((key) => key.id !== 'l0')) {
            expect(key).toMatchObject({
                onsetMs: moved!.get(key.id)!.ms,
                offsetMs: moved!.get(key.id)!.msEnd,
                velocity: 70,
            });
        }
        expect(heard.notes[1]).toEqual({
            id: 'l0',
            pitch: 36,
            onsetMs: 1000,
            offsetMs: 2425,
            velocity: 49,
        });
        expect({ from, until }).toEqual({ from: 960, until: 5750 });
    });

    it('lays the pedal of the rendering with its notes', () => {
        const { heard } = renderingOf(run.roll, place('tempo'), wroteOf(tempo), 0, brought)!;
        expect(heard.pedals).toEqual([{ type: 'sustain', onsetMs: -500, durationMs: 2250 }]);
    });

    it('is the MPM as it stands where nothing is brought out', () => {
        const { moved, heard, from, until } = renderingOf(
            run.roll,
            place('quiet'),
            wroteOf(run.remarks[1]),
            0,
            null,
        )!;
        expect(moved).toBeNull();
        expect(heard.notes).toEqual([
            { id: 'r1', pitch: 61, onsetMs: 500, offsetMs: 950, velocity: 60 },
            // The other hand, held back under a single note, and held over.
            { id: 'l0', pitch: 36, onsetMs: 500, offsetMs: 1950, velocity: 23 },
            { id: 'r2', pitch: 62, onsetMs: 1000, offsetMs: 1450, velocity: 60 },
            { id: 'r3', pitch: 63, onsetMs: 1500, offsetMs: 1950, velocity: 60 },
        ]);
        expect(heard.pedals).toEqual([{ type: 'sustain', onsetMs: 0, durationMs: 1900 }]);
        expect({ from, until }).toEqual({ from: 460, until: 2500 });
    });

    it('is played from the line, for a remark on the whole piece', () => {
        const louder = { plain: performed(run), out: performed(run, 1, 10) };
        const { moved, heard, from } = renderingOf(
            run.roll,
            place('whole'),
            wroteOf(whole),
            1200,
            louder,
        )!;
        expect(heard.notes.map((key) => key.id)).toEqual(['r3', 'r4', 'l1', 'r5', 'r6', 'r7']);
        expect(from).toBe(1460);
        expect(moved!.get('r3')).toEqual({ ms: 1500, msEnd: 1950, velocity: 70 });
        // The whole piece is the stretch: every note is moved, those before the line too.
        expect(moved!.size).toBe(run.roll.notes.length);
        expect(moved!.get('r0')).toEqual({ ms: 0, msEnd: 450, velocity: 70 });
    });

    it('is nothing where there is no note to play', () => {
        const nowhere: DescribedPlace = { kind: 'span', from: 100, to: 200, notes: [] };
        expect(renderingOf(run.roll, nowhere, wroteOf(tempo), 0, brought)).toBeNull();
        expect(renderingOf(run.roll, place('whole'), wroteOf(whole), 3600, brought)).toBeNull();
    });
});

describe('a remark of the published transcription, laid on its roll', () => {
    // Two bars that press forward and grow louder.
    const [FROM, TO] = [bar(16), bar(18)];
    const passage: DescribedPlace = { kind: 'span', from: FROM, to: TO, notes: [] };

    /** Nothing described but the two bars: their tempo and their loudness. */
    let described: DescriptionRun;
    /** The published reconstruction, a tempo to the beat and more, and the two bars' loudness said again. */
    let reconstructed: DescriptionRun;

    beforeAll(() => {
        const published = loadPublished();
        described = runDescription(published.alignment, [
            ...published.choice,
            remark('r1', [
                step('FitTempo', { from: FROM, to: TO, shape: 'transition' }),
                step('InsertDynamics', { from: FROM, to: TO }),
            ]),
        ]);
        reconstructed = runDescription(published.alignment, [
            ...published.work.provenance,
            remark('r1', [step('InsertDynamics', { from: FROM, to: TO })]),
        ]);
    }, 120_000);

    const laid = (run: DescriptionRun, factor: number, attenuation: number) => {
        const wrote = wroteOf(run.remarks[0]);
        const plain = bringOut(run, [], 1, 1);
        const out = bringOut(run, wrote.elements, factor, attenuation);
        return renderingOf(run.roll, passage, wrote, 0, { plain, out })!;
    };
    /** How far each note that is moved is from where the roll has it, in ms. */
    const apart = (run: DescriptionRun, { moved }: Rendering) =>
        run.roll.notes.flatMap((note) => {
            const at = moved!.get(note.id);
            return at ? [Math.abs(at.ms - note.mpm.ms)] : [];
        });

    it('puts every note where the roll has it while nothing is exaggerated or held back, however the roll was laid', () => {
        // The reconstruction's tempos do not all end on the chord the next begins on: the roll is
        // laid anew at each, and is a sixth of a second from the renderer's own clock in places.
        const plain = new Map(
            bringOut(reconstructed, [], 1, 1).notes.map((note) => [note.id, note.ms]),
        );
        const carried = reconstructed.roll.notes.map((note) => note.mpm.ms - plain.get(note.id)!);
        expect(Math.max(...carried) - Math.min(...carried)).toBeGreaterThan(150);

        for (const run of [described, reconstructed]) {
            // Of the whole piece, which is every note; and of the two bars.
            const wrote = wroteOf(run.remarks[0]);
            const rendered = bringOut(run, [], 1, 1);
            const whole = renderingOf(
                run.roll,
                { kind: 'piece', from: 0, to: 0, notes: [] },
                wrote,
                0,
                { plain: rendered, out: bringOut(run, wrote.elements, 1, 1) },
            )!;
            expect(whole.moved!.size).toBe(run.roll.notes.length);
            for (const rendering of [whole, laid(run, 1, 1)]) {
                expect(Math.max(...apart(run, rendering))).toBeLessThan(1e-6);
                for (const note of run.roll.notes) {
                    const at = rendering.moved!.get(note.id);
                    if (at) expect(at.velocity).toBe(note.mpm.velocity);
                }
            }
        }
    });

    it('moves nothing at strength 1 where what the remark wrote is all there is to hold back', () => {
        expect(Math.max(...apart(described, laid(described, 1, DAMPED)))).toBeLessThan(1e-6);
    });

    it('moves the notes of a tempo brought out, from the first chord played, which stays', () => {
        const rendering = laid(described, 1.9, DAMPED);
        const moved = rendering.moved!;
        const shown = described.roll.notes.filter((note) => moved.has(note.id));
        const still = shown.filter((note) => Math.abs(moved.get(note.id)!.ms - note.mpm.ms) < 1e-6);
        // The chord that stays is the context before the two bars, and the playing begins with it.
        expect(still.length).toBeGreaterThan(0);
        expect(Math.max(...still.map((note) => note.date))).toBeLessThan(FROM);
        expect(rendering.from).toBeCloseTo(Math.min(...still.map((note) => note.mpm.ms)) - 40, 6);
        expect(Math.max(...apart(described, rendering))).toBeGreaterThan(200);

        // What the piano is handed is what the roll shows. A note held over into the stretch is
        // not moved, and begins with the first.
        const onsets = rendering.heard.notes.map((key) => key.onsetMs);
        for (const key of rendering.heard.notes) {
            const at = moved.get(key.id);
            if (at) expect(key).toMatchObject({ onsetMs: at.ms, offsetMs: at.msEnd });
            else expect(key.onsetMs).toBe(Math.min(...onsets));
        }
        expect(rendering.until).toBeGreaterThan(Math.max(...onsets) + 700);
    });

    it('moves the two bars and what is played around them, and nothing of the rest of the piece', () => {
        const { moved, heard } = laid(described, 1.9, DAMPED);
        const dates = described.roll.notes
            .filter((note) => moved!.has(note.id))
            .map((note) => note.date);
        const beat = 720;
        expect(Math.min(...dates)).toBeLessThan(FROM);
        expect(Math.min(...dates)).toBeGreaterThanOrEqual(FROM - 2 * beat);
        expect(Math.max(...dates)).toBeGreaterThanOrEqual(TO);
        expect(Math.max(...dates)).toBeLessThanOrEqual(TO + 2 * beat);
        expect(moved!.size).toBeLessThan(described.roll.notes.length / 5);
        expect(heard.notes.length).toBeGreaterThanOrEqual(moved!.size);
    });

    it('moves the same notes at every strength', () => {
        const weakest = [...laid(described, 1, DAMPED).moved!.keys()];
        for (const factor of [1.3, 1.6, 1.9]) {
            expect([...laid(described, factor, DAMPED).moved!.keys()]).toEqual(weakest);
        }
    });
});
