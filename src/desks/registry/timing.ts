import { lazy } from 'react';
import { allOf, needsChoice, needsRecording, needsTempo } from './prerequisites';
import { inGroup } from './types';

/**
 * Timing, top to bottom in the order the work is done. Arpeggiation before tempo, because that is
 * where the chain puts it: `InsertDynamicsGradient` and `InsertTemporalSpread` run before
 * `InsertTempo` in `Order.ts`, reading onsets in the recording's own domain, which a fitted tempo
 * has rewritten by the time the tempo desk is done.
 */
export const timingDesks = inGroup('timing', [
    {
        transformerName: 'InsertTemporalSpread',
        desk: lazy(() =>
            import('../arpeggiation/TemporalSpreadDesk').then((m) => ({
                default: m.TemporalSpreadDesk,
            })),
        ),
        displayName: 'Temporal Spread',
        aspect: 'arpeggiation',
        help: {
            summary:
                "Each chord's measured onset spread as a block, over the local tempo " +
                'variance, with the spreads already written in a strip below.',
            actions: [
                { gesture: 'Hover a chord', does: 'sound it, and read its frame in ms' },
                { gesture: 'Click a chord', does: 'select it for Insert' },
                {
                    gesture: 'Insert Default',
                    does: "spread every chord in the scope whose roll is longer than the dialog's "
                        + 'Duration Threshold, in ms',
                },
                {
                    gesture: 'Hover a written spread',
                    does: 'audition the roll as that ornament specifies it',
                },
                { gesture: 'Click a written spread', does: 'select the call that wrote it' },
                { gesture: 'Backspace', does: 'remove the selected call' },
            ],
        },
        // Both arpeggiation desks write the same `<ornamentMap>`, so either one of them having
        // filled a scope locks the other's picker the same way. That is the document's doing, not
        // a coupling between the desks: it is one map per scope either way.
        writes: ['ornament'],
        unavailable: allOf(needsRecording, needsChoice),
    },
    {
        transformerName: 'InsertDynamicsGradient',
        desk: lazy(() =>
            import('../arpeggiation/DynamicsGradientDesk').then((m) => ({
                default: m.DynamicsGradientDesk,
            })),
        ),
        displayName: 'Dynamics Gradient',
        aspect: 'arpeggiation',
        help: {
            summary:
                "The recorded velocities over time: a hull joining each chord's softest and " +
                "loudest note to the next chord's, with the gradients already written over it.",
            actions: [
                {
                    gesture: 'Hover a chord',
                    does: 'sound it. A handle follows the pointer up and down',
                },
                { gesture: 'Click the handle', does: 'write a ramp with its zero at that height' },
                {
                    gesture: "Click the chord's line",
                    does: 'write a ramp over the measured extremes',
                },
                { gesture: 'Click a written gradient', does: 'select the call that wrote it' },
                { gesture: 'Backspace', does: 'remove the selected call' },
            ],
        },
        writes: ['ornament'],
        unavailable: allOf(needsRecording, needsChoice),
    },
    {
        transformerName: 'StylizeOrnamentation',
        desk: lazy(() =>
            import('../styles/OrnamentationStyles').then((m) => ({
                default: m.OrnamentationStyles,
            })),
        ),
        aspect: 'arpeggiation',
        displayName: 'Styles',
        help: {
            summary:
                'One point per fitted ornament, frame start against frame length, coloured by the ' +
                'definition the clustering would put it in.',
            actions: [
                {
                    gesture: 'Drag a tolerance',
                    does: 're-cluster the preview. Nothing is written until Stylize Ornaments',
                },
            ],
        },
    },
    {
        transformerName: 'InsertTempo',
        desk: lazy(() => import('../tempo/TempoDesk').then((m) => ({ default: m.TempoDesk }))),
        aspect: 'tempo',
        help: {
            summary:
                "The recording's tempo as a skyline of boxes against seconds, with the tempo " +
                'curves already in the document drawn over it.',
            actions: [
                { gesture: 'Hover a box', does: 'sound the passage it covers' },
                { gesture: 'Click a box', does: 'select it alone' },
                { gesture: 'Shift-click a box', does: 'add it to the selection' },
                { gesture: 'Shift+Alt-click a box', does: 'remove it' },
                {
                    gesture: 'Drag in Draw mode',
                    does: 'draw a curve. The whole stroke is fitted, so its shape sets the bend',
                },
                {
                    gesture: "Drag from a curve's end",
                    does: "continue it at that curve's beat length",
                },
                {
                    gesture: 'Click a box in Split mode',
                    does: 'split it in the middle of its tick range',
                },
                {
                    gesture: 'Hover a written curve',
                    does: 'hear the passage re-timed by it, over a click',
                },
                { gesture: 'Click a written curve', does: 'select the call that wrote it' },
                { gesture: 'Esc', does: 'deselect, and cancel the stroke in hand' },
                { gesture: 'c', does: 'combine the selected boxes' },
                { gesture: 's', does: 'toggle Split mode' },
                {
                    gesture: 'Backspace',
                    does: 'delete the selected boxes, else remove the selected call',
                },
            ],
        },
        writes: ['tempo'],
        // The recording, and only the recording: the skyline is the recording's own inter-onset
        // intervals, so this desk is where a tempo comes from and cannot want one.
        unavailable: allOf(needsRecording, needsChoice),
    },
    {
        transformerName: 'InsertRubato',
        desk: lazy(() => import('../rubato/RubatoDesk').then((m) => ({ default: m.RubatoDesk }))),
        aspect: 'rubato',
        help: {
            summary:
                'Every chord hooked from its score date to where the recording put it, with ' +
                'rubato held out of the fit, so the displacement drawn is what a rubato would ' +
                'have to account for.',
            actions: [
                { gesture: 'Hover the row', does: 'sound the nearest date, and read its tick' },
                {
                    gesture: 'Click twice',
                    does: 'mark a frame between the two dates, either order',
                },
                { gesture: 'Click again', does: 'start a new frame, discarding the last' },
                { gesture: 'Click the frame', does: 'audition the passage it covers' },
                {
                    gesture: 'Click a written rubato',
                    does: 'hear its frame warped, and select the call that wrote it',
                },
                { gesture: 'Backspace', does: 'remove the selected call' },
            ],
        },
        holdOut: ['rubato'],
        writes: ['rubato'],
        unavailable: allOf(needsRecording, needsChoice, needsTempo),
    },
]);
