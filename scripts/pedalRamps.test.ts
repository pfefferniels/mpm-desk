/**
 * The migration of pedal ramps to guided presses (`pedalRamps.ts`), on a work file of two presses
 * and the performance its ramps wrote. Once welte225.org has migrated, this and the script can go,
 * as `migrateWork` did.
 */
import { describe, expect, test } from 'vitest';
import { migratePedalRamps } from './pedalRamps';
import { parseWorkFile, serializeWorkFile, type Call, type WorkFile } from '../src/model/Work';

const ramp = (id: string, pedal: string, direction: 'down' | 'up', depth = 1): Call => ({
    id,
    name: 'InsertPedal',
    options: { pedal, start: -100, duration: 200, depth, direction },
    elements: direction === 'down' ? [`${pedal}_start`, `${pedal}_moveDown`] : [`${pedal}_moveUp`, `${pedal}_end`],
    range: { from: 0, to: 0 },
});

const work = (): WorkFile => ({
    name: 'two presses',
    mei: '',
    mpm: '',
    provenance: [
        { id: 'tempo', name: 'InsertTempo', options: { bpm: 60 } },
        ramp('down0', 'sustain-0', 'down'),
        ramp('down1', 'soft-720', 'down', 0.5),
        ramp('up0', 'sustain-0', 'up'),
        ramp('up1', 'soft-720', 'up', 0.5),
        { id: 'dynamics', name: 'InsertDynamics', options: { guides: new Map([[0, 40]]) } },
    ],
    secondary: {},
} as unknown as WorkFile);

/** What the ramps wrote: soft-720's ramp down starts before the score, as WM 225's soft press did. */
const performance = `<mpm><movementMap>
<movement date="-100" position="0" transition.to="0.5" controller="soft" xml:id="soft-720_start" />
<movement date="-0.4" position="0" transition.to="1" controller="sustain" xml:id="sustain-0_start" />
<movement date="100" position="0.5" controller="soft" xml:id="soft-720_moveDown" />
<movement date="199.6" position="1" controller="sustain" xml:id="sustain-0_moveDown" />
<movement date="620.25" position="1" transition.to="0" controller="sustain" xml:id="sustain-0_moveUp" />
<movement date="820.25" position="0" controller="sustain" xml:id="sustain-0_end" />
<movement date="1340" position="0.5" transition.to="0" controller="soft" xml:id="soft-720_moveUp" />
<movement date="1540" position="0" controller="soft" xml:id="soft-720_end" />
</movementMap></mpm>`;

describe('pedal ramps, migrated', () => {
    const { work: migrated, presses } = migratePedalRamps(work(), performance);

    test('make one call of each press, through the four points its ramps ran between', () => {
        expect(presses).toEqual([
            { pedal: 'sustain-0', guides: new Map([[-0.4, 0], [199.6, 1], [620.25, 1], [820.25, 0]]) },
            { pedal: 'soft-720', guides: new Map([[-100, 0], [100, 0.5], [1340, 0.5], [1540, 0]]) },
        ]);
    });

    test('keep the ramp down’s id and place, and leave every other call as it was', () => {
        expect(migrated.provenance.map((call) => [call.id, call.name])).toEqual([
            ['tempo', 'InsertTempo'],
            ['down0', 'InsertPedal'],
            ['down1', 'InsertPedal'],
            ['dynamics', 'InsertDynamics'],
        ]);
        expect(migrated.provenance[1].options).toEqual({ pedal: 'sustain-0', guides: presses[0].guides });
        expect(migrated.provenance[0]).toEqual(work().provenance[0]);
        expect(migrated.provenance[3]).toEqual(work().provenance[5]);
    });

    test('save their guides as a work file carries a Map, and read them back', () => {
        const again = parseWorkFile(serializeWorkFile(migrated));

        expect(again.provenance[1].options).toEqual({ pedal: 'sustain-0', guides: presses[0].guides });
    });

    test('leave a work file without ramps alone', () => {
        expect(migratePedalRamps(migrated, performance)).toEqual({ work: migrated, presses: [] });
    });

    test('refuse a ramp whose movements the performance has not got', () => {
        expect(() => migratePedalRamps(work(), '<mpm/>')).toThrow('down0 wrote sustain-0_start');
    });
});
