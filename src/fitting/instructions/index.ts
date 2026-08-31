/**
 * The MPM layer: espressivo's document, and the routing that puts a {@link Scope} and an
 * instruction type in front of it.
 *
 * There is no document class here and no record model. A transformer is handed espressivo's own
 * `Mpm` and writes through espressivo's own maps; what this module adds is functions — a scope
 * resolved to a map, a map read back as a list, the two sweeps that say what a transformer just
 * did, and the one merge contract two pairs of transformers share.
 */
export * from './types';
export * from './scope';
export * from './read';
export * from './styles';
export * from './ornamentDraft';
export * from './silentOrnaments';
export * from './fillInAt';

/**
 * The espressivo classes a transformer builds a definition with, re-exported so that writing an
 * `<articulationDef>` does not mean importing from two packages at once.
 */
export { Mpm } from 'espressivo';
export { AccentuationPatternDef } from 'espressivo';
export { ArticulationDef } from 'espressivo';
export { OrnamentDef } from 'espressivo';
export { FrameDomain, NoteOffShift } from 'espressivo';
