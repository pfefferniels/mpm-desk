/* global console, process */
// Convert Humdrum to MEI with a released verovio that carries the Humdrum importer, which the
// build vendored in this repository does not. The same call tests/alignment/fixtures/README.md
// describes: load the kern, write the MEI out score-based.
//
//     node kern2mei.mjs <verovio package dir> <kern dir> <mei dir>
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [packageDir, kernDir, meiDir] = process.argv.slice(2);
const dist = (file) => pathToFileURL(resolve(packageDir, 'dist', file)).href;
const { default: createVerovioModule } = await import(dist('verovio-module-hum.mjs'));
const { VerovioToolkit } = await import(dist('verovio.mjs'));

const module = await createVerovioModule();
for (const file of readdirSync(kernDir).filter((name) => name.endsWith('.krn'))) {
    const out = join(meiDir, file.replace(/\.krn$/, '.mei'));
    if (existsSync(out)) continue;

    const toolkit = new VerovioToolkit(module);
    if (!toolkit.loadData(readFileSync(join(kernDir, file), 'utf-8'))) {
        console.log(`${file}: could not be read`);
        continue;
    }
    writeFileSync(out, toolkit.getMEI({ pageNo: 0, scoreBased: true }));
    console.log(file);
}
