/**
 * How well the quantiser puts back notes it has been denied.
 *
 *     npx vite-node scripts/transcription/holdout.ts <corpus dir> [key=value ...]
 *
 * There is no corpus of piano rolls with the performer's additions written out by hand, so the
 * score itself is made the ground truth. A written note that was matched is taken out of the
 * score, its played note is handed to the transcriber as though the performer had added it, and
 * what comes back is held against what Chopin wrote. The timing is real, a pianist of 1905 on a
 * Welte roll; only the question is constructed.
 *
 * Four questions, because an added note can stand in four relations to the text:
 *
 *   alone   a whole moment of the score is hidden, every note written at it
 *   run     two to five moments in a row are hidden, a figure
 *   chord   one note is hidden of a moment whose other notes stay
 *   grace   a grace note the score writes is hidden
 *
 * Any `key=value` after the directory overrides a setting of the model, for calibrating it.
 */
import './node';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UNITS, levelOf } from '../../src/alignment/transcription/grid';
import { chooseStaff, chooseValue } from '../../src/alignment/transcription/place';
import { spell } from '../../src/alignment/transcription/spell';
import {
    QUANTISE_DEFAULTS,
    quantise,
    type Played,
    type QuantiseSettings,
} from '../../src/alignment/transcription/quantise';
import { measureAt, readScore, type ScoreEvent, type WrittenNote } from '../../src/alignment/transcription/scoreModel';
import { buildTimeMap, onsetAt } from '../../src/alignment/transcription/timeMap';
import type { AlignResult } from '../../src/alignment/mlign';
import type { NoteSpan } from '../../src/performance/midiSpans';
import { readManifest } from './corpus';

const dir = process.argv[2];
const fixed: Partial<QuantiseSettings> = {};
const sweeps: { key: string; values: number[] }[] = [];
let quiet = false;
for (const argument of process.argv.slice(3)) {
    if (argument === 'quiet') { quiet = true; continue; }
    const [key, value] = argument.split('=');
    if (!(key in QUANTISE_DEFAULTS)) continue;
    // `key=a,b,c` tries each value in turn, everything else as given
    if (value.includes(',')) sweeps.push({ key, values: value.split(',').map(Number) });
    else (fixed as Record<string, number>)[key] = Number(value);
}

interface Tally {
    asked: number;
    exact: number;
    grace: number;
    unplaced: number;
    /** A fixed sixteenth-note grid on the same tempo map, which is what notation software does */
    sixteenths: number;
    /** The nearest place on the finest grid, with no prior at all */
    nearest: number;
}
const empty = (): Tally => ({ asked: 0, exact: 0, grace: 0, unplaced: 0, sixteenths: 0, nearest: 0 });

/** The notation of a note whose place is known: its staff, its name and its length. */
const notation = { asked: 0, staff: 0, spelling: 0, valueAsked: 0, value: 0, valueNear: 0, held: 0 };

interface Pairing { note: WrittenNote; span: NoteSpan }

const loaded = readManifest(dir).flatMap((pair) => {
    try {
        const cached = JSON.parse(readFileSync(join(dir, 'align', `${pair.roll}.json`), 'utf-8')) as { result: AlignResult; spans: NoteSpan[] };
        const mei = readFileSync(join(dir, 'mei', `${pair.score}.mei`), 'utf-8');
        return [{ pair, cached, model: readScore(new DOMParser().parseFromString(mei, 'application/xml')) }];
    } catch {
        return [];
    }
});

