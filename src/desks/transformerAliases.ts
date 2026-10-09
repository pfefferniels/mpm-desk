/**
 * Calls another transformer's desk serves, by the name the call was saved under:
 * `TranslatePhysicalTimeToTicks`, which the chain makes for itself and the tempo desk answers for,
 * and `CorrectPedal`, which the corrections desk makes beside `Modify`.
 *
 * `useCallFocus` maps a call's name through this before it looks for the desk that made it, and
 * `DeskSwitch.test.ts` checks every entry against the desk registry.
 *
 * A `Map` rather than an object literal, so that a call named after an `Object.prototype` member
 * cannot read back an inherited function as its desk's transformer.
 */
export const TRANSFORMER_ALIASES: ReadonlyMap<string, string> = new Map([
    ['TranslatePhysicalTimeToTicks', 'InsertTempo'],
    ['CorrectPedal', 'Modify'],
]);
