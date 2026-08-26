import { test } from 'vitest';
import { runAligned } from './aligned';
import { allCases } from './cases';
import { describe as describeErrors, roundTrip } from './harness';
import { findViolations } from './invariants';

/**
 * Prints what every case currently measures, so bounds can be re-recorded from evidence rather
 * than guessed at. Skipped unless asked for, because it is a report and not an assertion:
 *
 *     ROUNDTRIP_REPORT=1 npx vitest run tests/fitting/roundtrip/report.test.ts
 */
test.skipIf(!process.env.ROUNDTRIP_REPORT)(
  'round-trip report',
  () => {
    for (const spec of allCases) {
      try {
        const result = roundTrip(spec);
        const violations = findViolations(result.fittedXml);
        console.log(
          `${spec.name.padEnd(52)} ${describeErrors(result.errors)}${
            result.errors.missing ? `  MISSING ${result.errors.missing}` : ''
          }${
            violations.length
              ? `\n    !! ${violations.map((v) => `[${v.check}] ${v.detail}`).join('\n    !! ')}`
              : ''
          }`,
        );
      } catch (error) {
        console.log(`${spec.name.padEnd(52)} THREW ${(error as Error).message}`);
      }
    }
  },
  120_000,
);

/** The same, for the aligned fixture — whose bounds are recorded in `aligned.test.ts`. */
test.skipIf(!process.env.ROUNDTRIP_REPORT)(
  'aligned report',
  () => {
    const run = runAligned();
    const share = (aspect: 'onset' | 'duration' | 'velocity') =>
      `${(run.explained[aspect] * 100).toFixed(1)}% of ${run.exercised[aspect].mean.toFixed(1)}`;
    console.log(
      `aligned fixture: ${run.calls.ran}/${run.calls.declared} calls, ${run.errors.matched} notes` +
        `\n    ${describeErrors(run.errors)}` +
        `\n    median onset ${run.errors.onset.median.toFixed(2)} ms · ` +
        `duration ${run.errors.duration.median.toFixed(2)} ms · ` +
        `velocity ${run.errors.velocity.median.toFixed(2)}` +
        `\n    explained: onset ${share('onset')} ms · duration ${share('duration')} ms · ` +
        `velocity ${share('velocity')}${
          findViolations(run.mpmXml).length
            ? `\n    !! ${findViolations(run.mpmXml)
                .map((v) => `[${v.check}] ${v.detail}`)
                .join('\n    !! ')}`
            : ''
        }`,
    );
  },
  120_000,
);
