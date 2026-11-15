/**
 * How long a key stays down after the next note is struck, over the rolls of the corpus.
 *
 *     npx vite-node scripts/transcription/legato.ts <corpus dir>
 *
 * Two questions, asked of the notes the aligner matched. Where a note is followed by another in
 * its own voice: how long after that one is struck is the first let go? And where another voice
 * of the staff is struck while a note is written to go on sounding: is the note still down?
 * The first is what a legato is on these rolls and the second what holding a note against
 * another voice is, and `LEGATO_MS` in `src/alignment/transcription/index.ts` is the line
 * drawn between them: a played note the score does not write is put into the voice of the note
 * it was played during only where that note had been let go.
 *
 * Needs the alignments `align.ts` leaves in `align/`.
 */
import './node';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AlignResult } from '../../src/alignment/mlign';
import { readScore } from '../../src/alignment/transcription/scoreModel';
import type { NoteSpan } from '../../src/performance/midiSpans';
import { readManifest } from './corpus';

const dir = process.argv[2];

/** Milliseconds from the next note of the voice being struck to this one being let go. */
const sameVoice: number[] = [];
/** The same, from a note of another voice of the staff being struck in the middle of this one. */
const otherVoice: number[] = [];

for (const pair of readManifest(dir)) {
    const file = join(dir, 'align', `${pair.roll}.json`);
    if (!existsSync(file)) continue;
    const cached = JSON.parse(readFileSync(file, 'utf-8')) as { shift: number; spans: NoteSpan[]; result: AlignResult };
    if (cached.shift !== 0) continue;

    const doc = new DOMParser().parseFromString(readFileSync(join(dir, 'mei', `${pair.score}.mei`), 'utf-8'), 'application/xml');
    const model = readScore(doc);
    const spans = new Map(cached.spans.map((span) => [span.id, span]));
    const played = new Map<string, NoteSpan>();
    for (const match of cached.result.matches) {
        const span = spans.get(match.performanceId);
        if (span) played.set(match.scoreId, span);
    }
    // A note tied on is held by the score's own word, and says nothing about legato
    const tied = new Set<string>();
    for (const tie of doc.querySelectorAll('tie')) tied.add((tie.getAttribute('startid') ?? '').replace(/^#/, ''));

    /** When the first note of an event was struck, where any was. */
    const struck = (notes: readonly { id: string }[]): number | undefined => {
        const times = notes.flatMap((note) => played.get(note.id)?.onsetMs ?? []);
        return times.length > 0 ? Math.min(...times) : undefined;
    };

    for (const measure of model.measures) {
        for (const staff of measure.staves) {
            for (const layer of staff.layers) {
                const events = layer.events.filter((event) => !event.grace);
                events.forEach((event, index) => {
                    for (const note of event.notes) {
                        const span = played.get(note.id);
                        if (!span || tied.has(note.id)) continue;

                        const next = events[index + 1];
                        const then = next && Math.abs(event.onset + event.duration - next.onset) < 1e-6 ? struck(next.notes) : undefined;
                        if (then !== undefined) sameVoice.push(span.offsetMs - then);

                        for (const other of staff.layers) {
                            if (other === layer) continue;
                            for (const against of other.events) {
                                if (against.grace) continue;
                                if (against.onset <= event.onset + 1e-6 || against.onset >= event.onset + event.duration - 1e-6) continue;
                                const when = struck(against.notes);
                                if (when !== undefined) otherVoice.push(span.offsetMs - when);
                            }
                        }
                    }
                });
            }
        }
    }
}

const report = (name: string, values: number[]): void => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (share: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))]);
    const over = (ms: number) => (values.filter((value) => value > ms).length / values.length).toFixed(3);
    console.log(
        `${name}: ${String(values.length)} notes; let go ${String(at(0.25))} / ${String(at(0.5))} / ${String(at(0.75))} / ${String(at(0.9))} ms ` +
            `after the other was struck (quartiles and ninth decile); still down after ` +
            [60, 120, 200, 300].map((ms) => `${String(ms)} ms: ${over(ms)}`).join(', '),
    );
};
report('the next note of its voice', sameVoice);
report('a note of another voice ', otherVoice);
