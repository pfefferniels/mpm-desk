/**
 * What the expert is told: what it knows whatever it is asked, and one remark with the piece it
 * was made on.
 */
import type { Roll, RollNote, Step } from '../../../fitting/description/client';
import type { DescribedPlace } from '../../../fitting/transformers/description/Describe';
import describing from './knowledge/00-describe-desk.md?raw';
import transformers from './knowledge/10-transformers.md?raw';
import instructions from './knowledge/20-mpm.md?raw';
import { idsOf, leftIn, measures, type Left } from './left';
import { placesOf, type Places } from './places';
import type { ExpertRequest } from './types';

/**
 * The desk and its steps, the transformers of the chain, and what the instructions mean to the
 * renderer. The same text for every remark of every piece, which is what lets the API keep it
 * from one request to the next: nothing of a piece or a remark may find its way in here.
 */
export const KNOWLEDGE = [describing, transformers, instructions]
    .map((text) => text.trim())
    .join('\n\n\n');

/** A note as an MSM score writes it: where it stands, and how it is spelled. */
interface Scored {
    date: number;
    letter: string;
    alter: number;
}

/** The piece as the prompt reads it: the roll, the score's own word on a note, and its places. */
interface Sheet extends Places {
    roll: Roll;
    byId: ReadonlyMap<string, RollNote>;
    /**
     * Every note of the score by its id. It holds what the roll has no row for: a principal
     * struck only as the grace note tied into it.
     */
    scored: ReadonlyMap<string, Scored>;
}

const scoredIn = (score: string): Map<string, Scored> => {
    const stated = (tag: string, attribute: string) =>
        new RegExp(`\\s${attribute}="([^"]*)"`).exec(tag)?.[1];
    const notes = new Map<string, Scored>();
    for (const [tag] of score.matchAll(/<note\b[^>]*>/g)) {
        const id = stated(tag, 'xml:id');
        if (!id) continue;
        notes.set(id, {
            date: Number(stated(tag, 'date')),
            letter: stated(tag, 'pitchname') ?? '',
            alter: Math.round(Number(stated(tag, 'accidentals'))) || 0,
        });
    }
    return notes;
};

const sheetOf = ({ run, piece }: ExpertRequest): Sheet => ({
    ...placesOf(piece, run.roll.timeSignatures),
    roll: run.roll,
    byId: new Map(run.roll.notes.map((note) => [note.id, note])),
    scored: scoredIn(run.score),
});

/** A note as the score spells it, "E♭4"; its MIDI pitch where the score does not say. */
const nameOf = ({ id, pitch }: RollNote, { scored }: Sheet) => {
    const { letter, alter } = scored.get(id) ?? { letter: '', alter: 0 };
    if (!letter) return String(pitch);
    // The octave is the letter's: a C flat belongs to the octave of the C above it.
    const octave = Math.floor((pitch - alter) / 12) - 1;
    return `${letter.toUpperCase()}${(alter > 0 ? '♯' : '♭').repeat(Math.abs(alter))}${octave}`;
};

const table = (columns: string[], rows: (string | number)[][]) =>
    [columns, ...rows].map((row) => row.join('\t')).join('\n');

const noteTable = (sheet: Sheet) =>
    table(
        [
            'id',
            'part',
            'tick',
            'bar:beat',
            'ticks',
            'pitch',
            'name',
            'onset_ms',
            'sounds_ms',
            'velocity',
            'left_late_ms',
            'left_loud',
            'left_long_ms',
        ],
        [...sheet.roll.notes]
            .sort((a, b) => a.date - b.date || a.pitch - b.pitch)
            .map((note) => [
                note.id,
                note.part,
                note.date,
                sheet.place(note.date),
                note.duration,
                note.pitch,
                nameOf(note, sheet),
                Math.round(note.ms),
                Math.round(note.msEnd - note.ms),
                note.velocity,
                Math.round(note.late),
                note.loud.toFixed(1),
                Math.round(note.longMs),
            ]),
    );

const pedalTable = ({ roll }: Sheet) =>
    table(
        ['pedal', 'down_ms', 'up_ms'],
        roll.pedals.played.map(({ kind, ms, msEnd }) => [kind, Math.round(ms), Math.round(msEnd)]),
    );

const graceTable = ({ roll, scored, place }: Sheet) =>
    table(
        ['group', 'principal', 'bar:beat', 'notes'],
        [...Map.groupBy(roll.graces, (grace) => grace.group)].map(([group, graces]) => {
            const { principal } = graces[0]!;
            const date = scored.get(principal)?.date;
            return [group, principal, date === undefined ? '-' : place(date), graces.length];
        }),
    );

