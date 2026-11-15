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

/**
 * The kern without the encoders' notes to themselves.
 *
 * A line such as `!LO:TX:b:t=P:note position:problem` says that something in the print is
 * engraved oddly. The importer draws it as a red warning sign under the staff, which is right
 * for whoever proofreads the encoding and wrong in a score that is to be read. The token is
 * emptied and the line left standing: every id in the MEI is a line and a field number, and a
 * line taken out would rename every note after it.
 */
const withoutProofreadingNotes = (kern) =>
    kern
        .split('\n')
        .map((line) =>
            line.startsWith('!') && !line.startsWith('!!')
                ? line
                      .split('\t')
                      .map((token) => (/^!LO:TX:.*:problem$/.test(token) ? '!' : token))
                      .join('\t')
                : line,
        )
        .join('\n');

const module = await createVerovioModule();
for (const file of readdirSync(kernDir).filter((name) => name.endsWith('.krn'))) {
    const out = join(meiDir, file.replace(/\.krn$/, '.mei'));
    if (existsSync(out)) continue;

    const toolkit = new VerovioToolkit(module);
    if (!toolkit.loadData(withoutProofreadingNotes(readFileSync(join(kernDir, file), 'utf-8')))) {
        console.log(`${file}: could not be read`);
        continue;
    }
    writeFileSync(out, toolkit.getMEI({ pageNo: 0, scoreBased: true }));
    console.log(file);
}
