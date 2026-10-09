import { lazy } from 'react';
import { allOf, needsChoice, needsRecording } from './prerequisites';
import { inGroup } from './types';

/** Dynamics: velocity, accentuation and articulation. */
export const dynamicsDesks = inGroup('dynamics', [
    {
        transformerName: 'InsertDynamicsInstructions',
        aspect: 'dynamics',
        desk: lazy(() =>
            import('../dynamics/DynamicsDesk').then((m) => ({ default: m.DynamicsDesk })),
        ),
        help: {
            summary:
                'One dot per recorded velocity per chord, with the fitted dynamics curves over ' +
                'them and a grey ghost where a velocity was corrected by hand. A curve is fitted ' +
                'between two anchors: a chord onset, or a phantom velocity pencilled in on the ' +
                'grid where the recording sounds nothing.',
            actions: [
                { gesture: 'Hover a dot', does: 'sound the chord there' },
                { gesture: 'Click a dot', does: 'play from that date to the end' },
                {
                    gesture: 'Drag across the plot',
                    does: 'fit a curve between two anchors, in Insert mode',
                },
                {
                    gesture: 'Click a dot in Phantom mode',
                    does: 'pencil in a phantom velocity there',
                },
                {
                    gesture: 'Click the plot in Phantom mode',
                    does: 'pencil one in on the grid, over a rest or inside a held note',
                },
                { gesture: 'Click a phantom', does: 'pick it for ↑ ↓' },
                { gesture: '↑ ↓', does: 'nudge the phantom last picked by one' },
                { gesture: 'Shift+Alt-click a phantom', does: 'remove it' },
                { gesture: 'Click a curve', does: 'select the call that wrote it' },
                { gesture: 'Backspace', does: 'remove the selected call, closer and all' },
            ],
        },
        writes: ['dynamics'],
        unavailable: allOf(needsRecording, needsChoice),
    },
    {
        transformerName: 'InsertMetricalAccentuation',
        desk: lazy(() =>
            import('../accentuation/AccentuationDesk').then((m) => ({
                default: m.AccentuationDesk,
            })),
        ),
        displayName: 'Metrical Accentuation',
        aspect: 'accentuation',
        help: {
            summary:
                'The velocity residual, recorded minus what the MPM already renders, one dot per ' +
                'chord, with the accentuation patterns written over it.',
            actions: [
                { gesture: 'Hover a dot', does: 'sound the chord there' },
                { gesture: 'Click the plot', does: 'start a candidate range at the nearest dot' },
                { gesture: 'Move the pointer', does: 'draw the range out to the dot under it' },
                { gesture: 'Click again', does: 'close the range there' },
                { gesture: 'Shift-click', does: "move the candidate's nearer end to that dot" },
                { gesture: 'Esc, Shift+Alt-click the candidate', does: 'clear it' },
                { gesture: 'Click a pattern', does: 'select the call that wrote it' },
                { gesture: 'Shift-click a pattern', does: 'add it to the merge selection' },
                { gesture: 'Backspace', does: 'remove the selected call' },
            ],
        },
        holdOut: ['accentuationPattern'],
        writes: ['accentuationPattern'],
        // No tempo: the residual this plots is the velocity half, which espressivo renders
        // whether or not anything has placed the notes on the tick grid.
        unavailable: allOf(needsRecording, needsChoice),
    },
    {
        transformerName: 'InsertArticulation',
        aspect: 'articulation',
        desk: lazy(() =>
            import('../articulation/ArticulationDesk').then((m) => ({
                default: m.ArticulationDesk,
            })),
        ),
        displayName: 'Articulation',
        help: {
            summary:
                'Recorded release against notated release, one bar per note: pitch on the ' +
                'vertical, bar thickness by velocity residual, the notated release a dashed tick.',
            actions: [
                { gesture: 'Hover a note', does: 'sound it' },
                { gesture: 'Click a note', does: 'start a unit with it' },
                { gesture: 'Shift-click a note', does: 'add it to the unit, or drop it' },
                {
                    gesture: 'Click an articulated note',
                    does: 'select the call that wrote it. Such a note joins no unit',
                },
                { gesture: 'Backspace', does: 'remove the selected call' },
            ],
        },
        holdOut: ['articulation'],
        writes: ['articulation'],
        // Recording only — see the note on `needsTempo` for why this desk is left open without one.
        unavailable: allOf(needsRecording, needsChoice),
    },
    {
        transformerName: 'StylizeArticulation',
        aspect: 'articulation',
        displayName: 'Style',
        desk: lazy(() =>
            import('../styles/ArticulationStyles').then((m) => ({ default: m.ArticulationStyles })),
        ),
        help: {
            summary:
                'One point per articulation in scope, relative duration against relative volume, ' +
                'coloured by cluster. Both axes are ratios against the notated value, so 1 is a ' +
                'place on each.',
            actions: [
                {
                    gesture: 'Drag a tolerance',
                    does: 're-cluster the preview. Nothing is written until Stylize Articulations',
                },
            ],
        },
    },
]);
