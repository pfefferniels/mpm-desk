/**
 * Make an MEI score out of the note table of a DCML corpus piece.
 *
 *     npx vite-node scripts/transcription/dcml2mei.ts <notes.tsv> <measures.tsv> <out.mei>
 *
 * The corpora of the Digital and Cognitive Musicology Lab (Hentschel et al., *Empirical
 * Musicology Review* 18/1, 2024; github.com/DCMLab) are proofread scores, each with a table of
 * every note head: where it stands in its bar, how long it is, its spelling, its staff and voice,
 * whether it is tied and whether it is a grace note. That is the text of a piece and nothing
 * else, which is what a score has to be to be held against a performance: what the composer
 * wrote, with no editor's realisation and no performer's in it.
 *
 * What comes out is the notes, their values, their voices, their ties and their grace notes, with
 * rests where a first voice is silent. Slurs, dynamics, pedalling and words are not in it.
 *
 * A repeat is written out, each pass with its own notes, because a recording plays both and the
 * aligner needs a note for each. The second pass's ids end in `-rend2`, which is how verovio
 * names a pass it unfolds itself.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [notesFile, measuresFile, outFile] = process.argv.slice(2);
if (!notesFile || !measuresFile || !outFile) {
    throw new Error('usage: dcml2mei.ts <notes.tsv> <measures.tsv> <out.mei>');
}

const table = (file: string): Record<string, string>[] => {
    const [head, ...lines] = readFileSync(file, 'utf-8').split('\n').filter((line) => line.length > 0);
    const columns = head.split('\t');
    return lines.map((line) => {
        const cells = line.split('\t');
        return Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? '']));
    });
};

/** A fraction of a whole note, in eighths: nothing in these pieces is finer, and it is checked. */
const eighths = (fraction: string): number => {
    const [numerator, denominator = '1'] = fraction.split('/');
    const value = (Number(numerator) / Number(denominator)) * 8;
    if (Math.abs(value - Math.round(value * 4) / 4) > 1e-9) throw new Error(`a value finer than a thirty-second: ${fraction}`);
    return value;
};

interface Head {
    mc: number;
    onset: number;
    staff: string;
    voice: string;
    duration: number;
    grace: string;
    /** The written value of a grace note, in eighths */
    nominal: number;
    tied: string;
    pname: string;
    alter: number;
    oct: number;
    midi: number;
    chord: string;
    id: string;
    /** Eighths from the start of the unfolded piece */
    at: number;
}

