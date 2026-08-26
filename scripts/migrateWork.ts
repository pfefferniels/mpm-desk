/**
 * The migration, as a command.
 *
 * Thin on purpose: everything that decides anything lives in `src/model/migrateWork.ts`, because
 * the editor migrates a file the moment it is opened and the two must not be able to disagree.
 * This is `readFileSync`, `writeFileSync` and a usage line.
 *
 * The logic must not live here: the app imports it, and a `node:fs` import in that path reaches
 * the browser bundle, where Vite externalises it and the page fails only at runtime.
 *
 *     npx vite-node scripts/migrateWork.ts public/info.json public/work.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { describe, migrateWorkText } from '../src/model/migrateWork.ts';

const main = (argv: string[]): void => {
    const [input, output] = argv;
    if (input === undefined || output === undefined) {
        console.error('usage: migrateWork <old.json> <new.json>');
        process.exitCode = 1;
        return;
    }

    const { text: migrated, report } = migrateWorkText(readFileSync(input, 'utf8'));
    writeFileSync(output, migrated, 'utf8');
    console.log(`${input} -> ${output}`);
    console.log(describe(report));
};

// Run only when invoked as a command, so the test can import the functions above.
const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(invoked).href) {
    main(process.argv.slice(2));
}
