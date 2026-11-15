/**
 * Transcribe every roll of the corpus into its score, and check what came out.
 *
 *     npx vite-node scripts/transcription/transcribe.ts <corpus dir> [roll ...]
 *
 * For each pair: the alignment is written into the score as the desk writes it, the divergences
 * are transcribed, and then the result is held to five things.
 *
 *   reads      verovio loads the transcribed score and times every note of it
 *   still      no note of the source moved: each sounds at the moment it sounded at before
 *   written    every note the transcriber says it wrote is in the score, at the pitch played
 *   explains   aligning the recording against the transcribed score again leaves fewer played
 *              notes without a written one, the model that found the divergences being the
 *              judge of whether they are gone
 *   reverts    taking the readings out gives back the document that went in
 *
 * The transcribed scores are left in `out/` for looking at.
 */
import { nodeSession } from './node';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { read } from 'midifile-ts';
import { applyAlignment } from '../../src/alignment/applyAlignment';
import { divergencesOf } from '../../src/alignment/divergences';
import { alignScoreToPerformance, hasRepeatSigns, toMatches, unshowableScoreIds, type AlignResult } from '../../src/alignment/mlign';
import { transcribe, untranscribed } from '../../src/alignment/transcription';
import { readScore } from '../../src/alignment/transcription/scoreModel';
import { ornamentSignsOf } from '../../src/mei/ornamentSigns';
import type { NoteSpan } from '../../src/performance/midiSpans';
import { getNotesFromMEI, type ScoreNote } from '../../src/score/scoreNotes';
import { readManifest } from './corpus';

const dir = process.argv[2];
const only = new Set(process.argv.slice(3));
mkdirSync(join(dir, 'out'), { recursive: true });

// One roll to a process. jsdom does not let go of the documents it has parsed, a dozen of them
// per roll here, and thirty rolls in one process run it out of memory. The browser's own parser
// has no such trouble; this is the price of running the app's code under Node.
if (only.size === 0) {
    for (const pair of readManifest(dir)) {
        spawnSync('npx', ['vite-node', 'scripts/transcription/transcribe.ts', dir, pair.roll], { stdio: ['ignore', 'inherit', 'ignore'] });
    }
}

/** A document as text that does not depend on the order its attributes were set in. */
const canonical = (mei: string): string => {
    const doc = new DOMParser().parseFromString(mei, 'application/xml');
    const walk = (element: Element): string => {
        const attributes = [...element.attributes].map((a) => `${a.name}="${a.value}"`).sort().join(' ');
        const children = [...element.childNodes]
            .map((child) => (child.nodeType === 1 ? walk(child as Element) : (child.textContent ?? '').trim()))
            .join('');
        return `<${element.localName} ${attributes}>${children}</${element.localName}>`;
    };
    return walk(doc.documentElement);
};

interface Tally {
    agreed: number; written: number; added: number; measured: number; grace: number; unplaced: number;
    omitted: number; variants: number; moved: number; lost: number; reverts: boolean;
    insertionsBefore: number; insertionsAfter: number; deletionsBefore: number; deletionsAfter: number;
    kinds: Record<string, number>; why: Record<string, number>;
}