const heads = table(notesFile).map((row): Omit<Head, 'id' | 'at'> => {
    const name = /^([A-G])([#b]*)(-?\d+)$/.exec(row.name);
    if (!name) throw new Error(`a note name this does not read: ${row.name}`);
    return {
        mc: Number(row.mc),
        onset: eighths(row.mc_onset),
        staff: row.staff,
        voice: row.voice,
        duration: eighths(row.duration),
        grace: row.gracenote,
        nominal: eighths(row.nominal_duration),
        tied: row.tied,
        pname: name[1].toLowerCase(),
        alter: name[2].split('').reduce((sum, sign) => sum + (sign === '#' ? 1 : -1), 0),
        oct: Number(name[3]),
        midi: Number(row.midi),
        chord: row.chord_id,
    };
});

const measures = table(measuresFile).map((row) => ({
    mc: Number(row.mc),
    mn: row.mn,
    length: eighths(row.act_dur),
    keysig: Number(row.keysig),
    timesig: row.timesig,
    repeats: row.repeats,
}));

// The order the bars are played in: once through, with everything between a repeat's two signs
// played twice
const order: { mc: number; pass: number }[] = [];
let repeatFrom = measures[0].mc;
for (const measure of measures) {
    if (measure.repeats === 'start') repeatFrom = measure.mc;
    order.push({ mc: measure.mc, pass: 1 });
    if (measure.repeats === 'end') {
        for (const again of measures) {
            if (again.mc >= repeatFrom && again.mc <= measure.mc) order.push({ mc: again.mc, pass: 2 });
        }
    }
}

const VALUES: [units: number, dur: string, dots: number][] = [
    [8, '1', 0], [6, '2', 1], [4, '2', 0], [3, '4', 1], [2, '4', 0], [1.5, '8', 1], [1, '8', 0], [0.5, '16', 0], [0.25, '32', 0],
];
const valueOf = (units: number): string => {
    const value = VALUES.find(([length]) => Math.abs(length - units) < 1e-9);
    if (!value) throw new Error(`no single note value lasts ${String(units)} eighths`);
    return `dur="${value[1]}"${value[2] ? ` dots="${String(value[2])}"` : ''}`;
};

/** Silence from one place in a bar to another, in the values a careful hand would write. */
const silence = (element: string, from: number, to: number): string => {
    let out = '';
    let at = from;
    while (at < to - 1e-9) {
        // The longest plain value that starts on its own beat and fits
        const fit = [8, 4, 2, 1, 0.5, 0.25].find((units) => Math.abs(at / units - Math.round(at / units)) < 1e-9 && at + units <= to + 1e-9);
        if (!fit) throw new Error(`a gap of ${String(to - at)} eighths at ${String(at)} that no rest fills`);
        out += `<${element} ${valueOf(fit)}/>`;
        at += fit;
    }
    return out;
};

const ACCIDENTAL: Record<number, string> = { [-2]: 'ff', [-1]: 'f', 0: 'n', 1: 's', 2: 'x' };
const FLATS = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];
const SHARPS = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];

const body: string[] = [];
const ties: string[][] = [];
const placed: Head[] = [];
let clock = 0;

order.forEach(({ mc, pass }, index) => {
    const measure = measures.find((entry) => entry.mc === mc)!;
    const suffix = pass === 2 ? '-rend2' : '';
    const inMeasure = heads.filter((head) => head.mc === mc);
    const signature = new Map(
        (measure.keysig < 0 ? FLATS : SHARPS).slice(0, Math.abs(measure.keysig)).map((pname) => [pname, measure.keysig < 0 ? -1 : 1]),
    );

    let xml = `<measure xml:id="m${String(mc)}${suffix}" n="${measure.mn}"${measure.length < 8 ? ' metcon="false"' : ''}${index === order.length - 1 ? ' right="end"' : ''}>`;
    const tiesHere: string[] = [];
    ties.push(tiesHere);

    for (const staff of ['1', '2']) {
        const onStaff = inMeasure.filter((head) => head.staff === staff);

        // What each line of the staff stands at, as the bar goes by, for every voice at once
        const standing = new Map<string, number>();
        const written = new Map<(typeof onStaff)[number], string>();
        for (const head of [...onStaff].sort((a, b) => a.onset - b.onset || (b.grace ? 1 : 0) - (a.grace ? 1 : 0))) {
            const line = `${head.pname}${String(head.oct)}`;
            const state = standing.get(line) ?? signature.get(head.pname) ?? 0;
            written.set(head, state === head.alter ? (head.alter === 0 ? '' : ` accid.ges="${ACCIDENTAL[head.alter]}"`) : ` accid="${ACCIDENTAL[head.alter]}"`);
            standing.set(line, head.alter);
        }

        xml += `<staff n="${staff}">`;
        const voices = [...new Set(onStaff.map((head) => head.voice))].sort();
        for (const voice of voices.length > 0 ? voices : ['1']) {
            const inVoice = onStaff.filter((head) => head.voice === voice);
            // One chord per chord id, the grace notes of a moment before what they lean on
            const chords = [...new Set(inVoice.map((head) => head.chord))]
                .map((chord) => inVoice.filter((head) => head.chord === chord))
                .sort((a, b) => a[0].onset - b[0].onset || (b[0].grace ? 1 : 0) - (a[0].grace ? 1 : 0) || Number(a[0].chord) - Number(b[0].chord));

            xml += `<layer n="${voice}">`;
            let at = 0;
            for (const chord of chords) {
                const [first] = chord;
                if (!first.grace && first.onset > at + 1e-9) xml += silence(voice === '1' ? 'rest' : 'space', at, first.onset);

                const notes = chord.map((head) => {
                    const id = `n${String(mc)}-${head.staff}-${head.voice}-${head.chord}-${String(head.midi)}${suffix}`;
                    placed.push({ ...head, id, at: clock + head.onset });
                    return `<note xml:id="${id}" pname="${head.pname}" oct="${String(head.oct)}"${written.get(head) ?? ''}/>`;
                });
                const value = first.grace
                    ? `grace="${first.grace === 'acciaccatura' ? 'unacc' : 'acc'}" ${valueOf(first.nominal)}`
                    : valueOf(first.duration);
                xml += notes.length === 1 ? notes[0].replace('<note ', `<note ${value} `) : `<chord ${value}>${notes.join('')}</chord>`;
                if (!first.grace) at = first.onset + first.duration;
            }
            if (at < measure.length - 1e-9) xml += silence(voice === '1' ? 'rest' : 'space', at, measure.length);
            xml += '</layer>';
        }
        xml += '</staff>';
    }

    body.push(xml);
    clock += measure.length;
});

