/**
 * Align every pair of the corpus and keep what the model said.
 *
 *     npx vite-node scripts/transcription/align.ts <corpus dir>
 *
 * The corpus directory holds `manifest.tsv` (roll, score, title, performer), `midi/<roll>.mid`
 * and `mei/<score>.mei`; see `scripts/transcription/README.md` for where they come from. One
 * alignment is a minute of model time, so its three lists are written to `align/<roll>.json` and
 * every other script reads them from there.
 */
import { nodeSession } from './node';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { read } from 'midifile-ts';
import { alignScoreToPerformance } from '../../src/alignment/mlign';
import { asSpans, type NoteSpan } from '../../src/performance/midiSpans';
import { getNotesFromMEI } from '../../src/score/scoreNotes';
import { readManifest } from './corpus';

/**
 * How many semitones the roll sits away from the score, as a whole.
 *
 * A few SUPRA scans come out a tone off the piece they are catalogued as, the tracker bar read
 * one hole along. That is a fact about the scan, not about the playing, and left alone it turns
 * the whole roll into additions. The shift that makes the two pitch histograms overlap most is
 * taken, and zero wins a tie.
 */
const transpositionOf = (written: readonly number[], played: readonly number[]): number => {
    const count = (pitches: readonly number[]) => {
        const histogram = new Array<number>(128).fill(0);
        for (const pitch of pitches) if (pitch >= 0 && pitch < 128) histogram[pitch] += 1 / pitches.length;
        return histogram;
    };
    const score = count(written);
    const roll = count(played);

    let best = 0;
    let bestOverlap = -1;
    for (const shift of [0, 1, -1, 2, -2, 3, -3]) {
        let overlap = 0;
        for (let pitch = 0; pitch < 128; pitch++) {
            overlap += Math.min(score[pitch], roll[pitch - shift] ?? 0);
        }
        if (overlap > bestOverlap + 1e-9) {
            best = shift;
            bestOverlap = overlap;
        }
    }
    return best;
};

const dir = process.argv[2];
if (!dir) throw new Error('usage: align.ts <corpus dir> [roll ...]');
const only = new Set(process.argv.slice(3));

mkdirSync(join(dir, 'align'), { recursive: true });

for (const pair of readManifest(dir)) {
    if (only.size > 0 && !only.has(pair.roll)) continue;
    const out = join(dir, 'align', `${pair.roll}.json`);
    if (existsSync(out)) continue;

    const started = performance.now();
    try {
        const mei = readFileSync(join(dir, 'mei', `${pair.score}.mei`), 'utf-8');
        const bytes = readFileSync(join(dir, 'midi', `${pair.roll}.mid`));
        const midi = read(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

        const scoreNotes = await getNotesFromMEI(mei, { collapseUnisons: false, notatedOnsets: true });
        const played = asSpans(midi, true).filter((span): span is NoteSpan => span.type === 'note');
        const shift = transpositionOf(scoreNotes.map((note) => note.pitch), played.map((span) => span.pitch));
        const spans = played.map((span) => ({ ...span, pitch: span.pitch + shift }));
        const result = await alignScoreToPerformance(scoreNotes, spans, {
            session: await nodeSession(),
            allowMismatch: true,
        });

        writeFileSync(out, JSON.stringify({ pair, shift, scoreNotes, spans, result }));
        console.log(
            `${pair.roll} ${pair.title} (${pair.performer}): ${String(scoreNotes.length)} written, ` +
                `${String(spans.length)} played, ${String(result.matches.length)} matched, ` +
                `${String(result.insertions.length)} added, ${String(result.deletions.length)} missing, ` +
                `${String(Math.round((performance.now() - started) / 1000))} s` +
                (shift === 0 ? '' : `, roll transposed by ${String(shift)} semitones to meet the score`),
        );
    } catch (reason) {
        console.log(`${pair.roll} ${pair.title}: FAILED ${reason instanceof Error ? reason.message : String(reason)}`);
    }
}