const evaluate = (settings: Partial<QuantiseSettings>, report: boolean): Record<string, Tally> => {
const totals: Record<string, Tally> = { alone: empty(), run: empty(), chord: empty(), grace: empty() };
const perRoll: string[] = [];

for (const { pair, cached, model } of loaded) {
    const spanById = new Map(cached.spans.map((span) => [span.id, span]));

    const pairings: Pairing[] = [];
    for (const match of cached.result.matches) {
        const note = model.notes.get(match.scoreId);
        const span = spanById.get(match.performanceId);
        if (note && span) pairings.push({ note, span });
    }

    // The written moments, in order, each with the matched notes written at it
    const byOnset = new Map<number, Pairing[]>();
    const graces: Pairing[] = [];
    for (const pairing of pairings) {
        if (pairing.note.event.grace) { graces.push(pairing); continue; }
        const key = Math.round(pairing.note.event.onset * 1e6) / 1e6;
        const list = byOnset.get(key);
        if (list) list.push(pairing);
        else byOnset.set(key, [pairing]);
    }
    const moments = [...byOnset].sort((a, b) => a[0] - b[0]);
    const rollTally: Record<string, Tally> = { alone: empty(), run: empty(), chord: empty(), grace: empty() };

    const ask = (
        regime: string,
        hiddenPairings: Pairing[],
        truth: (played: Played) => number | 'grace',
    ) => {
        const hiddenIds = new Set(hiddenPairings.map((pairing) => pairing.note.id));
        const hidden = new Set<ScoreEvent>();
        for (const pairing of hiddenPairings) {
            // An event is hidden only when every one of its notes is: a chord that keeps a note
            // is still written at its place
            if (pairing.note.event.notes.every((note) => hiddenIds.has(note.id))) hidden.add(pairing.note.event);
        }
        const map = buildTimeMap(
            pairings
                .filter((pairing) => !hiddenIds.has(pairing.note.id) && !pairing.note.event.grace)
                .map((pairing) => ({ onset: pairing.note.event.onset, ms: pairing.span.onsetMs, pitch: pairing.span.pitch })),
        );
        const played: Played[] = hiddenPairings.map(({ span }) => ({
            id: span.id,
            onsetMs: span.onsetMs,
            offsetMs: span.offsetMs,
            pitch: span.pitch,
            velocity: span.velocity,
        }));

        // The rest of the notation, asked with the place given: on which staff, called what,
        // and how long. Each is a question of its own, and an onset got wrong would otherwise
        // be counted against all three.
        if (regime === 'alone' || regime === 'chord') {
            for (const { note, span } of hiddenPairings) {
                const event = note.event;
                const measure = event.layer.staff.measure;
                notation.asked++;

                if (chooseStaff(measure, event.onset, span.pitch, hidden)?.n === event.layer.staff.n) notation.staff++;

                const around: { note: WrittenNote; away: number }[] = [];
                for (const index of [measure.index - 1, measure.index, measure.index + 1]) {
                    for (const staff of model.measures[index]?.staves ?? []) {
                        for (const layer of staff.layers) {
                            for (const other of layer.events) {
                                if (hidden.has(other)) continue;
                                for (const written of other.notes) {
                                    if (!hiddenIds.has(written.id)) around.push({ note: written, away: Math.abs(other.onset - event.onset) });
                                }
                            }
                        }
                    }
                }
                around.sort((a, b) => a.away - b.away);
                const spelled = spell(span.pitch, { key: event.layer.staff.key, around: around.map((entry) => entry.note) });
                if (spelled.pname === note.pname && spelled.alter === note.alter) notation.spelling++;

                // The length only of a note that stands alone at its place and on the grid
                const start = (event.onset - measure.onset) * UNITS;
                const released = onsetAt(map, span.offsetMs);
                if (regime === 'alone' && event.notes.length === 1 && Math.abs(start - Math.round(start)) < 1e-6 && released !== undefined && levelOf(event.onset - measure.onset, measure.meter) !== 0) {
                    // How far it is to the next thing written on that staff
                    let gap = (measure.onset + measure.duration - event.onset) * UNITS;
                    for (const layer of event.layer.staff.layers) {
                        for (const other of layer.events) {
                            if (hidden.has(other) || other.grace || other.notes.length === 0) continue;
                            if (other.onset > event.onset + 1e-6) gap = Math.min(gap, (other.onset - event.onset) * UNITS);
                        }
                    }
                    const held = (released - event.onset) * UNITS;
                    const truth = event.duration * UNITS;
                    notation.valueAsked++;
                    const value = chooseValue(Math.round(start), gap, measure);

                    // What the obvious rule would have written: the value nearest the time the
                    // key was down
                    const nearest = [144, 96, 72, 48, 36, 24, 18, 12, 9, 6, 3].reduce((best, units) =>
                        Math.abs(Math.log(units / Math.max(held, 1))) < Math.abs(Math.log(best / Math.max(held, 1))) ? units : best,
                    );
                    if (Math.abs(nearest - truth) < 1e-6) notation.held++;
                    if (Math.abs(value.units - truth) < 1e-6) notation.value++;
                    if (value.units <= truth * 2 + 1e-6 && value.units >= truth / 2 - 1e-6) notation.valueNear++;
                }
            }
        }

        for (const entry of quantise(model, map, played, { hidden, settings })) {
            for (const note of entry.cluster.notes) {
                const want = truth(note);
                for (const tally of [totals[regime], rollTally[regime]]) {
                    tally.asked++;
                    if (entry.placement.kind === 'unplaced') tally.unplaced++;
                    else if (entry.placement.kind === 'grace') {
                        tally.grace++;
                        if (want === 'grace') tally.exact++;
                    } else if (want !== 'grace' && Math.abs(entry.placement.onset - want) < 1e-6) tally.exact++;

                    // The two things a transcriber without a model of the music would do
                    if (want !== 'grace') {
                        const pointed = onsetAt(map, note.onsetMs);
                        const measure = pointed === undefined ? undefined : measureAt(model, pointed);
                        if (pointed !== undefined && measure) {
                            const within = pointed - measure.onset;
                            if (Math.abs(measure.onset + Math.round(within * 4) / 4 - want) < 1e-6) tally.sixteenths++;
                            let best = Infinity;
                            let bestAt = 0;
                            for (let unit = 0; unit <= Math.round(measure.duration * 24); unit++) {
                                if (unit % 3 !== 0 && unit % 4 !== 0) continue;
                                const at = unit / 24;
                                if (levelOf(at, measure.meter) === 0) continue;
                                if (Math.abs(at - within) < best) { best = Math.abs(at - within); bestAt = at; }
                            }
                            if (Math.abs(measure.onset + bestAt - want) < 1e-6) tally.nearest++;
                        }
                    }
                }
            }
        }
    };

    const onsetOf = new Map<string, number>();
    for (const pairing of pairings) onsetOf.set(pairing.span.id, pairing.note.event.onset);
    const written = (played: Played) => onsetOf.get(played.id) ?? NaN;

    // alone: every sixth moment, so that each hidden one keeps its neighbours
    ask('alone', moments.filter((_, index) => index % 6 === 3).flatMap(([, list]) => list), written);

    // run: figures of two to five moments, well apart
    const runs: Pairing[] = [];
    for (let start = 10, length = 2; start + length < moments.length; start += 23, length = length === 5 ? 2 : length + 1) {
        for (let index = start; index < start + length; index++) runs.push(...moments[index][1]);
    }
    ask('run', runs, written);

    // chord: one note of a moment whose other notes stay, every third such moment
    const chordTones = moments
        .filter(([, list]) => list.length >= 2)
        .filter((_, index) => index % 3 === 1)
        .map(([, list], index) => list[index % list.length]);
    ask('chord', chordTones, written);

    // grace: the grace notes the score writes
    ask('grace', graces, () => 'grace');

    const share = (tally: Tally) => (tally.asked === 0 ? '   –' : (100 * tally.exact / tally.asked).toFixed(1).padStart(5));
    perRoll.push(
        `${pair.roll} ${pair.title.padEnd(20)} ${pair.performer.padEnd(14)} alone ${share(rollTally.alone)} (${String(rollTally.alone.asked).padStart(4)})  ` +
            `run ${share(rollTally.run)} (${String(rollTally.run.asked).padStart(3)})  chord ${share(rollTally.chord)} (${String(rollTally.chord.asked).padStart(3)})  ` +
            `grace ${share(rollTally.grace)} (${String(rollTally.grace.asked).padStart(3)})`,
    );
}

if (!report) return totals;
if (!quiet) perRoll.forEach((line) => console.log(line));
for (const [regime, tally] of Object.entries(totals)) {
    const percent = (count: number) => (100 * count / Math.max(1, tally.asked)).toFixed(1);
    console.log(
        `${regime.padEnd(6)} ${String(tally.asked).padStart(5)} asked, ${percent(tally.exact)}% right` +
            (regime === 'grace'
                ? `, ${percent(tally.asked - tally.grace - tally.unplaced)}% measured instead`
                : `, ${percent(tally.grace)}% taken for a grace note, sixteenth grid ${percent(tally.sixteenths)}%, nearest grid place ${percent(tally.nearest)}%`) +
            `, ${percent(tally.unplaced)}% unplaced`,
    );
}
const share = (count: number, of: number) => (100 * count / Math.max(1, of)).toFixed(1);
console.log(
    `staff ${share(notation.staff, notation.asked)}% right and spelling ${share(notation.spelling, notation.asked)}% of ${String(notation.asked)}; ` +
        `note value ${share(notation.value, notation.valueAsked)}% the written one, ${share(notation.valueNear, notation.valueAsked)}% within a factor of two, of ${String(notation.valueAsked)} ` +
        `(by how long the key was held: ${share(notation.held, notation.valueAsked)}%)`,
);
return totals;
};

if (sweeps.length === 0) evaluate(fixed, true);
else {
    const share = (tally: Tally) => (100 * tally.exact / Math.max(1, tally.asked)).toFixed(1);
    for (const { key, values } of sweeps) {
        for (const value of values) {
            const totals = evaluate({ ...fixed, [key]: value }, false);
            console.log(
                `${key}=${String(value).padEnd(6)} alone ${share(totals.alone)}  run ${share(totals.run)}  chord ${share(totals.chord)}  grace ${share(totals.grace)}  ` +
                    `(measured taken for grace: ${(100 * (totals.alone.grace + totals.run.grace + totals.chord.grace) / (totals.alone.asked + totals.run.asked + totals.chord.asked)).toFixed(1)}%)`,
            );
        }
    }
}
