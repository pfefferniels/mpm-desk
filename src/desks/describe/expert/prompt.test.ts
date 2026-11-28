import { beforeAll, describe, expect, it } from 'vitest';
import { about, bar, loadFixture, said, step, type Fixture } from './fixture';
import { leftIn, measures } from './left';
import { buildPrompt, KNOWLEDGE } from './prompt';
import type { Call } from '../../../model/Work';
import type { ExpertRequest } from './types';

/**
 * What the expert is told, over the published transcription: that the knowledge speaks of the
 * desk as it is, and that a request says what the reader said, of which notes, in what piece and
 * after what else.
 */

let fixture: Fixture;
/** The first notes of the piece: the upbeat, the downbeat in both hands, and the line after it. */
const UPBEAT = 'npk4lw6';
const [MELODY, BASS] = ['nxbdd6x', 'n4vqmkc'];
const [TENOR, ALTO] = ['n1obi0t8', 'nd80ywu'];
const [E4, C5] = ['nrbga5m', 'n10g2bbj'];

const PIECE = about('piece');

beforeAll(() => {
    fixture = loadFixture();
});

const lines = (prompt: string) => prompt.split('\n');
/** The rows under a heading, down to the next empty line. */
const under = (prompt: string, heading: string) => {
    const all = lines(prompt);
    const from = all.findIndex((line) => line.startsWith(heading));
    expect(from).toBeGreaterThan(-1);
    const to = all.indexOf('', from);
    return all.slice(from + 1, to);
};
const asked = (prompt: string) => under(prompt, '# THE REMARK TO TRANSLATE');

describe('the knowledge', () => {
    it('is the three texts in their order, and speaks of the desk and its steps', () => {
        const [desk, transformers, mpm] = [
            '# YOU ARE THE EXPERT BEHIND THE DESCRIBE DESK',
            '# REFERENCE 1: THE TRANSFORMERS OF THE CHAIN',
            '# REFERENCE 2: WHAT THE MPM INSTRUCTIONS MEAN',
        ].map((title) => KNOWLEDGE.indexOf(title));
        expect(desk).toBe(0);
        expect(transformers).toBeGreaterThan(desk!);
        expect(mpm).toBeGreaterThan(transformers!);

        expect(KNOWLEDGE).toContain('`try_steps({steps})`');
        expect(KNOWLEDGE).toContain('`withheld`');
        // A press of the pedal is named by its id, which the piece lists.
        expect(KNOWLEDGE).toContain('or `{"pedal": id}` per press (the presses are listed with the piece)');
        expect(KNOWLEDGE).not.toMatch(/DescribeIt|try_calls|"calls"|`reading`/);
    });

    it('is no part of a request, which says only what changes from one to the next', () => {
        const prompt = buildPrompt(fixture.request(said('r1', 'arpeggio throughout', PIECE)));
        expect(prompt).not.toContain('REFERENCE 1');
        expect(prompt.startsWith('# THE PIECE\n')).toBe(true);
    });
});

