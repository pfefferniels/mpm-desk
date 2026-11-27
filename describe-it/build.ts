/**
 * Build what the DescribeIt page is published with, into `describe-it/dist/`.
 *
 *     WELTE225=../welte225.org npx vite-node describe-it/build.ts
 *
 * - `engine.js`, the fitting chain bundled for the browser (`engine.ts`), which is also its own
 *   worker;
 * - `piece.json`, the alignment of the published transcription with its base text chosen;
 * - `reference.json`, the calls of the published reconstruction, for comparison;
 * - `knowledge.txt`, what the expert is told, joined from `knowledge/*.md`;
 * - `examples.json` and `app.js`, copied beside them, so that the directory is the page's files.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

// `asMSM` reads the MEI with the platform `DOMParser`, which node has not got.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).DOMParser ??= new JSDOM().window.DOMParser;

import { convertMeiToMsm } from 'espressivo';
import { runFit } from '../src/fitting/fit';
import { asMSM } from '../src/fitting/asMSM';
import { parseWorkFile, type Call } from '../src/model/Work';
import { publishedPath } from '../src/test/published';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, 'dist');
mkdirSync(dist, { recursive: true });

const quietly = <T>(work: () => T): T => {
  const { log } = console;
  console.log = () => undefined;
  try {
    return work();
  } finally {
    console.log = log;
  }
};

// The piece: the published transcription, with the base text its reconstruction chose. A roll of
// two takes side by side is a question for the choice desk, not for somebody describing one.
const mei = readFileSync(publishedPath('mei'), 'utf-8');
const rawWork = readFileSync(publishedPath('work'), 'utf-8');
const work = parseWorkFile(rawWork);
const movement = convertMeiToMsm(mei)[0];
if (!movement) throw new Error('the transcription holds no movement');
const alignment = quietly(() => asMSM(mei, movement.msm, movement.graces));
quietly(() =>
  runFit({ ...work, provenance: work.provenance.filter((call) => call.name === 'MakeChoice') }, alignment),
);

/** Without the link to the roll's symbol, which is a third of the file and nothing here follows. */
const plain = <T extends object>(rows: readonly T[]) =>
  rows.map((row) => {
    const { symbol, ...rest } = row as T & { symbol?: string };
    void symbol;
    return rest;
  });

const piece = {
  title: work.name,
  alignment: {
    allNotes: plain(alignment.allNotes),
    pedals: plain(alignment.pedals),
    graces: plain(alignment.graces),
    tiedPrincipals: alignment.tiedPrincipals,
    timeSignatures: alignment.timeSignatures,
  },
};
writeFileSync(resolve(dist, 'piece.json'), JSON.stringify(piece));

// The published calls, as written: the envelopes of their `Map`s and `Set`s are carried through
// as text, which is why this reads the file again rather than the parsed work.
const DOCUMENT = new Set(['AlignSource', 'MakeChoice', 'InsertMetadata']);
const reference = (JSON.parse(rawWork) as { provenance: Call[] }).provenance
  .filter((call) => !DOCUMENT.has(call.name))
  .map(({ id, name, options }) => ({ id, name, options }));
writeFileSync(resolve(dist, 'reference.json'), JSON.stringify(reference));

const knowledge = readdirSync(resolve(here, 'knowledge'))
  .filter((file) => file.endsWith('.md'))
  .sort()
  .map((file) => readFileSync(resolve(here, 'knowledge', file), 'utf-8').trim())
  .join('\n\n\n');
writeFileSync(resolve(dist, 'knowledge.txt'), knowledge);

// The remarks the page opens with where a reader has none of their own yet, and the page's script.
copyFileSync(resolve(here, 'examples.json'), resolve(dist, 'examples.json'));
copyFileSync(resolve(here, 'app.js'), resolve(dist, 'app.js'));

await build({
  entryPoints: [resolve(here, 'engine.worker.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'DescribeItEngine',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  outfile: resolve(dist, 'engine.js'),
});

console.log(
  `piece.json ${String(piece.alignment.allNotes.length)} notes, ` +
    `reference.json ${String(reference.length)} calls, ` +
    `knowledge.txt ${String(knowledge.length)} characters`,
);
