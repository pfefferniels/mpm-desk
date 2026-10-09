import { lazy } from 'react';
import { inGroup } from './types';

/**
 * The artefact itself. Last, and a group of its own, because it is what every desk above it has
 * been writing rather than another aspect of the performance. Named for what it shows: MPM is
 * Music Performance Markup.
 */
export const markupDesks = inGroup('markup', [
    {
        aspect: 'markup',
        desk: lazy(() => import('../markup/MarkupDesk').then((m) => ({ default: m.MarkupDesk }))),
        help: {
            summary:
                'The document as text: the MPM every other desk has been writing, and the MSM it ' +
                'was fitted against. There is no find field; the browser already has one.',
            actions: [
                {
                    gesture: 'Click a line in the MPM',
                    does: 'open the desk that wrote that element, where a call claims it',
                },
            ],
        },
    },
]);
