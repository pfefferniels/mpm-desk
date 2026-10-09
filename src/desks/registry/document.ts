import { lazy } from 'react';
import { needsRecording } from './prerequisites';
import { inGroup } from './types';

/** The document itself, a group of its own so the menu sets it apart. */
export const documentDesks = inGroup('document', [
    {
        aspect: 'metadata',
        desk: lazy(() =>
            import('../metadata/MetadataDesk').then((m) => ({ default: m.MetadataDeskEntry })),
        ),
        help: {
            summary:
                'Title and author, set as a title page, over a count of what the document holds.',
            actions: [
                { gesture: 'Click a line', does: 'edit it in place. Leaving the field commits' },
                { gesture: 'Enter', does: 'commit and leave the field' },
                { gesture: 'Esc', does: 'discard the edit' },
            ],
        },
    },
    // Beside metadata, in the document's own group: which MEI voice goes into which MSM part is a
    // statement about the score's encoding rather than about a dimension of the sound, and it is
    // upstream of everything — it decides what the scope picker offers every other desk.
    {
        transformerName: 'ProcessVoices',
        aspect: 'voices',
        desk: lazy(() => import('../voices/VoicesDesk').then((m) => ({ default: m.VoicesDesk }))),
        help: {
            summary:
                'Which MEI voice goes into which MSM part: the engraved score coloured by part, ' +
                'with the parts listed beside it.',
            actions: [
                { gesture: 'Click a notehead', does: 'select that note' },
                { gesture: '⌘-click a notehead', does: 'add it to the selection, or drop it' },
                { gesture: 'Hover a part', does: 'fade every other part in the score' },
                { gesture: 'Click a part', does: 'select it alone' },
                { gesture: '⌘-click a part', does: 'add it. Two or more allow Combine' },
                { gesture: 'Click a voice chip', does: 'pick that voice whole, for Move to…' },
                { gesture: 'Esc', does: 'drop the notes, the voice and the parts' },
                { gesture: 'Enter, Esc in a name field', does: 'commit, revert the rename' },
            ],
        },
        // No hold-out: this desk plots no residual. It draws the score verovio engraves, coloured
        // by the part the chain resolved, and there is nothing for the MPM to explain away when
        // the subject is which staff a note is written on.
        //
        // Gated even though the engraving draws in full without a recording, which is the one
        // place this list makes that call. Everything the reader can do here comes out of `msm`:
        // the parts the score is coloured by, the voices the picker offers, and the bars
        // `tickRange` takes a range from. Ungated it is a whole score that answers no click,
        // reachable over any MEI whose `<performance>` times some notes but not all.
        unavailable: needsRecording,
    },
]);
