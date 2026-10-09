import { lazy } from 'react';
import { needsRecording } from './prerequisites';
import { inGroup } from './types';

/**
 * The three desks whose subject is the recording rather than the performance, in the order they
 * are used. Alignment is first because nothing else can say anything until the score and the
 * recording have been put note against note, and the takes it writes are what Base Text then
 * chooses between.
 */
export const generalDesks = inGroup('general', [
    // No `transformerName`: the `Align` call it writes is one the chain does not run (see
    // `chain.ts`). Nothing looks for a desk by that name either, since an `Align` writes no
    // instruction and so reaches neither the narrative nor the markup desk, which is where
    // `focusCall` is reached from.
    {
        aspect: 'alignment',
        desk: lazy(() =>
            import('../alignment/AlignmentDesk').then((m) => ({ default: m.AlignmentDesk })),
        ),
        help: {
            summary:
                'Which sounding event realises which written note. Align runs the model and ' +
                'leaves a draft; Apply writes it into the score.',
            actions: [
                {
                    gesture: 'Click a disagreement mark',
                    does: 'open its question: a cross, a bracket or a coloured notehead',
                },
                { gesture: 'Click elsewhere in the score', does: 'close it' },
                { gesture: 'Drag the range slider', does: 'narrow what the transport plays' },
            ],
        },
    },
    {
        aspect: 'source choice',
        displayName: 'Base Text',
        desk: lazy(() => import('../choice/ChoiceDesk').then((m) => ({ default: m.ChoiceDesk }))),
        transformerName: 'MakeChoice',
        help: {
            summary:
                'Every reading on one roll, a brace over each set of readings of a note, so that ' +
                'one source can be preferred for the piece or for a narrower scope.',
            actions: [
                { gesture: 'Click a note', does: 'scope the choice to it' },
                {
                    gesture: '⌘-click a note',
                    does: 'add it, where a note scope is already standing',
                },
                { gesture: 'Shift-click a later note', does: 'reach from the scope to it' },
            ],
        },
        // A choice needs something to choose between. With one take every preference the dialog
        // offers names the same recording, so a `MakeChoice` can only restate the document while
        // still discarding a note wherever two parts sound the same pitch at the same moment,
        // which is what its equivalence groups are keyed on.
        unavailable: ({ readings }) =>
            readings > 1
                ? undefined
                : readings === 1
                  ? 'The score has one recording, so there is no other reading to prefer.'
                  : 'No recording has been aligned into the score yet.',
    },
    // Beside Base Text: these two edit the *recording* rather than the performance, the one
    // distinction the menu's groups can make that the aspect names cannot.
    {
        transformerName: 'Modify',
        aspect: 'corrections',
        desk: lazy(() =>
            import('../corrections/CorrectionsDesk').then((m) => ({ default: m.CorrectionsDesk })),
        ),
        help: {
            summary:
                'What the roll scan read wrong. A correction edits the recording itself, so it ' +
                'writes no instruction; a drag is a draft until Apply.',
            actions: [
                { gesture: 'Press a note or pedal', does: 'select it' },
                { gesture: '⌘-press', does: 'add it to the selection, or drop it' },
                { gesture: 'Shift-press', does: 'reach from the selection to it' },
                {
                    gesture: 'Drag up or down',
                    does: 'shift velocity by whole steps, on the Velocity plot',
                },
                {
                    gesture: 'Drag sideways',
                    does: 'shift the onset, on the Timing plot. Near the right edge, the release',
                },
                { gesture: 'Drag a handle', does: 'move that vertex of the pedal line' },
                { gesture: 'Drag a flat run', does: 'raise or lower the hold, both ends together' },
                { gesture: '⌥-press the line', does: 'add a vertex there, and drag it' },
                { gesture: '⇧⌥-press a handle', does: 'drop that vertex' },
                { gesture: '⇧⌥-press a pedal', does: 'drop the press' },
                { gesture: '⌥-press an empty lane', does: 'add a press there' },
                { gesture: 'Hover a dot', does: 'sound the chord there, on the Velocity plot' },
                { gesture: 'Esc', does: 'drop the selection and the drawn correction' },
            ],
        },
        // No hold-out: like the dynamics desk, this one plots the recording raw. There is nothing
        // for the MPM to explain away when the subject is what the roll scan read.
        unavailable: needsRecording,
    },
]);
