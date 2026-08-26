import { parseWorkFile, type WorkFile } from './Work';
import { migrateWork, isMigrated } from './migrateWork';

/**
 * Open a work file, whichever of the two shapes it is in.
 *
 * Every archive made before 2026-08-26 carries the JSON-LD/CIDOC-CRM graph — `@context`, a
 * `creation` holding `argumentations`, each with a `conclusion` — and there is a corpus of them.
 * The editor reads those by migrating on open rather than refusing them, so the conversion is
 * something that happens to a file you already have rather than a step you have to know about.
 *
 * The migration is `./migrateWork.ts`, the same code `scripts/migrateWork.ts` runs to produce
 * `public/work.json`, and it is deliberately not duplicated: it refuses rather than guesses on
 * anything it does not recognise — an unknown motivation, a dangling `continue`, an
 * `incorporates` that does not match the provenance — and those refusals belong in the app too.
 * A file that will not migrate cleanly is a file whose scholarship would be silently altered.
 */
export function migrateIfNeeded(json: string): WorkFile {
    const parsed: unknown = JSON.parse(json);

    if (isMigrated(parsed)) return parseWorkFile(json);

    const { work } = migrateWork(parsed);
    // Round-tripped through the reader so that a migrated file and a stored one arrive by the
    // same path — the `Map` and `Set` option envelopes are revived in exactly one place.
    return parseWorkFile(JSON.stringify(work));
}
