import { lazy } from 'react';
import { allOf, needsChoice, needsRecording, needsTempo } from './prerequisites';
import { inGroup } from './types';

/** Pedalling. */
export const pedallingDesks = inGroup('pedalling', [
    {
        transformerName: 'InsertPedal',
        aspect: 'pedalling',
        desk: lazy(() => import('../pedal/PedalDesk').then((m) => ({ default: m.PedalDesk }))),
        help: {
            summary:
                'The line each recorded press drew, on the tick grid, sustain over soft, with ' +
                'the movements already written below, one lane per controller.',
            actions: [
                {
                    gesture: 'Click a press',
                    does: 'write its line as movements, each traversal fitted as one',
                },
                { gesture: 'Hover a chord line', does: 'sound the chord' },
                { gesture: 'Click a movement', does: 'select the call that wrote it' },
                { gesture: 'Backspace', does: 'remove the selected call' },
            ],
        },
        // A recorded pedal has no symbolic date of its own; the residual is the only thing that
        // can put one on the tick grid at all.
        holdOut: ['movement'],
        unavailable: allOf(needsRecording, needsChoice, needsTempo),
    },
]);
