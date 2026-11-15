/**
 * The published reconstruction's pedal ramps, turned into the guides they were drawn through.
 *
 * The reconstruction of WM 225 pedalled every press with two calls of `InsertPedal`'s shortcut, a
 * ramp down and a ramp up, typed in ticks off the press's ends at a depth typed rather than read.
 * What the two describe is a curve through four points: where the pedal leaves rest, where it
 * arrives at its depth, where it leaves that, and where it is back at rest, with the bend a
 * `<movement>` takes by default between them. That is what an `InsertPedal` stating guides says,
 * in one call: a curve through its guides, the default bend between two of them.
 *
 * The guides are read off the performance the ramps wrote, each ramp's two movements being where
 * it starts and where it arrives, so they are the ramps' own dates to the precision the published
 * file keeps, and the curve through them is the curve the ramps drew. A ramp the renderer skipped,
 * dated before the score begins, is a guide there all the same: the renderer skips the movement
 * from it as it skipped the ramp.
 *
 * Each press keeps one call and one id: its ramp down's, which a link to the ramp down already
 * opens the press with. Its ramp up's goes.
 *
 * Nothing here reads or writes a file; `migratePedalRamps.ts` is the command.
 */
import type { Call, WorkFile } from '../src/model/Work';

const isRamp = (call: Call): boolean => call.name === 'InsertPedal' && 'direction' in call.options;

const attribute = (tag: string, name: string): string | undefined =>
    new RegExp(` ${name.replace('.', '\\.')}="([^"]*)"`).exec(tag)?.[1];

/** Where each `<movement>` of a performance is and how far down, by its `xml:id`. */
const movementsOf = (performance: string): Map<string, { date: number; position: number }> =>
    new Map(
        [...performance.matchAll(/<movement [^>]*>/g)].flatMap(([tag]) => {
            const id = attribute(tag, 'xml:id');
            const date = attribute(tag, 'date');
            const position = attribute(tag, 'position');
            if (id === undefined || date === undefined || position === undefined) return [];
            return [[id, { date: Number(date), position: Number(position) }] as const];
        }),
    );

export interface GuidedPress {
    pedal: string;
    guides: Map<number, number>;
}

export interface Migration {
    work: WorkFile;
    presses: GuidedPress[];
}

/**
 * The work file with each press's two ramps replaced by one call guiding the press through the
 * points they ran between. Calls other than the ramps are left as they are, in place.
 *
 * @param performance the MPM the chain wrote from `work`, whose movements the ramps' calls name as
 * their elements
 */
export const migratePedalRamps = (work: WorkFile, performance: string): Migration => {
    const ramps = new Map<string, { down?: Call; up?: Call }>();
    for (const call of work.provenance.filter(isRamp)) {
        const pedal = String(call.options.pedal);
        const direction = call.options.direction === 'up' ? 'up' : 'down';
        const pair = ramps.get(pedal) ?? {};
        if (pair[direction]) throw new Error(`${pedal} has two ramps ${direction}`);
        pair[direction] = call;
        ramps.set(pedal, pair);
    }
    if (ramps.size === 0) return { work, presses: [] };

    const movements = movementsOf(performance);
    const presses: GuidedPress[] = [];
    const replacing = new Map<string, Call[]>();

    for (const [pedal, { down, up }] of ramps) {
        if (!down || !up) throw new Error(`${pedal} has a ramp ${down ? 'down' : 'up'} only`);
        const points = [down, up].flatMap((ramp) =>
            (ramp.elements ?? []).map((id) => {
                const movement = movements.get(id);
                if (!movement) throw new Error(`${ramp.id} wrote ${id}, which the performance has not got`);
                return movement;
            }),
        );
        if (points.length !== 4) throw new Error(`${pedal}'s ramps wrote ${String(points.length)} movements, not four`);

        const guides = new Map(points.toSorted((a, b) => a.date - b.date).map(({ date, position }) => [date, position]));
        presses.push({ pedal, guides });
        replacing.set(down.id, [{ id: down.id, name: 'InsertPedal', options: { pedal, guides } }]);
        replacing.set(up.id, []);
    }

    const provenance = work.provenance.flatMap((call) => replacing.get(call.id) ?? [call]);
    return { work: { ...work, provenance }, presses };
};
