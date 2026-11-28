/**
 * A description resolved against a recording: the engine of the describe desk.
 *
 * Loading this module makes the fitted steps known to the registry. It is loaded by the desk's
 * worker and by tests; the page itself takes `client.ts`, which loads none of it.
 */
export { describe } from './run';
export type { DescribeRunOptions, DescriptionRun, RemarkReport, StepReport } from './run';
export type { Assumed, Roll, RollNote } from './roll';
export type { Sounded } from './perform';
export type { Step } from './expand';
export { bringOut } from './bringOut';
export type { BroughtOut } from './bringOut';