describe('the piece', () => {
    let request: ExpertRequest;
    let prompt: string;
    beforeAll(() => {
        request = fixture.request(said('r1', 'arpeggio throughout', PIECE));
        prompt = buildPrompt(request);
    });

    it('is named, with its ticks, its metre, its bars and its parts', () => {
        const [, title, resolution, bars, parts, repeats] = lines(prompt);
        expect(title).toBe(request.piece.title);
        expect(resolution).toBe(
            'Resolution: 720 ticks per quarter note. Time signatures: 1/4 from tick 0 (a bar of 720 ticks, a beat of 720); 4/4 from tick 720 (a bar of 2880 ticks, a beat of 720). The score ends at tick 92880.',
        );
        expect(bars).toMatch(/: 0:0 1:720 2:3600 .* 32:90000$/);
        expect(parts).toMatch(/^Parts: 1, 2\. /);
        // Its first eight bars are played twice.
        expect(repeats).toMatch(/^A note whose id ends in -rend2 /);
    });

    it('lists every note in a row of thirteen columns, by its tick and then its pitch', () => {
        const [head, ...rows] = under(prompt, '## Every note').slice(1);
        expect(head).toBe(
            'id\tpart\ttick\tbar:beat\tticks\tpitch\tname\tonset_ms\tsounds_ms\tvelocity\tleft_late_ms\tleft_loud\tleft_long_ms',
        );
        const { notes } = request.run.roll;
        expect(rows).toHaveLength(notes.length);
        expect(rows.every((row) => row.split('\t').length === 13)).toBe(true);

        // The upbeat is where the recording begins, and the rendering with it.
        expect(rows[0]).toMatch(/^npk4lw6\t1\t0\t0:1\t720\t60\tC4\t0\t979\t41\t0\t/);
        // The downbeat: the bass under the melody, each as the roll has it.
        expect(rows[1]?.split('\t').slice(0, 7)).toEqual([BASS, '2', '720', '1:1', '3600', '41', 'F2']);
        const melody = notes.find((note) => note.id === MELODY)!;
        expect(rows[2]?.split('\t')).toEqual([
            MELODY,
            '1',
            '720',
            '1:1',
            '1800',
            '65',
            'F4',
            String(Math.round(melody.ms)),
            String(Math.round(melody.msEnd - melody.ms)),
            String(melody.velocity),
            String(Math.round(melody.late)),
            melody.loud.toFixed(1),
            String(Math.round(melody.longMs)),
        ]);

        const ticks = rows.map((row) => Number(row.split('\t')[2]));
        expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
        // Spelled as the score spells them: this piece is in F, and has its B flats.
        expect(rows.some((row) => /\tB♭\d\t/.test(row))).toBe(true);
        expect(rows.some((row) => /\tA♯\d\t/.test(row))).toBe(false);
    });

    it('lists the presses of the pedals and the grace-note groups as they were recorded', () => {
        const { pedals, graces } = request.run.roll;
        const [head, ...presses] = under(prompt, '## Pedal presses');
        expect(head).toBe('id\tpedal\tdown_ms\tup_ms');
        // Each by the id a step names it by; the soft pedal is down before the first note.
        expect(presses.map((press) => press.split('\t')[0])).toEqual(
            pedals.played.map((press) => press.id),
        );
        expect(presses[0]).toBe('soft-0\tsoft\t-1824\t75715');

        const [columns, ...groups] = under(prompt, '## Grace-note groups');
        expect(columns).toBe('group\tprincipal\tbar:beat\tnotes');
        expect(groups).toHaveLength(new Set(graces.map((grace) => grace.group)).size);
        // A principal the roll has no row for is placed by the score.
        expect(groups[0]).toBe('pxnvdff\tnanro74\t2:2\t2');
    });

    it('says what is assumed and what is left where nothing is described', () => {
        const described = lines(prompt).slice(lines(prompt).indexOf('# WHAT HAS BEEN DESCRIBED SO FAR'));
        expect(described[1]).toBe('No other remark has become steps yet.');
        // Whether anything was made by hand it was not told, and says so.
        expect(described[2]).toMatch(/^Calls made by hand on the other desks .* are not listed/);
        expect(prompt).not.toContain('# WHAT WAS MADE BY HAND');
        expect(described).toContain('- steady tempo: [0,92880) 47.9 bpm');
        expect(described).toContain('- level: velocity 37 from ticks 0');
        const left = measures(leftIn(request.run.roll.notes));
        expect(described).toContain(
            `Still unexplained over the whole piece, 450 notes: pulse_ms ${left.pulse_ms}, spread_ms ${left.spread_ms}, velocity ${left.velocity}, length_ms ${left.length_ms}.`,
        );
    });

    it('gives its places in ticks where the score states no bars', () => {
        const barless = buildPrompt({ ...request, piece: { ...request.piece, bars: [] } });
        expect(barless).toContain('The score states no metre, so it has no bars');
        expect(under(barless, '## Every note')[2]).toMatch(/^npk4lw6\t1\t0\ttick 0\t/);
    });
});

