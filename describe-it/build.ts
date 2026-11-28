/**
 * Builds the published DescribeIt page into `describe-it/dist/` (or `DESCRIBEIT_OUT`).
 *
 *     WELTE225=../welte225.org npx vite-node describe-it/build.ts
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

// `asMSM` needs a global `DOMParser`, which Node lacks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).DOMParser ??= new JSDOM().window.DOMParser;

import { convertMeiToMsm } from 'espressivo';
import { runFit } from '../src/fitting/fit';
import { asMSM } from '../src/fitting/asMSM';
import { parseWorkFile, type Call } from '../src/model/Work';
import { publishedPath } from '../src/test/published';
import { readReduction } from './reduction';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, process.env['DESCRIBEIT_OUT'] ?? 'dist');
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

// Only the `MakeChoice` calls are replayed, so the alignment carries the chosen base text.
const mei = readFileSync(publishedPath('mei'), 'utf-8');
const rawWork = readFileSync(publishedPath('work'), 'utf-8');
const work = parseWorkFile(rawWork);
const movement = convertMeiToMsm(mei)[0];
if (!movement) throw new Error('the transcription holds no movement');
const alignment = quietly(() => asMSM(mei, movement.msm, movement.graces));
quietly(() =>
  runFit({ ...work, provenance: work.provenance.filter((call) => call.name === 'MakeChoice') }, alignment),
);

/** Drops the unused `symbol` field, which is a third of the file size. */
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

// Taken from the raw JSON, not the parsed work, so serialized `Map`s and `Set`s stay as written.
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

// The line the inner voice hums; a checkout without it gives a page that hums nothing.
const reduction = readReduction();
writeFileSync(resolve(dist, 'reduction.json'), JSON.stringify(reduction ?? { notes: [], rests: [] }));

copyFileSync(resolve(here, 'examples.json'), resolve(dist, 'examples.json'));
copyFileSync(resolve(here, 'app.js'), resolve(dist, 'app.js'));
copyFileSync(resolve(here, 'piano.js'), resolve(dist, 'piano.js'));
copyFileSync(resolve(here, 'player.js'), resolve(dist, 'player.js'));
copyFileSync(resolve(here, 'staff.js'), resolve(dist, 'staff.js'));
copyFileSync(resolve(here, 'voice.js'), resolve(dist, 'voice.js'));

// Piano samples (every third key from A0 to C8, three velocity layers) are too large for git and
// are downloaded once. `curl` is used because it honours the shell's proxy; Node's `fetch` does not.
const SAMPLES = 'https://tambien.github.io/Piano/audio/';
const sampledKeys = Array.from({ length: 30 }, (_, key) => ['A', 'C', 'Ds', 'Fs'][key % 4] + String(Math.floor((key + 3) / 4)));
const samples = sampledKeys.flatMap((key) => [1, 7, 15].map((layer) => `${key}v${String(layer)}.mp3`));
mkdirSync(resolve(dist, 'piano'), { recursive: true });
let downloaded = 0;
for (const file of samples) {
  const path = resolve(dist, 'piano', file);
  if (existsSync(path)) continue;
  const curl = ['--fail', '--silent', '--show-error', '--location', '--output', `${path}.part`, SAMPLES + file];
  try {
    execFileSync('curl', curl, { stdio: ['ignore', 'ignore', 'inherit'] });
  } catch {
    throw new Error(`the piano sample ${SAMPLES}${file} could not be downloaded`);
  }
  renameSync(`${path}.part`, path);
  downloaded++;
}

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
    `knowledge.txt ${String(knowledge.length)} characters, ` +
    `reduction.json ${reduction ? `${String(reduction.notes.length)} sung notes` : 'empty (the checkout has no hummed/reduction/reduction.mei)'}, ` +
    `piano ${String(samples.length)} samples, ${String(downloaded)} of them downloaded`,
);