// A tie runs from a note to the next one of its pitch on its staff that begins where it ends; a
// tied grace note runs into the note it leans on
for (const head of placed) {
    if (head.tied !== '1' && head.tied !== '0') continue;
    const target = placed
        .filter(
            (other) =>
                other !== head &&
                other.midi === head.midi &&
                other.staff === head.staff &&
                !other.grace &&
                Math.abs(other.at - (head.grace ? head.at : head.at + head.duration)) < 1e-9 &&
                (head.grace || other.tied === '-1' || other.tied === '0'),
        )
        .sort((a, b) => Number(a.voice !== head.voice) - Number(b.voice !== head.voice))[0];
    if (!target) continue;
    const measureIndex = order.findIndex(({ mc, pass }) => head.id === `n${String(mc)}-${head.staff}-${head.voice}-${head.chord}-${String(head.midi)}${pass === 2 ? '-rend2' : ''}`);
    ties[Math.max(0, measureIndex)].push(`<tie startid="#${head.id}" endid="#${target.id}"/>`);
}

const first = measures[0];
const [count, unit] = first.timesig.split('/');
const mei = `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1">
  <meiHead>
    <fileDesc>
      <titleStmt><title/></titleStmt>
      <pubStmt/>
      <sourceDesc><source><bibl>Notes, values, voices, ties and grace notes from the note table of the DCML corpus (Hentschel, Rammos, Neuwirth, Moss and Rohrmeier 2024), CC BY-NC-SA 4.0. Repeats written out.</bibl></source></sourceDesc>
    </fileDesc>
  </meiHead>
  <music><body><mdiv><score>
    <scoreDef meter.count="${count}" meter.unit="${unit}" keysig="${first.keysig === 0 ? '0' : `${String(Math.abs(first.keysig))}${first.keysig < 0 ? 'f' : 's'}`}">
      <staffGrp symbol="brace" bar.thru="true">
        <staffDef n="1" lines="5" clef.shape="G" clef.line="2"/>
        <staffDef n="2" lines="5" clef.shape="F" clef.line="4"/>
      </staffGrp>
    </scoreDef>
    <section>
${body.map((xml, index) => `      ${xml}${ties[index].join('')}</measure>`).join('\n')}
    </section>
  </score></mdiv></body></music>
</mei>
`;
writeFileSync(outFile, mei);

console.log(
    `${String(order.length)} bars, ${String(placed.length)} notes, ${String(ties.flat().length)} ties, ` +
        `${String(placed.filter((head) => head.grace).length)} grace notes`,
);