const metres = ({ ppq }: ExpertRequest['piece'], { roll }: Sheet) =>
    roll.timeSignatures
        .map(({ date, numerator, denominator }) => {
            const beat = (4 * ppq) / denominator;
            return `${numerator}/${denominator} from tick ${date} (a bar of ${numerator * beat} ticks, a beat of ${beat})`;
        })
        .join('; ');

const measureText = (left: Left) => {
    const { notes, pulse_ms, spread_ms, velocity, length_ms } = measures(left);
    return `${notes} notes: pulse_ms ${pulse_ms}, spread_ms ${spread_ms}, velocity ${velocity}, length_ms ${length_ms}`;
};

/** Steps as the expert writes them: a `Map` as a plain object, a `Set` as an array. */
const written = (steps: readonly Step[]) =>
    JSON.stringify(steps, (_key, value: unknown) => {
        if (value instanceof Map) return Object.fromEntries(value);
        return value instanceof Set ? [...value] : value;
    });

/** The stretch a remark is about, in ticks; the whole score where it is about the piece. */
const stretchOf = ({ kind, from, to }: DescribedPlace, { roll }: Sheet) =>
    kind === 'piece' ? { from: 0, to: roll.end } : { from, to };

/** What a remark is about, as its reader would say it. */
const labelOf = (about: DescribedPlace, sheet: Sheet) => {
    const { byId, where, span } = sheet;
    const name = (note: RollNote) => nameOf(note, sheet);
    const { kind, from, to } = about;
    if (kind === 'piece') return 'the whole piece';
    if (kind === 'span') return span(from, to);

    const notes = about.notes.flatMap((id) => byId.get(id) ?? []);
    const [first, second] = notes;
    if (kind === 'arrow' && first && second && notes.length === 2) {
        return `${name(first)} → ${name(second)}, ${where(first.date)} to ${where(second.date)}`;
    }
    const parts = [...new Set(notes.map((note) => note.part))];
    const part = parts.length === 1 ? `, part ${parts[0]}` : '';
    if (about.notes.length === 1) {
        return `${first ? name(first) : 'one note'}, ${where(from)}${part}`;
    }
    const chord = notes.every((note) => note.date === from);
    return `${about.notes.length} notes, ${chord ? where(from) : span(from, to)}${part}`;
};

const HOW: Record<Exclude<DescribedPlace['kind'], 'notes'>, string> = {
    piece: 'selected nothing, so speaks about the whole piece',
    span: 'drew a bracket over a passage, both hands, every note in it',
    arrow: 'drew an arrow from one note to another, a direction: the playing sets out at the first and makes for the last',
    box: 'drew a box round some of the notes of a passage',
};

const pieceSection = ({ piece }: ExpertRequest, sheet: Sheet) => {
    const { notes } = sheet.roll;
    const parts = [...new Set(notes.map((note) => note.part))].sort((a, b) => a - b);
    const bars = piece.bars.map((bar) => `${bar.n}:${bar.from}`).join(' ');
    // A repeat written with repeat signs is read as two passes, the second under ids of its own.
    const repeats = notes.some((note) => /-rend\d+$/.test(note.id));
    return [
        '# THE PIECE',
        piece.title,
        `Resolution: ${piece.ppq} ticks per quarter note. Time signatures: ${metres(piece, sheet) || 'none'}. The score ends at tick ${sheet.roll.end}.`,
        bars
            ? `Bars as "number:first tick" (a bar 0 is the upbeat): ${bars}`
            : 'The score states no metre, so it has no bars: places are given in ticks.',
        `Parts: ${parts.join(', ')}. A step's \`scope\` n − 1 names part n. A part is a staff, 1 the upper (the right hand) and 2 the lower (the left hand), unless the document lays its voices out otherwise.`,
        ...(repeats
            ? [
                  'A note whose id ends in -rend2 is the note of the id without that ending, the second time through a repeat.',
              ]
            : []),
        '',
        '## Every note, with what the document as it stands leaves unexplained',
        'onset_ms and sounds_ms are the recording as corrected so far (ms from the first note); velocity is the recording. The three left_ columns are the recording less what the MPM as it stands renders, the rendering being laid against the recording wherever a tempo begins on a chord: left_late_ms the onset (positive: played later than the MPM has it), left_loud the velocity, left_long_ms the sounded length.',
        noteTable(sheet),
        '',
        '## Pedal presses as recorded (ms from the first note; a press may begin before it)',
        pedalTable(sheet),
        '',
        '## Grace-note groups as recorded (a principal that is not in the note table is struck only as the grace note tied into it)',
        graceTable(sheet),
    ];
};

