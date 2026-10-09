/**
 * Calls another transformer's desk serves, by the name the call was saved under: retired names,
 * and `CorrectPedal`, which the corrections desk makes beside `Modify`.
 *
 * `App` maps a call's name through this before it looks for the desk that made it, and
 * `DeskSwitch.test.ts` checks every entry against the desk registry.
 *
 * Not the transformer registry's `registerAlias`, which records *renames* so that an old work file
 * still builds the right transformer. Its one entry maps the misspelled
 * `TranslatePhyiscalTimeToTicks` onto `TranslatePhysicalTimeToTicks`, which has no desk at all;
 * this table answers which desk a name should open, and sends all three retired names to
 * `InsertTempo`.
 *
 * A `Map` rather than an object literal, so that a call named after an `Object.prototype` member
 * cannot read back an inherited function as its desk's transformer.
 */
export const TRANSFORMER_ALIASES: ReadonlyMap<string, string> = new Map([
    ['ApproximateLogarithmicTempo', 'InsertTempo'],
    ['TranslatePhysicalTimeToTicks', 'InsertTempo'],
    ['TranslatePhyiscalTimeToTicks', 'InsertTempo'],
    ['CorrectPedal', 'Modify'],
]);
