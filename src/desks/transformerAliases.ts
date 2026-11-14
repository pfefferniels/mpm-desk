import { correspondingDesks } from './DeskSwitch';

/**
 * Calls another transformer's desk serves, by the name the call was saved under:
 * `TranslatePhysicalTimeToTicks`, which the chain makes for itself and the tempo desk answers for;
 * `CorrectPedal` and `Expand`, which the corrections desk makes beside `Modify`; and what a desk's
 * buttons make beside the calls its gestures do, `CombineAdjacentRubatos` on the rubato desk,
 * `MergeMetricalAccentuations` on the accentuation desk and `MakeDefaultArticulation` on the
 * articulation desk.
 *
 * {@link deskOfCall} maps a call's name through this before it looks for the desk that made it,
 * and `DeskSwitch.test.ts` checks every entry against the desk registry.
 *
 * A `Map` rather than an object literal, so that a call named after an `Object.prototype` member
 * cannot read back an inherited function as its desk's transformer.
 */
export const TRANSFORMER_ALIASES: ReadonlyMap<string, string> = new Map([
    ['TranslatePhysicalTimeToTicks', 'InsertTempo'],
    ['CorrectPedal', 'Modify'],
    ['Expand', 'Modify'],
    ['CombineAdjacentRubatos', 'InsertRubato'],
    ['MergeMetricalAccentuations', 'InsertMetricalAccentuation'],
    ['MakeDefaultArticulation', 'InsertArticulation'],
]);

/**
 * The desk a call was made on, by the key the registry selects it under — or none, where no desk
 * makes that call, or the one that does is the editor's alone and this is the viewer.
 *
 * What a link to a call and a click in the markup desk open. Here rather than in `App`, so that
 * `DeskSwitch.test.ts` can ask it of every transformer the chain registers: a name it misses is a
 * link that selects its call and leaves the reader on whatever desk was open.
 */
export const deskOfCall = (name: string, editable: boolean): string | undefined => {
    const claimed = TRANSFORMER_ALIASES.get(name) ?? name;
    const entry = correspondingDesks.find(
        ({ transformerName, editOnly }) => transformerName === claimed && (editable || !editOnly),
    );
    return entry && (entry.displayName ?? entry.aspect);
};