describe('what was made by hand on the other desks', () => {
    const HEADING = '# WHAT WAS MADE BY HAND ON THE OTHER DESKS';
    const call = (name: string, options: Record<string, unknown> = {}): Call => ({
        id: `${name}-${JSON.stringify(options).length}`,
        name,
        options,
    });

    it('is counted by transformer, each with the ticks its calls speak of', () => {
        const byHand = [
            call('MakeChoice', { prefer: '#take' }),
            call('InsertTempo', { from: bar(1), to: bar(2), bpm: 50, beatLength: 0.25 }),
            call('InsertTempo', { from: bar(2), to: bar(3), bpm: 60, beatLength: 0.25 }),
            call('InsertRubato', { date: 2880, length: 720 }),
            call('InsertArticulation', { noteIDs: [MELODY, C5], name: 'held' }),
            call('Modify', { aspect: 'velocity', change: -2, noteIDs: [UPBEAT] }),
            call('Modify', { aspect: 'velocity', points: [[35, 20], [54, 46]] }),
            call('InsertPedal', {
                pedal: 'sustain-1440',
                guides: new Map([[600.4, 0], [800, 1], [2100.6, 0]]),
            }),
        ];
        const request = fixture.request(said('r1', 'rush', PIECE));
        const prompt = buildPrompt({ ...request, byHand });
        expect(under(prompt, HEADING)).toEqual([
            expect.stringMatching(
                /^8 calls of the document belong to no remark\. They run as they stand, .*: where a step speaks of ticks one of them already speaks of, both run\. /,
            ),
            '- InsertTempo ×2: ticks 720 to 6480 (1:1 to 3:1)',
            '- InsertRubato ×1: ticks 2880 to 3600 (1:4 to 2:1)',
            // Placed by the notes it names, and by the guides of a press.
            '- InsertArticulation ×1: ticks 720 to 3600 (1:1 to 2:1)',
            '- Modify ×2: tick 0 (0:1); 1 without a place',
            '- InsertPedal ×1: ticks 600 to 2101 (0:1.83 to 1:2.92)',
            '- naming no place in the score: MakeChoice ×1',
        ]);
        // It comes after what the remarks became, and the caveat it answers is gone.
        const all = lines(prompt);
        expect(all.indexOf(HEADING)).toBeGreaterThan(all.indexOf('# WHAT HAS BEEN DESCRIBED SO FAR'));
        expect(all.indexOf(HEADING)).toBeLessThan(all.indexOf('# THE REMARK TO TRANSLATE'));
        expect(prompt).not.toContain('are not listed');
    });

    it('is a dozen lines for the published reconstruction, every transformer once', () => {
        const byHand = fixture.published;
        const request = fixture.request(said('r1', 'rush', PIECE), [], { byHand });
        const prompt = buildPrompt(request);
        const [counted, ...rows] = under(prompt, HEADING);
        expect(counted).toMatch(new RegExp(`^${byHand.length} calls of the document `));
        expect(rows.length).toBeLessThanOrEqual(12);

        const section = rows.join('\n');
        for (const [name, calls] of Map.groupBy(byHand, ({ name }) => name)) {
            expect(section.split(`${name} ×${calls.length}`)).toHaveLength(2);
        }
        // The tempos drawn, from the first of them to where the last ends.
        const tempos = byHand.filter(({ name }) => name === 'InsertTempo');
        const first = Math.min(...tempos.map(({ options }) => options['from'] as number));
        const last = Math.max(...tempos.map(({ options }) => options['to'] as number));
        expect(rows).toContainEqual(
            expect.stringMatching(
                new RegExp(`^- InsertTempo ×${tempos.length}: ticks ${first} to ${last} \\(`),
            ),
        );
        expect(rows.at(-1)).toMatch(/^- naming no place in the score: .*MakeChoice ×1/);
        // What they describe is no longer assumed, and little is left of it.
        expect(prompt).toContain('- level: none, dynamics are described throughout');
    });

    it('is left out where nothing was', () => {
        const request = fixture.request(said('r1', 'rush', PIECE));
        const prompt = buildPrompt({ ...request, byHand: [] });
        expect(prompt).not.toContain(HEADING);
        expect(prompt).not.toContain('are not listed');
    });
});

