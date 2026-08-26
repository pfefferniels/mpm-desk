/**
 * A structural digest of what the chain produces.
 *
 * Not an assertion — a recorder. `MIGRATION_DIGEST=1 npx vitest run tests/fitting/mpmDigest.test.ts`
 * writes one line per instruction element of every round-trip case to
 * `tests/fitting/fixtures/mpm-digest.txt`: case, scope, element name, and every attribute as
 * `name=value` sorted by name.
 *
 * Sorted, because attribute order is the renderer's to choose and the fitter's is not the
 * interesting difference. Sorting takes the one difference that is expected out of the comparison
 * and leaves every difference that is not.
 *
 * The chain is deterministic (`determinism.test.ts` folds it twice and compares), so a
 * digest taken before and after a change that is meant to preserve behaviour must match line for
 * line.
 *
 * ## What legitimately moves it
 *
 * Two things, and neither is a difference in what renders:
 *
 * 1. **espressivo omits an attribute at its default and writes some unconditionally.**
 *    `<temporalSpread>` leaves out `noteoff.shift="false"` and `time.unit="ticks"`; `<ornament>`
 *    always carries `scale="0"`, the spec's own default. Same documents, different bytes.
 * 2. **Last-digit float noise.** The fitters are iterative, so a change of 1e-16 in an input
 *    reaches the output as ~1e-9 — which is what dropping the alignment's seconds/milliseconds
 *    round trip did to four of the cases. `ROUNDTRIP_REPORT=1` is the check that matters
 *    there: it reports to two decimals and must not move at all.
 *
 * Anything else is a behaviour change, and the digest is how it gets noticed.
 *
 * ## What it is worth after the move
 *
 * `fixtures/mpm-digest.txt` came across from espressivo and describes a chain that no longer
 * exists: nineteen cases, four of them pure tempo, fitted by `ApproximateLogarithmicTempo`.
 * Re-running this writes a different file top to bottom, and the diff would say nothing but
 * "the six transformers are gone", which is already known.
 *
 * So the shipped digest is a **record of where this came from**, not a baseline. It becomes an
 * instrument again the moment it is re-recorded here — one `MIGRATION_DIGEST=1` run, committed
 * — after which it does for this repo what it did for espressivo: catch a change to the
 * surviving chain that was meant to preserve behaviour and did not.
 */
import { describe, test } from 'vitest';
import { writeFileSync } from 'fs';
import { join } from 'path';
// The raw parser, not espressivo's `Builder`: the digest wants every attribute of every
// element, and XomTypes' `Element` looks attributes up by name without ever listing them.
//
// In espressivo this was `@xmldom/xmldom`, imported directly. Here it is the platform parser —
// the vitest environment is jsdom, so `DOMParser` and `Element` are globals — which keeps a
// dependency out of `package.json` for the sake of a recorder that is skipped by default. The
// two disagree about nothing this walk reads: `localName`, `attributes` and `childNodes`.
import { allCases } from './roundtrip/cases';
import { roundTrip } from './roundtrip/harness';

const OUT = join(import.meta.dirname, 'fixtures', 'mpm-digest.txt');

/**
 * One thing in a fitted document is still random: `ensureDefaultStyle` mints the `<style>`
 * switch's `@xml:id` with `v4()`, so the same chain over the same score names it differently on
 * every run. Definition names are not — they are derived from what they describe — so this is
 * the whole of it.
 *
 * Each distinct uuid becomes `#0`, `#1`, … in first-seen order, which keeps *which elements
 * share an id* in the comparison and leaves the random part out of it.
 */
const canonicalIds = (attributes: string[], seen: Map<string, string>): string[] =>
  attributes.map((a) =>
    a.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => {
      const known = seen.get(id);
      if (known !== undefined) return known;
      const fresh = `#${String(seen.size)}`;
      seen.set(id, fresh);
      return fresh;
    }),
  );

/** Every element of an MPM document, as `path :: name attr=value …` with attributes sorted. */
const digest = (xml: string): string[] => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const lines: string[] = [];
  const seen = new Map<string, string>();

  const walk = (element: Element, path: string) => {
    const here = `${path}/${element.localName}`;
    const attributes = canonicalIds(
      [...element.attributes].map((a) => `${a.name}="${a.value}"`).sort(),
      seen,
    );
    // Containers carry no information of their own; only leaves and named things are listed.
    if (attributes.length > 0) lines.push(`${here} ${attributes.join(' ')}`);
    for (const child of [...element.childNodes]) if (child instanceof Element) walk(child, here);
  };

  const root = doc.documentElement;
  if (root) walk(root, '');
  return lines;
};

describe('mpm digest', () => {
  test.runIf(process.env.MIGRATION_DIGEST)(
    'records what the chain writes',
    () => {
      const lines: string[] = [];
      for (const spec of allCases) {
        lines.push(`### ${spec.name}`);
        const result = roundTrip(spec);
        lines.push(...digest(result.fittedXml).map((l) => `  ${l}`));
      }
      writeFileSync(OUT, `${lines.join('\n')}\n`);
      console.log(`wrote ${String(lines.length)} lines to ${OUT}`);
    },
    300_000,
  );
});
