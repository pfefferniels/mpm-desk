/**
 * Hold the document-read onsets against verovio's, over every score of the corpus.
 *
 *     npx vite-node scripts/transcription/checkModel.ts <corpus dir>
 */
import './node';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readScore } from '../../src/alignment/transcription/scoreModel';
import type { ScoreNote } from '../../src/score/scoreNotes';
import { readManifest } from './corpus';

const dir = process.argv[2];
const seen = new Set<string>();
for (const pair of readManifest(dir)) {
    if (seen.has(pair.score)) continue;
    seen.add(pair.score);
    let cached: { scoreNotes: ScoreNote[] };
    try {
        cached = JSON.parse(readFileSync(join(dir, 'align', `${pair.roll}.json`), 'utf-8'));
    } catch {
        continue;
    }
    const mei = readFileSync(join(dir, 'mei', `${pair.score}.mei`), 'utf-8');
    const model = readScore(new DOMParser().parseFromString(mei, 'application/xml'));

    // Verovio counts a measure from where it lets it start, which a Humdrum conversion can move
    // by the length of a note straddling the barline. What a new note is fitted into is the
    // layer, so what has to agree is where a note stands within its measure.
    const deltas = new Map<Element, number[]>();
    let pitchOff = 0, missing = 0, graces = 0;
    for (const row of cached.scoreNotes) {
        const note = model.notes.get(row.note);
        if (!note) { missing++; continue; }
        if (note.pitch !== row.pitch) pitchOff++;
        if (note.event.grace) { graces++; continue; }
        const measure = note.event.layer.staff.measure.element;
        const list = deltas.get(measure) ?? [];
        list.push(note.event.onset - row.onset);
        deltas.set(measure, list);
    }
    let consistent = 0, inconsistent = 0, shifted = 0;
    const examples: string[] = [];
    for (const [measure, list] of deltas) {
        const sorted = [...list].sort((a, b) => a - b);
        const median = sorted[sorted.length >> 1];
        const odd = list.filter((delta) => Math.abs(delta - median) > 0.3).length;
        if (odd === 0) consistent++;
        else {
            inconsistent++;
            if (examples.length < 4) examples.push(`m. ${measure.getAttribute('n') ?? '?'} (${String(odd)} of ${String(list.length)})`);
        }
        if (Math.abs(median) > 1e-3) shifted++;
    }
    console.log(
        `${pair.score}: ${String(cached.scoreNotes.length)} rows, ${String(consistent)} measures agree within, ` +
            `${String(inconsistent)} do not, ${String(shifted)} start elsewhere, ${String(graces)} graces, ` +
            `${String(pitchOff)} at another pitch, ${String(missing)} unknown ids` +
            (examples.length ? ` — ${examples.join('; ')}` : ''),
    );
}
