/**
 * The line a pianist hums along, read at build time from a checkout of welte225.org.
 *
 * `hummed/reduction/reduction.mei` is one bass staff of single notes and rests, each note naming
 * (`@corresp`) the piano note it follows. It is read as the site reads it
 * (`hummed/src/reduction/mei.ts`): 720 ticks to the quarter on the score's own axis, the upbeat a
 * quarter long whatever it holds, a tie continuing its note, a rest extending the rest before it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** A sung note in ticks; `ref` is the id of the piano note it takes its onset and dynamics from. */
export interface SungNote {
  id: string;
  ref: string | null;
  pitch: number;
  from: number;
  to: number;
  /** `@type="pedal"`: held on while the piano moves, so it ends as written, not with the key. */
  pedal?: true;
}

export interface Reduction {
  notes: SungNote[];
  rests: { from: number; to: number }[];
}

const QUARTER = 720;
const EVENTS = new Set(['note', 'rest', 'mRest', 'space']);
const STEPS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const ACCIDENTALS: Record<string, number> = { s: 1, f: -1, ss: 2, x: 2, ff: -2, n: 0 };
const FLATS = 'beadgcf';
const SHARPS = 'fcgdaeb';

/** In the checkout, which is found as `src/test/published.ts` finds it. */
const reductionPath = resolve(process.env['WELTE225'] ?? '../welte225.org', 'hummed/reduction/reduction.mei');

/** The pitch names the key signature alters, and by how much (`keysig="1f"`: b flat). */
const keySignature = (score: Element): Map<string, number> => {
  const [, count, kind] = /^(\d)([fs])$/.exec(score.querySelector('scoreDef')?.getAttribute('keysig') ?? '') ?? [];
  const order = kind === 'f' ? FLATS : SHARPS;
  return new Map([...order.slice(0, Number(count ?? 0))].map((name) => [name, kind === 'f' ? -1 : 1]));
};

const midiPitch = (note: Element, key: Map<string, number>): number => {
  const name = note.getAttribute('pname') ?? '';
  const step = STEPS[name];
  if (step === undefined) throw new Error(`the reduction has a note without a pitch name: ${note.outerHTML}`);
  // An accidental is on the note or on an `<accid>` in it, written or only sounding; else the key decides.
  const sign = note.querySelector('accid');
  const accidental =
    note.getAttribute('accid') ?? note.getAttribute('accid.ges') ?? sign?.getAttribute('accid') ?? sign?.getAttribute('accid.ges');
  const alter = typeof accidental === 'string' ? (ACCIDENTALS[accidental] ?? 0) : (key.get(name) ?? 0);
  return 12 * (Number(note.getAttribute('oct')) + 1) + step + alter;
};

/** A note's or rest's length; each dot adds half of what the one before added. */
const lengthOf = (event: Element): number => {
  if (event.localName === 'mRest') return 4 * QUARTER;
  const dur = Number(event.getAttribute('dur'));
  if (![1, 2, 4, 8, 16, 32].includes(dur)) throw new Error(`the reduction has an unsupported length: ${event.outerHTML}`);
  const base = (4 * QUARTER) / dur;
  const dots = Number(event.getAttribute('dots') ?? 0);
  return 2 * base - base / 2 ** dots;
};

/** Reads the reduction from MEI. Needs a global `DOMParser`, which `build.ts` takes from jsdom. */
function parseReduction(mei: string): Reduction {
  const score = new DOMParser().parseFromString(mei, 'application/xml').querySelector('score');
  if (!score) throw new Error('the reduction holds no score');
  const key = keySignature(score);
  const notes: SungNote[] = [];
  const rests: Reduction['rests'] = [];
  let last: 'note' | 'rest' | undefined;
  let tick = 0;

  for (const measure of score.querySelectorAll('measure')) {
    if (measure.querySelector('chord, tuplet')) {
      throw new Error('the reduction holds a chord or a tuplet: the voice sings one note at a time');
    }
    // Not a selector list: jsdom returns the matches of one out of document order.
    for (const event of measure.querySelectorAll('*')) {
      if (!EVENTS.has(event.localName)) continue;
      const from = tick;
      tick += lengthOf(event);
      const type = event.getAttribute('type') ?? '';
      if (event.localName !== 'note' || type.startsWith('air')) {
        if (last === 'rest') rests[rests.length - 1].to = tick;
        else rests.push({ from, to: tick });
        last = 'rest';
      } else if (['m', 't'].includes(event.getAttribute('tie') ?? '')) {
        if (last !== 'note') throw new Error(`the reduction has a tie that continues no note: ${event.outerHTML}`);
        notes[notes.length - 1].to = tick;
      } else {
        const ref = event.getAttribute('corresp')?.split('#').pop() ?? null;
        const note: SungNote = { id: event.getAttribute('xml:id') ?? '', ref, pitch: midiPitch(event, key), from, to: tick };
        if (type === 'pedal') note.pedal = true;
        notes.push(note);
        last = 'note';
      }
    }
    if ((measure.getAttribute('label') ?? measure.getAttribute('n')) === '0') tick = QUARTER;
  }
  return { notes, rests };
}

/** The reduction of the checkout of welte225.org, or `undefined` where that has none. */
export const readReduction = (path = reductionPath): Reduction | undefined =>
  existsSync(path) ? parseReduction(readFileSync(path, 'utf-8')) : undefined;