describe('the remark', () => {
    it('stands verbatim, whatever it holds', () => {
        const text = 'Das "ritardando" hier —\nbreiter, {"steps": []}';
        const prompt = buildPrompt(fixture.request(said('r1', text, PIECE)));
        expect(prompt).toContain(`The remark, verbatim: """${text}"""`);
    });

    it('about the whole piece is measured by every note', () => {
        const prompt = buildPrompt(fixture.request(said('r1', 'arpeggio throughout', PIECE)));
        expect(asked(prompt)).toEqual([
            'The reader selected nothing, so speaks about the whole piece: the whole piece.',
            'Ticks: from 0 (first selected onset) to 92880 (the next onset in the score after the last selected one; here the end of the score).',
            expect.stringMatching(/^Before your steps, what is left in the passage, 450 notes: /),
        ]);
    });

    it('about a passage names its bars and every note in them', () => {
        const bars = about('span', bar(1), bar(5));
        const request = fixture.request(said('r1', 'steady tempo on half bars', bars));
        const [how, ticks, ids, left] = asked(buildPrompt(request));
        expect(how).toBe(
            'The reader drew a bracket over a passage, both hands, every note in it: bars 1–4.',
        );
        expect(ticks).toMatch(/^Ticks: from 720 \(first selected onset\) to 12240 /);
        const inside = request.run.roll.notes.filter(
            (note) => note.date >= bar(1) && note.date < bar(5),
        );
        expect(ids?.replace('Selected note ids: ', '').split(' ').sort()).toEqual(
            inside.map((note) => note.id).sort(),
        );
        expect(left).toContain(`passage, ${inside.length} notes: `);

        // A passage that keeps to no bar line is said from where to where.
        const within = about('span', 2520, 3600);
        expect(asked(buildPrompt(fixture.request(said('r1', 'rush', within))))[0]).toMatch(
            /: bar 1, beat 3\.5 to bar 2\.$/,
        );
    });

    it('about one note names it; about several, how many and where', () => {
        const one = about('notes', 720, 1440, [MELODY]);
        expect(asked(buildPrompt(fixture.request(said('r1', 'quieter', one))))).toEqual([
            'The reader picked one note: F4, bar 1, part 1.',
            expect.stringMatching(/^Ticks: from 720 .* to 1440 /),
            `Selected note ids: ${MELODY}`,
            expect.stringMatching(/passage, 1 notes: /),
        ]);

        const chord = about('notes', 720, 1440, [MELODY, BASS]);
        const [how, , ids, left] = asked(buildPrompt(fixture.request(said('r1', 'together', chord))));
        expect(how).toBe('The reader picked these notes: 2 notes, bar 1.');
        expect(ids).toBe(`Selected note ids: ${MELODY} ${BASS}`);
        expect(left).toContain('passage, 2 notes: ');
    });

    it('about a box names the notes in it, and not the others of its passage', () => {
        const box = about('box', 720, 2520, [MELODY, TENOR, ALTO]);
        const [how, , ids, left] = asked(buildPrompt(fixture.request(said('r1', 'legato', box))));
        expect(how).toBe(
            'The reader drew a box round some of the notes of a passage: 3 notes, bar 1 to bar 1, beat 3.5, part 1.',
        );
        expect(ids).toBe(`Selected note ids: ${MELODY} ${TENOR} ${ALTO}`);
        expect(left).toContain('passage, 3 notes: ');
    });

    it('about an arrow names its two notes, and takes every note between them', () => {
        const arrow = about('arrow', 2520, 3960, [E4, C5]);
        const request = fixture.request(said('r1', 'pull towards the downbeat', arrow));
        expect(asked(buildPrompt(request))).toEqual([
            'The reader drew an arrow from one note to another, a direction: the playing sets out at the first and makes for the last: E4 → C5, bar 1, beat 3.5 to bar 2.',
            'Ticks: from 2520 (first selected onset) to 3960 (the next onset in the score after the last selected one).',
            `The arrow runs from note ${E4} to note ${C5}, whose chord is the last before tick 3960; its passage is every note from tick 2520 up to tick 3960, both hands.`,
            expect.stringMatching(/passage, 4 notes: /),
        ]);
    });
});

