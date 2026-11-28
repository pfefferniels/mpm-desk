/* How much of the music around a passage has to be played for the passage to be understood. */

/** Never more context than this to either side, in beats. */
const MOST_BEATS = 2;

/**
 * The stretch of the score to play for a passage, with what is needed around it to hear what a
 * remark says of it. All positions are ticks of the score; a chord is every note on one date.
 *
 * - Always the chord before, to measure against, and the chord after: the time a note takes is
 *   only heard when the next one comes.
 * - A pulse (tempo, rubato, a rolled chord against its beat) needs an interval before it began
 *   and one after it ended: back to the beat before the passage's first, on through a second chord.
 * - Touch (legato, detached, held over) and anything said of single notes is between a note and
 *   its neighbours in the same hand: the note before and the note after in that hand, where
 *   there is one within reach.
 * - An accent pattern is heard over its whole bar; the pedal over the beat either side.
 *
 * @param {object} score
 * @param {number[]} score.dates every date a note begins on, ascending
 * @param {number[]} score.beats every beat, ascending
 * @param {number[]} score.bars every bar's first tick, ascending
 * @param {{ id: string, date: number, part: number }[]} score.notes
 * @param {{ from: number, to: number, ids?: string[], kind: string }} scope `to` is exclusive
 * @param {Set<string>} about what the remark wrote: tempo, rubato, dynamics, roll, touch, accent, pedal
 * @param {string[]} [touched] the notes whose touch the remark is about, where it names them
 * @returns {{ from: number, to: number }} both inclusive: the first and the last date to play
 */
export function contextOf({ dates, beats, bars, notes }, scope, about, touched = []) {
  const inside = dates.filter((date) => date >= scope.from && date < scope.to);
  const first = inside[0] ?? scope.from;
  const last = inside.at(-1) ?? scope.from;
  const chordBefore = (date, count = 1) => dates.filter((other) => other < date).at(-count) ?? dates[0];
  const chordAfter = (date, count = 1) => dates.filter((other) => other > date)[count - 1] ?? dates.at(-1);
  const atOrBefore = (grid, date) => grid.filter((mark) => mark <= date).at(-1) ?? grid[0];
  const after = (grid, date) => grid.find((mark) => mark > date) ?? grid.at(-1);
  const beat = (beats[1] ?? 720) - (beats[0] ?? 0);

  let from = chordBefore(first);
  let to = chordAfter(last);

  if (about.has('tempo') || about.has('rubato') || about.has('roll')) {
    from = Math.min(from, atOrBefore(beats, atOrBefore(beats, first) - 1), chordBefore(first, 2));
    to = Math.max(to, Math.min(chordAfter(last, 2), to + 1.5 * beat));
  }
  const named = scope.kind === 'notes' || scope.kind === 'box';
  const own = new Set(touched.length ? touched : named ? scope.ids : []);
  if (own.size || about.has('touch')) {
    const mine = notes.filter((note) => (own.size ? own.has(note.id) : note.date >= scope.from && note.date < scope.to));
    for (const part of new Set(mine.map((note) => note.part))) {
      const line = notes.filter((note) => note.part === part).map((note) => note.date);
      const reach = mine.filter((note) => note.part === part).map((note) => note.date);
      from = Math.min(from, line.filter((date) => date < Math.min(...reach)).at(-1) ?? from);
      to = Math.max(to, line.find((date) => date > Math.max(...reach)) ?? to);
    }
  }
  if (about.has('accent')) {
    from = Math.min(from, atOrBefore(bars, first));
    to = Math.max(to, after(bars, last));
  }
  if (about.has('pedal')) {
    from = Math.min(from, atOrBefore(beats, first - 1));
    to = Math.max(to, after(beats, last));
  }
  return { from: Math.max(from, first - MOST_BEATS * beat, dates[0]), to: Math.min(to, last + MOST_BEATS * beat, dates.at(-1)) };
}