const describedSection = ({ others }: ExpertRequest, sheet: Sheet) => {
    const said = others
        .filter((other) => other.steps.length > 0)
        .map(({ text, about, steps }) => {
            const { from, to } = stretchOf(about, sheet);
            return `- "${text}" (about ${labelOf(about, sheet)}; ticks ${from}–${to}) → ${written(steps)}`;
        });
    const { tempo, level, levelDates } = sheet.roll.assumed;
    const steady = tempo.map((gap) => `[${gap.from},${gap.to}) ${gap.bpm.toFixed(1)} bpm`);
    return [
        '# WHAT HAS BEEN DESCRIBED SO FAR',
        ...(said.length > 0 ? said : ['No other remark has become steps yet.']),
        'Calls made by hand on the other desks of the MPM Desk are not listed: where the document holds any, they show in what is assumed and in what is left.',
        '',
        'Assumed by the run where nothing is described (do not restate these; they give way to your steps):',
        `- steady tempo: ${steady.join(', ') || 'none, the tempo is described throughout'}`,
        level !== null && levelDates.length > 0
            ? `- level: velocity ${level} from ticks ${levelDates.join(', ')}`
            : '- level: none, dynamics are described throughout',
        '',
        `Still unexplained over the whole piece, ${measureText(leftIn(sheet.roll.notes))}.`,
    ];
};

const remarkSection = ({ remark: { text, about } }: ExpertRequest, sheet: Sheet) => {
    const { from, to } = stretchOf(about, sheet);
    const ids = idsOf(about, sheet.roll.notes);
    const picked =
        about.kind === 'notes'
            ? `picked ${about.notes.length === 1 ? 'one note' : 'these notes'}`
            : HOW[about.kind];
    const [first, last] = about.notes;
    return [
        '# THE REMARK TO TRANSLATE',
        `The reader ${picked}: ${labelOf(about, sheet)}.`,
        `Ticks: from ${from} (first selected onset) to ${to} (the next onset in the score after the last selected one${about.kind === 'piece' ? '; here the end of the score' : ''}).`,
        ...(about.kind === 'arrow'
            ? [
                  `The arrow runs from note ${first} to note ${last}, whose chord is the last before tick ${to}; its passage is every note from tick ${from} up to tick ${to}, both hands.`,
              ]
            : ids && ids.length > 0
              ? [`Selected note ids: ${ids.join(' ')}`]
              : []),
        `Before your steps, what is left in the passage, ${measureText(leftIn(sheet.roll.notes, ids))}.`,
        '',
        `The remark, verbatim: """${text}"""`,
    ];
};

const threadSection = ({ thread }: ExpertRequest) =>
    thread.length === 0
        ? []
        : [
              '',
              '# WHAT YOU ASKED, AND WHAT THE READER ANSWERED',
              ...thread.flatMap(({ question, answer }) => [
                  `You asked: ${question}`,
                  `The reader answered: """${answer}"""`,
              ]),
              'Translate the remark in the light of the answer.',
          ];

const mendSection = ({ remark, mend }: ExpertRequest) =>
    !mend || remark.steps.length === 0
        ? []
        : [
              '',
              '# YOUR EARLIER ANSWER, WHICH NEEDS MENDING',
              `Steps: ${written(remark.steps)}`,
              ...(mend.length > 0 ? [`What the chain said: ${mend.join(' | ')}`] : []),
              'Answer again with steps that run.',
          ];

const ANSWER = [
    '',
    '# ANSWER',
    'Check your steps with try_steps before you answer, as the section "What is left, and the tool that tells you" says: three tries at most.',
    'Then reply with one JSON object and nothing else, in exactly this shape:',
    '{"steps": [{"name": "<transformer or fitted step>", "options": { ... }}],',
    ' "question": null}',
    'Leave "steps" empty and put one short question in "question", in the language of the remark, only when the remark cannot be translated without knowing more.',
];

/** One remark and everything of its piece the expert has to see to translate it. */
export const buildPrompt = (request: ExpertRequest): string => {
    const sheet = sheetOf(request);
    return [
        ...pieceSection(request, sheet),
        '',
        ...describedSection(request, sheet),
        '',
        ...remarkSection(request, sheet),
        ...threadSection(request),
        ...mendSection(request),
        ...ANSWER,
    ].join('\n');
};