describe('what else is said', () => {
    const SPAN = about('span', bar(1), bar(5));

    it('lists the other remarks that became steps, each with its place and its steps', () => {
        const tempo = said('tempo', 'steady tempo on half bars', SPAN, [
            step('FitTempo', { from: bar(1), to: bar(5), step: 1440 }),
        ]);
        const level = said('level', 'piano "subito"', about('notes', 0, 720, [UPBEAT]), [
            step('InsertDynamics', { from: 0, to: 0, guides: new Map([[0, 33]]) }),
        ]);
        const waiting = said('waiting', 'dreamy', PIECE);
        const request = fixture.request(said('r1', 'rush', PIECE), [tempo, level, waiting]);
        const prompt = buildPrompt(request);
        const described = under(prompt, '# WHAT HAS BEEN DESCRIBED SO FAR');

        expect(described.slice(0, 2)).toEqual([
            `- "steady tempo on half bars" (about bars 1–4; ticks 720–12240) → [{"name":"FitTempo","options":{"from":720,"to":12240,"step":1440}}]`,
            // A map of guides is written the way the expert writes one.
            `- "piano "subito"" (about C4, bar 0, part 1; ticks 0–720) → [{"name":"InsertDynamics","options":{"from":0,"to":0,"guides":{"0":33}}}]`,
        ]);
        expect(prompt).not.toContain('dreamy');
        expect(prompt).not.toContain('No other remark');

        // Their spans are no longer assumed.
        expect(prompt).toMatch(/- steady tempo: \[0,720\) [\d.]+ bpm, \[12240,92880\) [\d.]+ bpm/);
        expect(prompt).toContain('- level: velocity 37 from ticks 720');
    });

    it('gives the thread of questions and answers, oldest first, and none where there is none', () => {
        const request = fixture.request(said('r1', 'dreamy', PIECE), [], {
            thread: [
                { question: 'What gives that impression?', answer: 'the rolled chords' },
                { question: 'In which bars?', answer: 'the "first" eight' },
            ],
        });
        const prompt = buildPrompt(request);
        expect(under(prompt, '# WHAT YOU ASKED, AND WHAT THE READER ANSWERED')).toEqual([
            'You asked: What gives that impression?',
            'The reader answered: """the rolled chords"""',
            'You asked: In which bars?',
            'The reader answered: """the "first" eight"""',
            'Translate the remark in the light of the answer.',
        ]);
        expect(buildPrompt({ ...request, thread: [] })).not.toContain('# WHAT YOU ASKED');
    });

    it('shows the steps that have to be mended, with what the chain said of them', () => {
        const broken = said('r1', 'a tempo', SPAN, [step('InsertTempo', { from: bar(1), to: bar(5) })]);
        const request = fixture.request(broken, [], {
            mend: ['step 0 (InsertTempo): InsertTempo needs a number for "bpm"', 'step 1: gone'],
        });
        const prompt = buildPrompt(request);
        expect(under(prompt, '# YOUR EARLIER ANSWER, WHICH NEEDS MENDING')).toEqual([
            'Steps: [{"name":"InsertTempo","options":{"from":720,"to":12240}}]',
            'What the chain said: step 0 (InsertTempo): InsertTempo needs a number for "bpm" | step 1: gone',
            'Answer again with steps that run.',
        ]);

        // Asked anew, its earlier steps are not held up to it; and nothing is mended of none.
        expect(buildPrompt({ ...request, mend: undefined })).not.toContain('NEEDS MENDING');
        const fresh = fixture.request(said('r1', 'a tempo', SPAN), [], { mend: [] });
        expect(buildPrompt(fresh)).not.toContain('NEEDS MENDING');
    });

    it('ends on the form of the answer', () => {
        const prompt = buildPrompt(fixture.request(said('r1', 'arpeggio throughout', PIECE)));
        expect(lines(prompt).slice(-6)).toEqual([
            '# ANSWER',
            'Check your steps with try_steps before you answer, as the section "What is left, and the tool that tells you" says: three tries at most.',
            'Then reply with one JSON object and nothing else, in exactly this shape:',
            '{"steps": [{"name": "<transformer or fitted step>", "options": { ... }}],',
            ' "question": null}',
            'Leave "steps" empty and put one short question in "question", in the language of the remark, only when the remark cannot be translated without knowing more.',
        ]);
    });
});