for (const pair of readManifest(dir)) {
    if (!only.has(pair.roll)) continue;
    const sum: Tally = { agreed: 0, written: 0, added: 0, measured: 0, grace: 0, unplaced: 0, omitted: 0, variants: 0, moved: 0, lost: 0, reverts: false, insertionsBefore: 0, insertionsAfter: 0, deletionsBefore: 0, deletionsAfter: 0, kinds: {}, why: {} };
    const kinds = new Map<string, number>();
    const why = new Map<string, number>();
    const file = join(dir, 'align', `${pair.roll}.json`);
    if (!existsSync(file)) continue;
    const cached = JSON.parse(readFileSync(file, 'utf-8')) as { shift: number; scoreNotes: ScoreNote[]; spans: NoteSpan[]; result: AlignResult };
    if (cached.shift !== 0) {
        console.log(`${pair.roll} ${pair.title} (${pair.performer}): skipped, the roll is a scan ${String(cached.shift)} semitones off`);
        continue;
    }

    const mei = readFileSync(join(dir, 'mei', `${pair.score}.mei`), 'utf-8');
    const bytes = readFileSync(join(dir, 'midi', `${pair.roll}.mid`));
    const midi = read(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const source = `supra-${pair.roll}`;

    const divergences = divergencesOf(
        { ...cached.result, scoreNotes: cached.scoreNotes, spans: cached.spans, signs: ornamentSignsOf(mei) },
        { hasRepeats: hasRepeatSigns(mei) },
    );
    const hidden = unshowableScoreIds(mei, cached.result.matches);
    const base = applyAlignment(
        mei,
        midi,
        toMatches(cached.result.matches).filter((match) => !hidden.has(match.score_id)),
        { source, divergences },
    );

    const started = performance.now();
    const result = transcribe({ mei: base, source, divergences, spans: cached.spans, resp: '#transcriber' });
    const took = performance.now() - started;
    writeFileSync(join(dir, 'out', `${pair.roll}.mei`), result.mei);

    // reads
    let after: ScoreNote[];
    try {
        after = await getNotesFromMEI(result.mei, { collapseUnisons: false, notatedOnsets: true });
    } catch (reason) {
        console.log(`${pair.roll} ${pair.title}: DOES NOT READ ${reason instanceof Error ? reason.message : String(reason)}`);
        continue;
    }

    // still: by the written onsets, read off both documents the same way. Verovio's own
    // timing would not do, because it moves a note for the grace note in front of it, and a
    // grace note taken out or put in is exactly what a transcription does.
    const before = readScore(new DOMParser().parseFromString(base, 'application/xml'));
    const now = readScore(new DOMParser().parseFromString(result.mei, 'application/xml'));
    let moved = 0;
    const movedExamples: string[] = [];
    for (const [id, note] of before.notes) {
        const same = now.notes.get(id);
        if (!same) continue;
        if (Math.abs(same.event.onset - note.event.onset) > 1e-6 || same.pitch !== note.pitch) {
            moved++;
            if (movedExamples.length < 3) movedExamples.push(`${id} ${note.event.onset.toFixed(3)}/${String(note.pitch)} -> ${same.event.onset.toFixed(3)}/${String(same.pitch)}`);
        }
    }
    const afterById = new Map(after.map((note) => [note.note, note]));

    // written
    const spanByKey = new Map(cached.spans.map((span) => [`played-${String(Math.round(span.onsetMs))}ms-${String(span.pitch)}`, span]));
    let lost = 0;
    let writtenNotes = 0;
    const lostExamples: string[] = [];
    const writtenIds = new Map<string, NoteSpan>();
    for (const outcome of result.outcomes.values()) {
        for (const id of outcome.noteIds) {
            writtenNotes++;
            const inModel = now.notes.get(id);
            const sounding = afterById.get(id);
            const span = spanByKey.get(id.replace(/x+$/, ''));
            if (span) writtenIds.set(id, span);
            if (!inModel || !sounding || !span || inModel.pitch !== span.pitch || sounding.pitch !== span.pitch) {
                lost++;
                if (lostExamples.length < 3) lostExamples.push(`${id}: model ${inModel ? String(inModel.pitch) : 'absent'}, verovio ${sounding ? String(sounding.pitch) : 'absent'}`);
            }
        }
    }

    // explains
    const again = await alignScoreToPerformance(after, cached.spans, { session: await nodeSession(), allowMismatch: true });

    // Of the notes written, how many the model now pairs with the very key that was played
    let agreed = 0;
    for (const match of again.matches) {
        const span = writtenIds.get(match.scoreId);
        if (span && span.id === match.performanceId) agreed++;
    }
    sum.agreed += agreed;
    sum.written += writtenNotes;

    // reverts
    const reverts = canonical(untranscribed(result.mei, source)) === canonical(base);

    let measured = 0, grace = 0, unplaced = 0, omitted = 0, variants = 0, added = 0;
    for (const divergence of divergences) {
        const outcome = result.outcomes.get(divergence.id);
        if (!outcome) continue;
        kinds.set(`${divergence.kind}/${divergence.reading} -> ${outcome.written}`, (kinds.get(`${divergence.kind}/${divergence.reading} -> ${outcome.written}`) ?? 0) + 1);
        if (outcome.written === 'none') why.set(outcome.because.slice(0, 70), (why.get(outcome.because.slice(0, 70)) ?? 0) + 1);
        if (divergence.kind === 'added') {
            added += divergence.perfIds.length;
            if (outcome.written === 'measured' || outcome.written === 'mixed') measured += outcome.noteIds.length;
            if (outcome.written === 'grace') grace += outcome.noteIds.length;
            if (outcome.written === 'none') unplaced += divergence.perfIds.length;
        } else if (divergence.kind === 'missing' && outcome.written === 'omitted') omitted += divergence.scoreIds.length;
        else if (divergence.kind === 'replaced' && outcome.written === 'variant') variants++;
    }

    sum.reverts = reverts; sum.added += added; sum.measured += measured; sum.grace += grace; sum.unplaced += unplaced;
    sum.omitted += omitted; sum.variants += variants; sum.moved += moved; sum.lost += lost;
    sum.insertionsBefore += cached.result.insertions.length; sum.insertionsAfter += again.insertions.length;
    sum.deletionsBefore += cached.result.deletions.length; sum.deletionsAfter += again.deletions.length;

    console.log(
        `${pair.roll} ${pair.title.padEnd(19)} ${pair.performer.padEnd(13)} ` +
            `added ${String(cached.result.insertions.length).padStart(3)} -> ${String(again.insertions.length).padStart(3)}  ` +
            `missing ${String(cached.result.deletions.length).padStart(3)} -> ${String(again.deletions.length).padStart(3)}  ` +
            `wrote ${String(writtenNotes).padStart(3)} (${String(agreed)} re-matched, ${String(lost)} lost)  moved ${String(moved)}  ` +
            `${reverts ? 'reverts' : 'DOES NOT REVERT'}  ${String(Math.round(took))} ms` +
            (movedExamples.length ? `  moved e.g. ${movedExamples.join('; ')}` : '') +
            (lostExamples.length ? `  lost e.g. ${lostExamples.join('; ')}` : ''),
    );

    sum.kinds = Object.fromEntries(kinds);
    sum.why = Object.fromEntries(why);
    writeFileSync(join(dir, 'out', `${pair.roll}.json`), JSON.stringify(sum));
}

if (only.size === 0) {
    const total = { rolls: 0, reverting: 0, added: 0, written: 0, agreed: 0, measured: 0, grace: 0, unplaced: 0, omitted: 0, variants: 0, moved: 0, lost: 0, insertionsBefore: 0, insertionsAfter: 0, deletionsBefore: 0, deletionsAfter: 0 };
    const kinds = new Map<string, number>();
    const why = new Map<string, number>();
    for (const file of readdirSync(join(dir, 'out')).filter((name) => name.endsWith('.json'))) {
        const tally = JSON.parse(readFileSync(join(dir, 'out', file), 'utf-8')) as Tally;
        total.rolls++;
        if (tally.reverts) total.reverting++;
        for (const key of ['added', 'written', 'agreed', 'measured', 'grace', 'unplaced', 'omitted', 'variants', 'moved', 'lost', 'insertionsBefore', 'insertionsAfter', 'deletionsBefore', 'deletionsAfter'] as const) total[key] += tally[key];
        for (const [key, count] of Object.entries(tally.kinds)) kinds.set(key, (kinds.get(key) ?? 0) + count);
        for (const [key, count] of Object.entries(tally.why)) why.set(key, (why.get(key) ?? 0) + count);
    }
    console.log(JSON.stringify(total));
    for (const [key, count] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(String(count).padStart(5), key);
    console.log('--- why nothing was written');
    for (const [key, count] of [...why].sort((a, b) => b[1] - a[1])) console.log(String(count).padStart(5), key);
}
