/**
 * The migration of the published pedal ramps (`pedalRamps.ts`), run on the published reconstruction.
 *
 * It holds before welte225.org has migrated and after: on a work file with ramps it measures what
 * the migration makes of them, on one without, that the file is left as it is. Once the published
 * file has moved, this and the script can go, as `migrateWork` did.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { convertMeiToMsm } from 'espressivo';
import { migratePedalRamps } from './pedalRamps';
import { runFit } from '../src/fitting/fit';
import { asMSM } from '../src/fitting/asMSM';
import { parseWorkFile, type WorkFile } from '../src/model/Work';
import { publishedPath } from '../src/test/published';

const mei = readFileSync(publishedPath('mei'), 'utf-8');
const published = parseWorkFile(readFileSync(publishedPath('work'), 'utf-8'));
const { work: migrated, presses } = migratePedalRamps(published, mei);

const performed = (work: WorkFile): string => {
    const movement = convertMeiToMsm(mei)[0];
    // The chain is noisy about MSM parts it cannot match; that is a property of the fixture.
    const say = console.log;
    console.log = () => undefined;
    try {
        return runFit(work, asMSM(mei, movement.msm, movement.graces)).mpm;
    } finally {
        console.log = say;
    }
};
const before = performed(published);
const after = migrated === published ? before : performed(migrated);

interface Movement {
    date: number;
    position: number;
    transitionTo?: number;
    curvature: number;
    protraction: number;
}

const attribute = (tag: string, name: string): string | undefined =>
    new RegExp(` ${name.replace('.', '\\.')}="([^"]*)"`).exec(tag)?.[1];

/**
 * A document's movements as they sound, by controller and in order: without one dated before the
 * score, which the renderer skips, and without a constant restating where the pedal already is,
 * unless it ends a transition. A bend left unstated is the one a `<movement>` takes by default.
 */
const sounded = (mpm: string): Map<string, Movement[]> => {
    const byController = new Map<string, Movement[]>();
    const tags = [...mpm.matchAll(/<movement [^>]*>/g)].map(([tag]) => tag);
    for (const tag of tags) {
        const transitionTo = attribute(tag, 'transition.to');
        const movement: Movement = {
            date: Number(attribute(tag, 'date')),
            position: Number(attribute(tag, 'position')),
            ...(transitionTo !== undefined && { transitionTo: Number(transitionTo) }),
            curvature: Number(attribute(tag, 'curvature') ?? 0.4),
            protraction: Number(attribute(tag, 'protraction') ?? 0),
        };
        if (movement.date < 0) continue;
        const controller = attribute(tag, 'controller') ?? '';
        byController.set(controller, [...(byController.get(controller) ?? []), movement]);
    }
    for (const [controller, movements] of byController) {
        let held = 0;
        let moving = false;
        byController.set(
            controller,
            movements
                .sort((a, b) => a.date - b.date)
                .filter((movement) => {
                    const kept = movement.transitionTo !== undefined || moving || movement.position !== held;
                    held = movement.transitionTo ?? movement.position;
                    moving = movement.transitionTo !== undefined;
                    return kept;
                }),
        );
    }
    return byController;
};

describe('the published ramps, migrated', () => {
    test('leave no ramp behind', () => {
        const ramps = migrated.provenance.filter((call) => call.name === 'InsertPedal' && 'direction' in call.options);
        expect(ramps).toEqual([]);
        expect(presses.every((press) => press.travel.length >= 2)).toBe(true);
    });

    test('keep every call id, so that a link to a ramp still opens a call about its press', () => {
        const ids = new Set(migrated.provenance.map((call) => call.id));
        expect(published.provenance.filter((call) => !ids.has(call.id))).toEqual([]);
    });

    test('change no instruction but the movements', () => {
        const withoutMovements = (mpm: string) => mpm.replace(/<movementMap[\s\S]*?<\/movementMap>/g, '');
        expect(withoutMovements(after)).toBe(withoutMovements(before));
    });

    test('move the pedals as the ramps did, to the millisecond the record is kept in', () => {
        const was = sounded(before);
        const is = sounded(after);
        expect([...is.keys()].sort()).toEqual([...was.keys()].sort());
        for (const [controller, movements] of was) {
            const now = is.get(controller) ?? [];
            const undated = (movement: Movement): Omit<Movement, 'date'> => {
                const { date, ...rest } = movement;
                void date;
                return rest;
            };
            expect(now.map(undated)).toEqual(movements.map(undated));
            // Under three ticks: one press releases where a tempo boundary re-anchors the grid, and
            // the closest millisecond to its ramp's end lands 2.74 ticks after it.
            const late = now.map((movement, i) => Math.abs(movement.date - movements[i].date));
            expect(Math.max(0, ...late)).toBeLessThan(3);
        }
    });
});
