import { lazy } from 'react';
import { inGroup } from './types';

/** The argument: instructions grouped into claims. */
export const argumentDesks = inGroup('argument', [
    {
        aspect: 'narrative',
        displayName: 'Narrative',
        desk: lazy(() =>
            import('../narrative/NarrativeDesk').then((m) => ({ default: m.NarrativeDesk })),
        ),
        help: {
            summary:
                'The instructions grouped into claims, in score order, with those belonging to no ' +
                'claim listed at the bottom. A working view, so it is a table.',
            actions: [
                {
                    gesture: 'Click an instruction chip',
                    does: 'select its call, and hear that one instruction over its reach',
                },
                { gesture: 'Backspace', does: 'remove the selected calls' },
                {
                    gesture: 'Hover a gesture',
                    does: "quote the element's attributes below the row",
                },
                {
                    gesture: 'Click assign',
                    does: "move the selected instructions into that row's segment",
                },
                { gesture: 'Click dissolve', does: 'ungroup it. The instructions survive' },
                { gesture: 'Type in Word', does: 'say what the claim says. It saves as you type' },
            ],
        },
    },
]);
