import type { DeskEntry } from './registry/types';
import { documentDesks } from './registry/document';
import { generalDesks } from './registry/general';
import { timingDesks } from './registry/timing';
import { dynamicsDesks } from './registry/dynamics';
import { pedallingDesks } from './registry/pedalling';
import { argumentDesks } from './registry/argument';
import { markupDesks } from './registry/markup';

export type { DeskHelp, DocumentFacts } from './registry/types';

/**
 * Which desk edits which aspect of the performance.
 *
 * Grouping calls and saying what a group claims is a step of its own, so it has a desk of its own
 * here beside the desks that edit a single dimension.
 *
 * Three transformers appear in no call of the reconstruction and are kept all the same, because
 * these desks put controls on them: the rubato Combine button, the ornamentation Style desk, and
 * `MakeDefaultArticulation`. `Order.ts` records that reasoning.
 *
 * Desks are `lazy`, so one arrives when it is opened. This module holds only what the aspect menu
 * needs to list a desk: its aspect, its group, the name it shows. The menu is built from this
 * list, so the list must stay readable without loading anything.
 *
 * Each group is written in a file of its own under `registry/`, and the order they are spread in
 * here is the order of the menu. `AspectSelect` draws a divider wherever `group` changes from one
 * entry to the next, so a group must be one run of the list.
 */
export const correspondingDesks: DeskEntry[] = [
    ...documentDesks,
    ...generalDesks,
    ...timingDesks,
    ...dynamicsDesks,
    ...pedallingDesks,
    ...argumentDesks,
    ...markupDesks,
];
