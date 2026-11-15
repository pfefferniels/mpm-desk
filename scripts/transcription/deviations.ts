/**
 * Every bar a performer played differently from the score, the score's bar above the played one.
 *
 *     npx vite-node scripts/transcription/deviations.ts <corpus dir> <roll> [title]
 *
 * Reads the alignment `align.ts` kept, transcribes it, and writes `out/<roll>.deviations.html`:
 * one block per bar that differs, engraved twice the ordinary way. The upper bar is the source's.
 * The lower is the performance's, coloured as the alignment desk colours it: green for what was
 * played and is not written, red for what is written and was not played, violet for a note
 * played at another pitch. The transcribed score itself is left in `out/<roll>.mei`.
 */
import './node';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { read } from 'midifile-ts';
import { applyAlignment } from '../../src/alignment/applyAlignment';
import { divergencesOf } from '../../src/alignment/divergences';
import { hasRepeatSigns, toMatches, unshowableScoreIds, type AlignResult } from '../../src/alignment/mlign';
import { transcribe } from '../../src/alignment/transcription';
import { readScore } from '../../src/alignment/transcription/scoreModel';
import { ornamentSignsOf } from '../../src/mei/ornamentSigns';
import type { NoteSpan } from '../../src/performance/midiSpans';
import type { ScoreNote } from '../../src/score/scoreNotes';
import { defaultOptions, loadVerovio } from '../../src/verovio/toolkit';
import { readManifest } from './corpus';

const [dir, roll, title] = process.argv.slice(2);
const pair = readManifest(dir).find((entry) => entry.roll === roll);
if (!pair) throw new Error(`no roll ${roll} in ${dir}/manifest.tsv`);

const cached = JSON.parse(readFileSync(join(dir, 'align', `${roll}.json`), 'utf-8')) as { scoreNotes: ScoreNote[]; spans: NoteSpan[]; result: AlignResult };
const mei = readFileSync(join(dir, 'mei', `${pair.score}.mei`), 'utf-8');
const bytes = readFileSync(join(dir, 'midi', `${roll}.mid`));
const midi = read(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const source = `supra-${roll}`;

const divergences = divergencesOf(
    { ...cached.result, scoreNotes: cached.scoreNotes, spans: cached.spans, signs: ornamentSignsOf(mei) },
    { hasRepeats: hasRepeatSigns(mei) },
);
const hidden = unshowableScoreIds(mei, cached.result.matches);
const aligned = applyAlignment(mei, midi, toMatches(cached.result.matches).filter((match) => !hidden.has(match.score_id)), { source, divergences });

const written = transcribe({ mei: aligned, source, divergences, spans: cached.spans });
// As the desk shows it: the notes that were left out still standing, to be drawn in red
const shown = transcribe({ mei: aligned, source, divergences, spans: cached.spans, omissionsStand: true });

mkdirSync(join(dir, 'out'), { recursive: true });
writeFileSync(join(dir, 'out', `${roll}.mei`), written.mei);

const GREEN = '#15803d';
const RED = '#dc2626';
const VIOLET = '#7c3aed';

// What to colour, and which bars to draw
const colours = new Map<string, string>();
const bars = new Map<number, string[]>();
const say = (bar: number | undefined, text: string) => {
    if (bar === undefined) return;
    bars.set(bar, [...(bars.get(bar) ?? []), text]);
};
for (const divergence of divergences) {
    const outcome = written.outcomes.get(divergence.id);
    if (!outcome || outcome.written === 'none' || outcome.written === 'as-written') continue;
    if (divergence.kind === 'added') {
        for (const id of outcome.noteIds) colours.set(id, GREEN);
        say(outcome.measure, outcome.because);
    } else if (divergence.kind === 'missing') {
        for (const id of divergence.scoreIds) colours.set(id, RED);
        say(outcome.measure, outcome.because);
    } else {
        for (const id of outcome.noteIds) colours.set(id, VIOLET);
        say(outcome.measure, outcome.because);
    }
}

const model = readScore(new DOMParser().parseFromString(mei, 'application/xml'));
const toolkit = await loadVerovio();
const OPTIONS = {
    ...defaultOptions,
    performanceAlignment: false,
    scale: 55,
    breaks: 'none' as const,
    adjustPageWidth: true,
    adjustPageHeight: true,
    pageMarginLeft: 30,
    pageMarginRight: 30,
    pageMarginTop: 20,
    pageMarginBottom: 20,
};

const engrave = (document: string, indices: number[]): string[] => {
    toolkit.resetOptions();
    toolkit.setOptions(OPTIONS);
    if (!toolkit.loadData(document)) throw new Error('verovio could not read the score');
    return indices.map((index) => {
        toolkit.select({ measureRange: `${String(index + 1)}-${String(index + 1)}` });
        toolkit.redoLayout();
        return toolkit.renderToSVG(1);
    });
};

const indices = [...bars.keys()].sort((a, b) => a - b);
const before = engrave(mei, indices);
const after = engrave(shown.mei, indices);

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rules = [...colours]
    .map(([id, colour]) => `.played [data-id="${id}"], .played [data-id="${id}"] * { fill: ${colour} !important; stroke: ${colour} !important; }`)
    .join('\n');

const blocks = indices.map((index, at) => {
    const measure = model.measures[index];
    const repeat = (measure.element.getAttribute('xml:id') ?? '').endsWith('-rend2');
    const label = `Bar ${measure.element.getAttribute('n') ?? String(index + 1)}${repeat ? ', repeat' : ''}`;
    return `<section class="bar" id="bar-${String(index)}">
  <h2>${label}</h2>
  <div class="row"><span>Score</span><div class="written">${before[at]}</div></div>
  <div class="row"><span>Played</span><div class="played">${after[at]}</div></div>
  <p>${[...new Set(bars.get(index) ?? [])].map(escape).join('<br>')}</p>
</section>`;
});

writeFileSync(
    join(dir, 'out', `${roll}.deviations.html`),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escape(title ?? pair.title)}</title>
<style>
  body { font: 15px/1.4 system-ui, sans-serif; color: #111827; background: #fff; margin: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .legend { color: #4b5563; margin: 0 0 20px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin: 0 4px 0 14px; }
  .bar { border-top: 1px solid #e5e7eb; padding: 14px 0 6px; }
  h2 { font-size: 16px; margin: 0 0 6px; }
  .row { display: flex; align-items: center; gap: 12px; }
  .row > span { width: 56px; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
  .bar p { color: #4b5563; margin: 4px 0 0 68px; font-size: 13px; }
  .pedal, .dir, .dynam, .hairpin, .tempo, .slur, .harm, .fing, .label, .labelAbbr { display: none; }
${rules}
</style></head><body>
<h1>${escape(title ?? `${pair.title}, ${pair.performer}`)}</h1>
<p class="legend">${String(indices.length)} bars differ.<i style="background:${GREEN}"></i>played, not written<i style="background:${RED}"></i>written, not played<i style="background:${VIOLET}"></i>another pitch</p>
${blocks.join('\n')}
</body></html>
`,
);
console.log(`${String(indices.length)} bars differ; wrote ${join(dir, 'out', `${roll}.deviations.html`)}`);
