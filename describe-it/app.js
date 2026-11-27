/* DescribeIt page script: draws the piano roll, manages annotations and asks the model to
   translate them into calls. The fitting itself runs in `engine.js`. */
/* global window, document, console, localStorage, fetch, navigator, performance, Worker, AbortController, ResizeObserver, getComputedStyle, getSelection, matchMedia, requestAnimationFrame, setTimeout, clearTimeout */
import { createPlayer } from './player.js';

(() => {

  const PPQ = 720;
  const STORE = 'describeit.v2';
  const EXPERT = { model: 'claude-opus-5-5', modelTier: 'complex' };
  const LANE = 22;
  /** Room kept above the highest key, inside the roll: for words over its notes, and a brace over those. */
  const HEAD = 62;
  const BRACE = 9;
  const RULER = 18;
  /** The room the line round a set of notes leaves them. */
  const HULL = 14;
  /** The pedals, each in a row of this height under the keys. */
  const PEDAL = 9;
  const PEDALS = [
    ['sustain', 'Ped'],
    ['soft', 'u.c.'],
  ];

  const $ = (selector) => document.querySelector(selector);
  const el = (tag, props, ...kids) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'style') node.setAttribute('style', value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, value);
    }
    for (const kid of kids.flat()) {
      if (kid === undefined || kid === null || kid === false) continue;
      node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return node;
  };
  const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), Math.max(lo, hi));

  // ------------------------------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------------------------------

  const S = {
    piece: null,
    score: new Map(), // id -> the note as the alignment has it
    firstMs: 0,
    bars: [],
    base: null, // the run with nothing described
    result: null, // the run as it stands
    anns: [],
    selection: new Set(),
    selKind: 'none', // none (the whole piece) | notes | span | box | arrow
    pen: { open: false, editing: null },
    level: 64, // the velocity drawn one row tall
    view: { ppt: 0.03, shadows: true, pencil: false, height: 1 },
    play: { on: false, source: 'played', at: 0, loading: null }, // what is heard, and where the playing would begin
    hoverAnn: null,
    hoverNote: null,
    openAnn: null,
    reference: false,
    refCalls: null,
    sample: null,
    sampleAsked: false,
    tools: false,
    downloads: null,
    knowledge: '',
    fitting: false,
    queue: [],
    working: null,
    undo: null,
    notice: null,
    tween: null,
  };

  // ------------------------------------------------------------------------------------------
  // The engine: a worker, or the same file on this thread where a worker cannot start
  // ------------------------------------------------------------------------------------------

  const Engine = (() => {
    let worker = null;
    let direct = null;
    let sequence = 0;
    const waiting = new Map();
    let ready = null;

    const viaWorker = () =>
      new Promise((resolve, reject) => {
        let settled = false;
        try {
          worker = new Worker('engine.js');
        } catch (error) {
          reject(error);
          return;
        }
        worker.onmessage = (event) => {
          const reply = event.data;
          const entry = waiting.get(reply.requestId);
          if (!entry) return;
          waiting.delete(reply.requestId);
          if (reply.type === 'error') entry.reject(new Error(reply.message));
          else entry.resolve(reply);
        };
        worker.onerror = (event) => {
          if (!settled) {
            settled = true;
            worker = null;
            reject(new Error(event.message || 'the engine did not start'));
          }
        };
        // A worker that cannot load says so through `onerror`; one that can answers this.
        const requestId = ++sequence;
        waiting.set(requestId, {
          resolve: () => {
            settled = true;
            resolve();
          },
          reject,
        });
        worker.postMessage({ type: 'load', requestId, piece: S.piece });
      });

    const viaScript = () =>
      new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'engine.js';
        script.onload = () => {
          direct = window.DescribeItEngine;
          if (!direct) {
            reject(new Error('the engine did not load'));
            return;
          }
          direct.load(S.piece);
          resolve();
        };
        script.onerror = () => reject(new Error('the engine did not load'));
        document.head.append(script);
      });

    const start = () => {
      ready = ready || viaWorker().catch(() => viaScript());
      return ready;
    };

    const run = async (calls) => {
      await start();
      if (worker) {
        return new Promise((resolve, reject) => {
          const requestId = ++sequence;
          waiting.set(requestId, { resolve: (reply) => resolve(reply.result), reject });
          worker.postMessage({ type: 'run', requestId, calls });
        });
      }
      await new Promise((r) => setTimeout(r, 20));
      return direct.run(calls);
    };

    return { start, run };
  })();

  // ------------------------------------------------------------------------------------------
  // The score's bars
  // ------------------------------------------------------------------------------------------

  const buildBars = (signatures, end) => {
    const bars = [];
    const list = signatures.length ? signatures : [{ date: 0, numerator: 4, denominator: 4 }];
    // An opening signature shorter than the bar that follows it is an upbeat, and counts as 0.
    const lengthOf = (s) => (s.numerator * PPQ * 4) / s.denominator;
    const upbeat = list.length > 1 && list[1].date - list[0].date < lengthOf(list[1]);
    let number = upbeat ? 0 : 1;
    list.forEach((signature, index) => {
      const until = index + 1 < list.length ? list[index + 1].date : end;
      const length = lengthOf(signature);
      for (let from = signature.date; from < until - 1e-6; from += length) {
        bars.push({ n: number++, from, to: Math.min(from + length, until), beat: (PPQ * 4) / signature.denominator });
      }
    });
    return bars;
  };

  const barAt = (tick) => {
    const bars = S.bars;
    for (let i = bars.length - 1; i >= 0; i--) if (tick >= bars[i].from - 1e-6) return bars[i];
    return bars[0];
  };
  const beatOf = (tick) => {
    const bar = barAt(tick);
    const beat = Math.round((1 + (tick - bar.from) / bar.beat) * 100) / 100;
    return { bar: bar.n, beat: Number.isInteger(beat) ? String(beat) : beat.toFixed(2).replace(/0+$/, '') };
  };
  /** A place in the score, compactly: bar, colon, beat. */
  const place = (tick) => {
    if (!S.bars.length) return '';
    const { bar, beat } = beatOf(tick);
    return `${bar}:${beat}`;
  };
  /** The same as a musician says it. */
  const where = (tick) => {
    if (!S.bars.length) return '';
    const { bar, beat } = beatOf(tick);
    return beat === '1' ? `bar ${bar}` : `bar ${bar}, beat ${beat}`;
  };
  const span = (from, to) => {
    const a = barAt(from);
    const b = barAt(Math.max(from, to - 1));
    if (!a || !b) return '';
    if (from === a.from && to === b.to) return a.n === b.n ? `bar ${a.n}` : `bars ${a.n}–${b.n}`;
    return `${where(from)} to ${where(to)}`;
  };

  const NAMES = { c: 'C', d: 'D', e: 'E', f: 'F', g: 'G', a: 'A', b: 'B' };
  const pitchName = (note) => {
    const scored = S.score.get(note.id);
    const octave = Math.floor(note.pitch / 12) - 1;
    if (!scored) return `${note.pitch}`;
    const accidental = scored.accidentals > 0 ? '♯'.repeat(scored.accidentals) : '♭'.repeat(-scored.accidentals);
    return `${NAMES[scored.pitchname] || scored.pitchname}${accidental}${octave}`;
  };
  const hand = (part) => (part === 1 ? 'right hand' : 'left hand');

  // ------------------------------------------------------------------------------------------
  // The chain as it stands
  // ------------------------------------------------------------------------------------------

  /** The flat list the engine runs: each remark as a `Describe` step, then the calls it became. */
  const stepsOf = (anns) =>
    anns
      .filter((ann) => ann.enabled && ann.calls && ann.calls.length)
      .flatMap((ann) => {
        const calls = ann.calls.map((call, index) => ({ id: `${ann.id}:${index}`, name: call.name, options: call.options || {} }));
        const { kind, from, to, ids } = ann.scope;
        const notes = kind === 'piece' || kind === 'span' ? [] : ids;
        const options = { text: ann.text, scope: { kind, from, to, notes }, model: ann.model || null, date: ann.date || null, calls: calls.map((call) => call.id) };
        return [{ id: ann.id, name: 'Describe', options }, ...calls];
      });

  const reportOf = (ann, result) => {
    const reports = (result ? result.calls : []).filter((report) => report.id.startsWith(`${ann.id}:`));
    return {
      elements: reports.flatMap((r) => r.elements),
      written: reports.flatMap((r) => r.written || []),
      definitions: [...new Set(reports.flatMap((r) => r.definitions || []))],
      evidence: new Set(reports.flatMap((r) => r.evidence)),
      errors: reports.filter((r) => r.error).map((r) => ({ index: Number(r.id.split(':')[1]), message: r.error })),
      fitted: reports.flatMap((r) => r.fitted || []),
    };
  };

  let fitToken = 0;
  const refit = async () => {
    const token = ++fitToken;
    S.fitting = true;
    renderMeters();
    const calls = S.reference ? S.refCalls : stepsOf(S.anns);
    try {
      const result = await Engine.run(calls);
      if (token !== fitToken) return;
      if (S.result && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        S.tween = { from: new Map(S.result.notes.map((note) => [note.id, note.mpm])), beatDates: S.result.beatDates, beatMs: S.result.beatMs, start: performance.now(), t: 0 };
      }
      S.result = result;
      index(result);
      for (const ann of S.anns) ann.report = reportOf(ann, result);
      Player.refresh();
    } catch (error) {
      if (token !== fitToken) return;
      console.error(error);
    }
    S.fitting = false;
    renderAll();
  };

  // ------------------------------------------------------------------------------------------
  // Geometry of a run, and what it leaves
  // ------------------------------------------------------------------------------------------

  /** A value read off a line through points, carried on past either end at the slope it has there. */
  const along = (xs, ys, x) => {
    const last = xs.length - 1;
    if (last < 0) return x;
    if (last === 0) return ys[0];
    let lo = 0;
    let hi = last;
    if (x <= xs[0]) hi = 1;
    else if (x >= xs[last]) lo = last - 1;
    else {
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] <= x) lo = mid;
        else hi = mid;
      }
    }
    return ys[lo] + ((x - xs[lo]) / (xs[hi] - xs[lo])) * (ys[hi] - ys[lo]);
  };

  /** A run, made ready to be drawn: its notes by id, and its beats as a line from score to clock. */
  const index = (result) => {
    result.dates = [...new Set(result.notes.map((note) => note.date))].sort((a, b) => a - b);
    result.beatDates = result.beats.map((beat) => beat.date);
    result.beatMs = result.beats.map((beat) => beat.ms);
    result.total = result.notes.reduce((max, note) => Math.max(max, note.msEnd, note.mpm.msEnd), result.beatMs[result.beatMs.length - 1] || 0);
    result.byId = new Map(result.notes.map((note) => [note.id, note]));
  };

  /**
   * When the tempo as it stands has a date of the score, on the roll's clock: on its way there,
   * for a moment after a run. The bar lines stand on it, and so does a bracket over a stretch,
   * which goes with the notes it was drawn over.
   */
  const encodedAt = (result, date) => {
    const now = along(result.beatDates, result.beatMs, date);
    if (!S.tween) return now;
    const was = along(S.tween.beatDates, S.tween.beatMs, date);
    return was + (now - was) * S.tween.t;
  };

  const assumedAt = (result, date) => result.assumed.tempo.some((s) => date >= s.from && date < s.to);

  /**
   * What is left, as four root mean squares: where the chords stand against the grid, how far
   * the notes of a chord stand from one another, the velocities, and the lengths.
   */
  const leftIn = (result, ids) => {
    const wanted = ids && ids.length ? new Set(ids) : null;
    const notes = wanted ? result.notes.filter((note) => wanted.has(note.id)) : result.notes;
    const chords = new Map();
    for (const note of notes) {
      const chord = chords.get(note.date);
      if (chord) chord.push(note.late);
      else chords.set(note.date, [note.late]);
    }
    const means = new Map([...chords].map(([date, lates]) => [date, lates.reduce((a, b) => a + b, 0) / lates.length]));
    const rms = (values) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / Math.max(1, values.length));
    return {
      notes: notes.length,
      pulse: rms([...means.values()]),
      chords: rms(notes.map((note) => note.late - means.get(note.date))),
      loud: rms(notes.map((note) => note.loud)),
      length: rms(notes.map((note) => note.longMs)),
    };
  };
  /** The same four, under the names the expert is told. */
  const measures = (left) => ({
    notes: left.notes,
    pulse_ms: +left.pulse.toFixed(1),
    spread_ms: +left.chords.toFixed(1),
    velocity: +left.loud.toFixed(2),
    length_ms: +left.length.toFixed(0),
  });
  /** Whether a scope is a passage, every note of it, rather than a set of notes. */
  const passes = (scope) => scope.kind === 'span' || scope.kind === 'arrow';
  /** The notes a remark is about, which is where its effect is measured. */
  const idsOf = (scope) => {
    if (scope.kind === 'piece') return [];
    if (passes(scope)) return S.base.notes.filter((note) => note.date >= scope.from && note.date < scope.to).map((note) => note.id);
    return scope.ids;
  };

  // ------------------------------------------------------------------------------------------
  // The roll
  // ------------------------------------------------------------------------------------------

  const canvas = $('#roll');
  const scroller = $('#rollScroll');
  const spacer = $('#rollSpacer');
  const tip = $('#tip');
  const pen = $('#pen');
  const penText = $('#penText');
  const pop = $('#pop');
  const ctx = canvas.getContext('2d');
  const G = { gutter: 34, lanes: 1, top: 50, bottom: 8, width: 0, height: 0, rowH: 8, lo: 36, hi: 84, perOctave: 4, rects: [], marks: [], pedals: [], penAt: null, promptRow: null };
  let palette = {};

  const readPalette = () => {
    const style = getComputedStyle(document.documentElement);
    const get = (name) => style.getPropertyValue(name).trim();
    palette = {
      roll: get('--roll'), grid: get('--grid'), ink: get('--ink'), ink2: get('--ink-2'), ink3: get('--ink-3'),
      rh: get('--rh'), lh: get('--lh'), grace: get('--grace'), ghost: get('--ghost'), pencil: get('--pencil'), raised: get('--raised'), line: get('--line'),
      accent: get('--accent'), bad: get('--bad'), apart: get('--apart'),
      font: get('--font') || 'sans-serif', mono: get('--mono') || 'monospace', serif: get('--serif') || 'serif',
    };
  };

  const resize = () => {
    const ratio = window.devicePixelRatio || 1;
    G.width = scroller.clientWidth;
    G.height = scroller.clientHeight;
    canvas.style.width = `${G.width}px`;
    canvas.style.height = `${G.height}px`;
    canvas.width = Math.max(1, Math.round(G.width * ratio));
    canvas.height = Math.max(1, Math.round(G.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    layout();
    draw();
    if (S.openAnn) placePop();
  };

  const layout = () => {
    if (!S.result) return;
    spacer.style.width = `${Math.ceil(G.gutter + S.result.total * S.view.ppt + 60)}px`;
    G.top = G.lanes * LANE + RULER + 6;
    const { played, mpm } = S.result.pedals;
    G.pedals = PEDALS.filter(([kind]) => played.some((press) => press.kind === kind) || mpm.some((move) => move.kind === kind));
    G.bottom = 8 + G.pedals.length * (PEDAL + 4);
    G.rowH = Math.max(3, (G.height - G.top - HEAD - G.bottom) / (G.hi - G.lo + 1));
  };

  // The roll is laid out on the recording's clock: `ppt` is pixels to the millisecond.
  const X = (ms) => G.gutter + ms * S.view.ppt - scroller.scrollLeft;
  const msOf = (px) => (px - G.gutter + scroller.scrollLeft) / S.view.ppt;
  const Y = (pitch) => G.top + HEAD + (G.hi - pitch + 0.5) * G.rowH;
  /**
   * How tall a velocity is drawn: one row at the level, and from there by the logarithm of the
   * velocity, so many rows to the doubling. Twice as loud is then always as much taller, and a
   * loud note stands out of its track without swallowing the ones beside it.
   */
  const tall = (velocity) => G.rowH * clamp(1 + S.view.height * G.perOctave * Math.log2(Math.max(velocity, 1) / S.level), 0.3, 6);
  /**
   * A note as the MPM as it stands sounds it, which is the note the roll draws solid: it is what
   * a reader is shaping. Where the run has it, or, for a moment after a run, on its way there
   * from where the run before had it, so that what a remark did is seen as the notes going to
   * their shadows, or failing to.
   */
  const rectOf = (note) => {
    const from = S.tween ? S.tween.from.get(note.id) : null;
    const t = S.tween ? S.tween.t : 1;
    const mix = (key) => (from ? from[key] + (note.mpm[key] - from[key]) * t : note.mpm[key]);
    const h = tall(mix('velocity'));
    return { x: X(mix('ms')), y: Y(note.pitch) - h / 2, w: Math.max(2, (mix('msEnd') - mix('ms')) * S.view.ppt), h };
  };
  /** The same note as it was played: its shadow, which stays where it is. */
  const shadowOf = (note, played = note) => {
    const h = tall(played.velocity);
    return { x: X(played.ms), y: Y(note.pitch) - h / 2, w: Math.max(2, (played.msEnd - played.ms) * S.view.ppt), h };
  };
  const rounded = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  };
  const hasTrouble = (ann) => Boolean(ann.failure || (ann.report && ann.report.errors.length));
  const shown = (text) => (text.length > 64 ? `${text.slice(0, 62)}…` : text.replace(/\s+/g, ' '));
  const wordsFont = () => `500 14.5px ${palette.serif}`;

  /**
   * A remark as it stands on the roll: the reader's words, and how it fared. Among the notes it
   * is given a pale ground to be read against.
   */
  const drawLabel = (ann, x, y, ground) => {
    const text = shown(ann.text);
    ctx.font = wordsFont();
    ctx.textBaseline = 'middle';
    const width = ctx.measureText(text).width;
    const pending = ann.status === 'pending' || S.queue.some((entry) => entry.ann === ann);
    const lit = S.hoverAnn === ann || S.openAnn === ann;
    const badge = pending ? null : ann.question ? '?' : hasTrouble(ann) ? '!' : null;
    const extra = badge ? 20 : 0;
    if (ground) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.76)';
      rounded(x - 4, y - 10, width + extra + 8, 20, 3);
      ctx.fill();
    }
    ctx.globalAlpha = S.reference ? 0.35 : pending ? 0.45 + 0.3 * Math.sin(performance.now() / 260) : 1;
    ctx.fillStyle = ann.enabled ? palette.ink : palette.ink3;
    ctx.fillText(text, x, y + 0.5);
    if (!ann.enabled || lit) {
      // Struck through where it is muted, underlined where it is pointed at.
      const at = ann.enabled ? y + 9.5 : y + 1;
      ctx.strokeStyle = ann.enabled ? palette.ink : palette.ink3;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, at);
      ctx.lineTo(x + width, at);
      ctx.stroke();
    }
    if (badge) {
      const cx = x + width + 11;
      ctx.globalAlpha = 1;
      ctx.fillStyle = badge === '?' ? palette.accent : palette.bad;
      ctx.beginPath();
      ctx.arc(cx, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `600 10.5px ${palette.font}`;
      ctx.textAlign = 'center';
      ctx.fillText(badge, cx, y + 0.5);
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;
    G.marks.push({ ann, x: x - 4, y: y - 10, w: width + extra + 8, h: 20 });
    return width + extra;
  };

  const widthOfLabel = (ann) => {
    ctx.font = wordsFont();
    return ctx.measureText(shown(ann.text)).width + (ann.question || hasTrouble(ann) ? 20 : 0);
  };

  /** A brace over a stretch: its two feet down on what it holds, its point up at what is said of it. */
  const braceOver = (x0, x1, y) => {
    const mid = (x0 + x1) / 2;
    const q = Math.min(BRACE, (x1 - x0) / 4);
    const half = y - BRACE / 2;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.quadraticCurveTo(x0, half, x0 + q, half);
    ctx.lineTo(mid - q, half);
    ctx.quadraticCurveTo(mid, half, mid, y - BRACE);
    ctx.quadraticCurveTo(mid, half, mid + q, half);
    ctx.lineTo(x1 - q, half);
    ctx.quadraticCurveTo(x1, half, x1, y);
    ctx.stroke();
  };

  /** An arrow from one point to another, bowed so that its middle passes through `apex`. */
  const arrowOver = (from, to, apex) => {
    const control = { x: (from.x + to.x) / 2, y: 2 * apex - (from.y + to.y) / 2 };
    const angle = Math.atan2(to.y - control.y, to.x - control.x);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
    for (const turn of [-0.45, 0.45]) {
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - 9 * Math.cos(angle + turn), to.y - 9 * Math.sin(angle + turn));
    }
    ctx.stroke();
  };

  /**
   * The line round a set of notes: over the tops of the notes from the first to the last and back
   * under them, straight across wherever no note of the set sounds. It is hollow where the set
   * is, so a melody that climbs and falls is followed up and down and what lies above or below it
   * is left outside. But it is drawn with a free hand: it leaves the notes room, passes over any
   * dip it would have to squeeze into, and takes every turn in a wide curve.
   *
   * Worked out in steps along the roll, between `from` and `to`, which is as much of it as can
   * be seen.
   *
   * @param rects the notes, as they are drawn
   * @returns the points of the line, in order round it
   */
  const hullOf = (rects, from, to) => {
    const STEP = 4;
    const NEAR = 8; // the least room it leaves a note, where it has to turn in
    const WIDE = 10; // steps: a dip narrower than twice this is passed over
    const ROUND = 6; // steps: how wide a turn is taken
    const left = Math.max(from, Math.min(...rects.map((r) => r.x)) - HULL);
    const right = Math.min(to, Math.max(...rects.map((r) => r.x + r.w)) + HULL);
    const n = Math.max(2, Math.ceil((right - left) / STEP) + 1);
    const column = () => new Array(n).fill(null);
    const [top, bottom, topMost, bottomMost] = [column(), column(), column(), column()];
    for (const r of rects) {
      const a = Math.max(0, Math.floor((r.x - HULL - left) / STEP));
      const b = Math.min(n - 1, Math.ceil((r.x + r.w + HULL - left) / STEP));
      for (let i = a; i <= b; i++) {
        top[i] = Math.min(top[i] ?? Infinity, r.y - HULL);
        bottom[i] = Math.max(bottom[i] ?? -Infinity, r.y + r.h + HULL);
        const x = left + i * STEP;
        if (x < r.x - NEAR || x > r.x + r.w + NEAR) continue;
        topMost[i] = Math.min(topMost[i] ?? Infinity, r.y - NEAR);
        bottomMost[i] = Math.max(bottomMost[i] ?? -Infinity, r.y + r.h + NEAR);
      }
    }
    // Across a silence: straight from the note before it to the note after.
    const bridge = (values) => {
      let before = -1;
      for (let i = 0; i < n; i++) {
        if (values[i] === null) continue;
        for (let j = before + 1; j < i; j++) {
          values[j] = before < 0 ? values[i] : values[before] + ((values[i] - values[before]) * (j - before)) / (i - before);
        }
        before = i;
      }
      for (let j = before + 1; j < n; j++) values[j] = before < 0 ? 0 : values[before];
    };
    bridge(top);
    bridge(bottom);
    const sliding = (values, radius, pick) => values.map((_, i) => pick(...values.slice(Math.max(0, i - radius), i + radius + 1)));
    const mean = (...values) => values.reduce((a, b) => a + b, 0) / values.length;
    // The dips are passed over, the turns rounded twice, and the line is then held off the notes
    // it has come too near, which is rounded once more.
    const eased = (values, out, back, keep) => {
      let line = sliding(sliding(values, WIDE, out), WIDE, back);
      line = sliding(sliding(line, ROUND, mean), ROUND, mean).map(keep);
      return sliding(line, 2, mean).map(keep);
    };
    const offTop = (y, i) => Math.min(y, topMost[i] ?? Infinity);
    const offBottom = (y, i) => Math.max(y, bottomMost[i] ?? -Infinity);
    const over = eased(top, Math.min, Math.max, offTop);
    const under = eased(bottom, Math.max, Math.min, offBottom);
    // Either end is closed in a round, as wide a one as its height and its notes allow.
    const END = 26;
    const close = (i, d) => {
      const radius = Math.min((under[i] - over[i]) / 2, END);
      if (d >= radius) return;
      const inset = radius - Math.sqrt(radius * radius - (radius - d) ** 2);
      over[i] = offTop(over[i] + inset, i);
      under[i] = offBottom(under[i] - inset, i);
    };
    for (let k = 0; k * STEP < END && k < n / 2 - 1; k++) {
      close(k, k * STEP);
      close(n - 1 - k, k * STEP);
    }
    const points = over.map((y, i) => ({ x: left + i * STEP, y }));
    for (let i = n - 1; i >= 0; i--) points.push({ x: left + i * STEP, y: under[i] });
    return points;
  };

  /** A closed line through some points, bent at each so that it has no corners. */
  const softLine = (points) => {
    const n = points.length;
    if (n < 3) return;
    const between = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const start = between(points[n - 1], points[0]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (let i = 0; i < n; i++) {
      const to = between(points[i], points[(i + 1) % n]);
      ctx.quadraticCurveTo(points[i].x, points[i].y, to.x, to.y);
    }
    ctx.closePath();
  };

  /**
   * What was said of the whole piece is written along the top, one remark after the other, and
   * stays in view however the roll is scrolled. Everything else stands in the roll, over what
   * it is about.
   */
  const lanesOf = () => {
    const whole = [];
    let x = G.gutter + 8;
    let row = 0;
    for (const ann of S.anns) {
      if (ann.scope.kind !== 'piece') continue;
      const w = widthOfLabel(ann);
      if (x + w > G.width - 8 && x > G.gutter + 8) {
        row++;
        x = G.gutter + 8;
      }
      whole.push({ ann, x, row });
      x += w + 26;
    }
    return { whole, rows: whole.length ? row + 1 : 0 };
  };

  let frame = 0;
  const draw = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  };

  const paint = () => {
    const result = S.result;
    if (S.tween) {
      const elapsed = (performance.now() - S.tween.start) / 420;
      if (elapsed >= 1) S.tween = null;
      else S.tween.t = 1 - (1 - elapsed) ** 3;
    }
    const { width, height } = G;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = palette.roll;
    ctx.fillRect(0, 0, width, height);
    G.rects = [];
    G.marks = [];
    G.penAt = null;
    if (!result) return;

    // One row more than the remarks need: where the next one is written.
    const lanes = lanesOf();
    const wanted = Math.min(lanes.rows + 1, 6);
    if (wanted !== G.lanes) {
      G.lanes = wanted;
      layout();
    }
    const top = G.top;
    const bottom = height - G.bottom;
    const editing = S.pen.editing;
    const draft = S.pen.open && !editing ? scopeNow() : null;

    // The keys, plain: a faint line under every C is all that tells them apart.
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6;
    for (let pitch = G.lo; pitch <= G.hi; pitch++) {
      if (pitch % 12 !== 0) continue;
      const y = Math.round(Y(pitch) + G.rowH / 2) + 0.5;
      ctx.beginPath();
      ctx.moveTo(G.gutter, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // The stretch a bracket being written is over, tinted down the whole roll.
    if (draft && draft.kind === 'span') {
      const a = Math.max(G.gutter, X(encodedAt(result, draft.from)));
      const b = Math.min(width, X(encodedAt(result, draft.to)));
      if (b > a) {
        ctx.fillStyle = palette.pencil;
        ctx.globalAlpha = 0.05;
        ctx.fillRect(a, top, b - a, bottom - top);
        ctx.globalAlpha = 1;
      }
    }

    // The bars, where the tempo as it stands has them on the recording's clock: the encoding's
    // own ruler, which a remark about the tempo moves under the notes. Dashed where the tempo is
    // only assumed.
    const bars = [];
    for (const bar of S.bars) {
      const assumed = assumedAt(result, bar.from);
      const x = X(encodedAt(result, bar.from));
      bars.push({ bar, x, assumed });
      const beatPx = ((X(encodedAt(result, bar.to)) - x) * bar.beat) / (bar.to - bar.from);
      if (!assumed && beatPx > 9) {
        ctx.strokeStyle = palette.grid;
        ctx.globalAlpha = 0.9;
        for (let beat = bar.from + bar.beat; beat < bar.to - 1; beat += bar.beat) {
          const bx = Math.round(X(encodedAt(result, beat))) + 0.5;
          if (bx < G.gutter || bx > width) continue;
          ctx.beginPath();
          ctx.moveTo(bx, top);
          ctx.lineTo(bx, bottom);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      if (x < G.gutter - 1 || x > width) continue;
      ctx.strokeStyle = assumed ? palette.ink3 : palette.ink2;
      ctx.globalAlpha = assumed ? 0.5 : 0.7;
      ctx.setLineDash(assumed ? [3, 4] : []);
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, top - 5);
      ctx.lineTo(Math.round(x) + 0.5, bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    const lit = S.hoverAnn || S.openAnn;
    const evidence = lit && lit.report && lit.report.evidence.size ? lit.report.evidence : lit ? new Set(idsOf(lit.scope)) : null;
    // While a remark is being written about some notes, the others stand back.
    const chosen = !lit && draft && draft.kind !== 'piece' ? (draft.kind === 'arrow' ? new Set(idsOf(draft)) : S.selection) : null;
    const dimmed = (id) => (evidence && evidence.size ? !evidence.has(id) : chosen ? !chosen.has(id) : false);
    const apart = (a, b) => Math.abs(a.x - b.x) >= 1.5 || Math.abs(a.h - b.h) >= 1 || Math.abs(a.x + a.w - b.x - b.w) >= 2.5;

    // Shadows: each note as it was played, in its hand's colour and faint, which stays where it
    // is. The solid note over it is what the MPM as it stands makes of it, and a shadow shows
    // wherever that is not yet the playing: beside its note where the tempo is off, taller than
    // it where a loudness is not accounted for, staggered under a chord not yet rolled. Where a
    // note covers its shadow there is nothing left to see.
    G.shades = [];
    if (S.view.shadows) {
      ctx.lineWidth = 1;
      for (const note of result.notes) {
        const was = shadowOf(note);
        if (was.x + was.w < G.gutter || was.x > width) continue;
        if (!apart(was, rectOf(note))) continue;
        const dim = dimmed(note.id);
        const hue = note.part === 1 ? palette.rh : palette.lh;
        ctx.fillStyle = hue;
        ctx.strokeStyle = hue;
        ctx.globalAlpha = dim ? 0.05 : 0.17;
        rounded(was.x, was.y, was.w, was.h, 2.5);
        ctx.fill();
        ctx.setLineDash([3, 2]);
        ctx.globalAlpha = dim ? 0.18 : 0.7;
        rounded(was.x + 0.5, was.y + 0.5, was.w - 1, was.h - 1, 2.5);
        ctx.stroke();
        ctx.setLineDash([]);
        G.shades.push({ note, ...was });
      }
      // What the roll itself had of a note the reader corrected, behind the shadow that now stands for it.
      ctx.strokeStyle = palette.ghost;
      ctx.setLineDash([1, 3]);
      for (const note of result.notes) {
        if (!note.arrived) continue;
        const was = shadowOf(note, note.arrived);
        if (was.x + was.w < G.gutter || was.x > width) continue;
        ctx.globalAlpha = dimmed(note.id) ? 0.15 : 0.6;
        rounded(was.x + 0.5, was.y + 0.5, was.w - 1, was.h - 1, 2.5);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // The notes as the MPM has them. Louder ones underneath, so that a soft one over a loud one
    // can still be seen and picked.
    for (const note of [...result.notes].sort((a, b) => b.mpm.velocity - a.mpm.velocity)) {
      const r = rectOf(note);
      if (r.x + r.w < G.gutter || r.x > width) continue;
      const dim = dimmed(note.id);
      ctx.globalAlpha = dim ? (chosen ? 0.3 : 0.16) : 0.78;
      ctx.fillStyle = note.part === 1 ? palette.rh : palette.lh;
      rounded(r.x, r.y, r.w, r.h, 2.5);
      ctx.fill();
      // The onset, a darker edge: what makes a chord read as lined up, or not.
      ctx.globalAlpha = dim ? (chosen ? 0.4 : 0.2) : 0.95;
      ctx.fillRect(r.x, r.y, Math.min(2, r.w), r.h);
      G.rects.push({ note, ...r });
    }
    ctx.globalAlpha = 1;

    // The note under the pointer, tied to its shadow: which of the shadows is this note's is
    // not always plain, least of all where nothing has been described and they are bars apart.
    const pointed = S.hoverNote ? result.byId.get(S.hoverNote) : null;
    if (pointed && S.view.shadows) {
      const now = rectOf(pointed);
      const was = shadowOf(pointed);
      const y = Math.round(Y(pointed.pitch)) + 0.5;
      ctx.strokeStyle = palette.apart;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(now.x, y);
      ctx.lineTo(was.x, y);
      ctx.stroke();
      rounded(was.x + 0.5, was.y + 0.5, was.w - 1, was.h - 1, 2.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
    }

    // The pedals, under the keys: a press as it was recorded is a shadow, what the MPM moves is solid.
    const pedalY = (row) => bottom + 6 + row * (PEDAL + 4);
    ctx.fillStyle = palette.pencil;
    ctx.strokeStyle = palette.pencil;
    G.pedals.forEach(([kind], row) => {
      const y = pedalY(row);
      if (S.view.shadows) {
        ctx.setLineDash([3, 2]);
        for (const press of result.pedals.played.filter((press) => press.kind === kind)) {
          const [xa, xb] = [X(press.ms), X(press.msEnd)];
          if (xb < G.gutter || xa > width) continue;
          ctx.globalAlpha = 0.1;
          ctx.fillRect(xa, y, xb - xa, PEDAL);
          ctx.globalAlpha = 0.6;
          ctx.strokeRect(xa + 0.5, y + 0.5, Math.max(1, xb - xa - 1), PEDAL - 1);
        }
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 0.8;
      const moves = result.pedals.mpm.filter((move) => move.kind === kind);
      moves.forEach((move, i) => {
        const depth = (move.value / 127) * PEDAL;
        const [xa, xb] = [X(move.ms), X(i + 1 < moves.length ? moves[i + 1].ms : result.total)];
        if (depth >= 0.5 && xb >= G.gutter && xa <= width && xb > xa) ctx.fillRect(xa, y + PEDAL - depth, xb - xa, depth);
      });
      ctx.globalAlpha = 1;
    });

    for (const grace of result.graces || []) {
      const x = X(grace.ms);
      if (x < G.gutter - 6 || x > width) continue;
      const y = Y(grace.pitch);
      ctx.fillStyle = palette.grace;
      ctx.globalAlpha = evidence ? 0.25 : 0.85;
      ctx.beginPath();
      ctx.moveTo(x, y - G.rowH * 0.7);
      ctx.lineTo(x + Math.max(5, G.rowH), y);
      ctx.lineTo(x, y + G.rowH * 0.7);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // What was said of a stretch, or of some notes, stands in the roll over what it is about. A
    // stretch is held in a brace as wide as it is, just above its highest note, with the words
    // at the brace's point. A set of notes has a line drawn round it that keeps to the notes,
    // and the words over it.
    const overhead = [];
    const topOf = (notes) => {
      let y = bottom;
      for (const note of notes) {
        y = Math.min(y, rectOf(note).y);
        if (S.view.shadows) y = Math.min(y, shadowOf(note).y);
      }
      return y;
    };
    /** As near above `y` as the remarks already placed leave room for, and inside the roll. */
    const clearOf = (xa, xb, y, room) => {
      for (let again = true, turns = 0; again && turns < 12; turns++) {
        again = false;
        for (const other of overhead) {
          if (other.xa < xb + 8 && other.xb > xa - 8 && y - room < other.bottom && y > other.top) {
            y = other.top - 4;
            again = true;
          }
        }
      }
      return Math.max(y, top + room - 10);
    };
    const pencil = (alpha) => {
      ctx.strokeStyle = palette.pencil;
      ctx.fillStyle = palette.pencil;
      ctx.lineWidth = 1.25;
      ctx.globalAlpha = alpha;
    };
    const seen = (xa, xb) => xb >= G.gutter && xa <= width;

    /** A stretch: a brace as wide as it is, just above its highest note or shadow. */
    const holdStretch = (scope, alpha) => {
      const notes = result.notes.filter((note) => note.date >= scope.from && note.date < scope.to);
      const xa = X(encodedAt(result, scope.from));
      const xb = Math.max(X(encodedAt(result, scope.to)), xa + 14);
      if (!notes.length || !seen(xa, xb)) return null;
      const y = clearOf(xa, xb, topOf(notes) - 5, BRACE + 24);
      pencil(alpha);
      braceOver(xa, xb, y);
      return { xa, xb, y, point: y - BRACE };
    };
    /** A set of notes: a line round them. */
    const holdSet = (scope, alpha) => {
      const rects = scope.ids.map((id) => result.byId.get(id)).filter(Boolean).map(rectOf);
      if (!rects.length) return null;
      const xa = Math.min(...rects.map((r) => r.x)) - HULL;
      const xb = Math.max(...rects.map((r) => r.x + r.w)) + HULL;
      if (!seen(xa, xb)) return null;
      pencil(alpha);
      softLine(hullOf(rects, G.gutter - 60, width + 60));
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.05;
      ctx.fill();
      const y = clearOf(xa, xb, Math.min(...rects.map((r) => r.y)) - HULL - 1, 24);
      return { xa, xb, y, point: y };
    };
    /** A direction: an arrow from its first note to its last, over what that hand plays between. */
    const holdArrow = (scope, alpha) => {
      const [first, last] = scope.ids.map((id) => result.byId.get(id));
      if (!first || !last) return null;
      const [a, b] = [rectOf(first), rectOf(last)];
      const from = { x: a.x + Math.min(a.w / 2, 5), y: a.y - 3 };
      const to = { x: Math.max(b.x + Math.min(b.w / 2, 3), from.x + 14), y: b.y - 4 };
      if (!seen(from.x, to.x)) return null;
      const between = result.notes.filter((note) => note.part === first.part && note.date > first.date && note.date < last.date).map((note) => rectOf(note).y);
      const apex = Math.min(from.y, to.y, ...between) - clamp((to.x - from.x) * 0.08, 8, 22);
      pencil(alpha);
      arrowOver(from, to, apex);
      const y = clearOf(from.x, to.x, apex - 2, 24);
      return { xa: from.x, xb: to.x, y, point: y };
    };
    /** Draw what holds a remark's notes together, and say where its words go. */
    const hold = (scope, alpha) => {
      const spot = scope.kind === 'span' ? holdStretch(scope, alpha) : scope.kind === 'arrow' ? holdArrow(scope, alpha) : holdSet(scope, alpha);
      ctx.globalAlpha = 1;
      return spot;
    };
    const wordsOver = (spot, w) => {
      const x = clamp((spot.xa + spot.xb) / 2 - w / 2, G.gutter + 6, width - w - 8);
      overhead.push({ xa: Math.min(spot.xa, x - 4), xb: Math.max(spot.xb, x + w + 4), top: spot.point - 22, bottom: spot.y });
      return { x, y: spot.point - 11 };
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(G.gutter, top - 4, width - G.gutter, height - top + 4);
    ctx.clip();
    if (!S.reference) {
      // The shorter the stretch, the nearer its notes its brace stands.
      const inRoll = S.anns.filter((ann) => ann.scope.kind !== 'piece').sort((a, b) => a.scope.to - a.scope.from - (b.scope.to - b.scope.from));
      for (const ann of inRoll) {
        const active = S.hoverAnn === ann || S.openAnn === ann;
        const spot = hold(ann.scope, !ann.enabled ? 0.35 : active ? 1 : 0.7);
        if (!spot) continue;
        const w = widthOfLabel(ann);
        const words = wordsOver(spot, w);
        G.marks.push({ ann, x: Math.max(spot.xa, G.gutter), y: spot.point - 1, w: Math.min(spot.xb, width) - Math.max(spot.xa, G.gutter), h: spot.y - spot.point + 3 });
        if (editing === ann) G.penAt = { x: words.x, y: spot.point - 2, grows: 'up' };
        else drawLabel(ann, words.x, words.y, true);
      }
    }
    if (draft && draft.kind !== 'piece') {
      const spot = hold(draft, 0.6);
      if (spot) G.penAt = { x: (spot.xa + spot.xb) / 2 - Math.max(75, pen.offsetWidth / 2), y: spot.point - 2, grows: 'up' };
    }
    if (drag && drag.kind === 'band' && drag.moved && drag.aim) {
      hold({ kind: 'arrow', ids: [drag.note, drag.aim].sort((a, b) => a.date - b.date).map((note) => note.id) }, 0.6);
    } else if (drag && drag.kind === 'band' && drag.moved) {
      const x = Math.min(drag.x0, drag.x1);
      const y = Math.min(drag.y0, drag.y1);
      const w = Math.abs(drag.x1 - drag.x0);
      ctx.strokeStyle = palette.pencil;
      if (drag.flat) {
        ctx.fillStyle = palette.pencil;
        ctx.globalAlpha = 0.06;
        ctx.fillRect(x, top, w, bottom - top);
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 1.25;
        if (w > 14) braceOver(x, x + w, Math.max(drag.y0 - 10, top + 12 + BRACE));
        ctx.globalAlpha = 1;
      } else {
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x + 0.5, y + 0.5, w, Math.abs(drag.y1 - drag.y0));
        ctx.setLineDash([]);
      }
    }
    ctx.restore();

    // Above the roll: what was said of the whole piece, and where the next such remark goes.
    ctx.fillStyle = palette.raised;
    ctx.fillRect(0, 0, width, top - 5);
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, top - 5.5);
    ctx.lineTo(width, top - 5.5);
    ctx.stroke();

    const rowY = (row) => 3 + row * LANE;
    for (const { ann, x, row } of lanes.whole) {
      if (row >= G.lanes) continue;
      if (editing === ann) G.penAt = { x, y: rowY(row) - 1, grows: 'down' };
      else drawLabel(ann, x, rowY(row) + 10, false);
    }
    const free = Math.min(lanes.rows, G.lanes - 1);
    G.promptRow = { y: rowY(free), h: LANE };
    if (draft && draft.kind === 'piece') {
      G.penAt = { x: G.gutter + 8, y: rowY(free) - 1, grows: 'down' };
    } else if (!S.pen.open && !S.reference) {
      ctx.font = `italic 400 14px ${palette.serif}`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = palette.ink3;
      ctx.fillText(S.anns.length ? 'write here about the whole piece…' : 'write here about the whole piece, or drag across the notes to hold a passage in a brace…', G.gutter + 8, rowY(free) + 10.5);
    }

    const rulerY = G.lanes * LANE + RULER / 2 + 2;
    ctx.font = `500 11px ${palette.mono}`;
    ctx.textBaseline = 'middle';
    let lastLabel = -Infinity;
    for (const { bar, x, assumed } of bars) {
      if (x < G.gutter - 2 || x > width || x - lastLabel < 26) continue;
      lastLabel = x;
      ctx.fillStyle = assumed ? palette.ink3 : palette.ink;
      ctx.fillText(String(bar.n), x + 4, rulerY);
    }
    // The stretches whose tempo has been described, as a line under the numbers.
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 2;
    let cursor = 0;
    const described = [];
    for (const gap of [...result.assumed.tempo].sort((a, b) => a.from - b.from)) {
      if (gap.from > cursor) described.push([cursor, gap.from]);
      cursor = Math.max(cursor, gap.to);
    }
    if (cursor < result.end) described.push([cursor, result.end]);
    for (const [from, to] of described) {
      const a = Math.max(G.gutter, X(encodedAt(result, from)));
      const b = Math.min(width, X(encodedAt(result, to)));
      if (b <= a) continue;
      ctx.beginPath();
      ctx.moveTo(a, top - 6.5);
      ctx.lineTo(b, top - 6.5);
      ctx.stroke();
    }

    // Where the playing is, or would begin: a line down the roll, hung from the ruler. The roll
    // turns its page when the line reaches the edge.
    const playing = Player.playing;
    const head = X(playing ? Player.now() : S.play.at);
    if (playing && !drag && head > width - 36 && head < width + 260) scroller.scrollLeft += head - G.gutter - 48;
    if ((playing || S.play.at > 0) && head >= G.gutter - 1 && head <= width) {
      const hx = Math.round(head) + 0.5;
      ctx.strokeStyle = palette.ink;
      ctx.fillStyle = palette.ink;
      ctx.lineWidth = playing ? 1.5 : 1;
      ctx.globalAlpha = playing ? 0.85 : 0.3;
      ctx.beginPath();
      ctx.moveTo(hx, top - 6);
      ctx.lineTo(hx, bottom);
      ctx.stroke();
      ctx.globalAlpha = playing ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(hx - 5, top - 14);
      ctx.lineTo(hx + 5, top - 14);
      ctx.lineTo(hx, top - 6);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
    }

    // The gutter: which key is which.
    ctx.fillStyle = palette.raised;
    ctx.fillRect(0, 0, G.gutter, height);
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(G.gutter - 0.5, 0);
    ctx.lineTo(G.gutter - 0.5, height);
    ctx.stroke();
    ctx.font = `400 10.5px ${palette.mono}`;
    ctx.fillStyle = palette.ink3;
    for (let pitch = G.lo; pitch <= G.hi; pitch++) {
      if (pitch % 12 === 0) ctx.fillText(`C${Math.floor(pitch / 12) - 1}`, 7, Y(pitch));
    }
    G.pedals.forEach(([, label], row) => ctx.fillText(label, 7, pedalY(row) + PEDAL / 2 + 0.5));

    placePen();
    // A remark still being read breathes, so the roll is drawn again while one is.
    if (S.tween || Player.playing) draw();
    else if (S.working || S.queue.length) setTimeout(draw, 90);
  };

  // ------------------------------------------------------------------------------------------
  // The pencil: where a remark is written
  // ------------------------------------------------------------------------------------------

  /** What a remark made now would be about. */
  const scopeNow = () => {
    if (S.pen.editing) return S.pen.editing.scope;
    const end = S.result ? S.result.end : 0;
    if (S.selKind === 'none' || S.selection.size === 0) return { kind: 'piece', ids: [], from: 0, to: end, label: 'the whole piece' };
    const notes = [...S.selection].map((id) => S.score.get(id)).filter(Boolean).sort((a, b) => a.date - b.date || a['midi.pitch'] - b['midi.pitch']);
    const first = notes[0].date;
    const last = notes[notes.length - 1].date;
    // Where the passage stops: the next thing the score has after its last onset.
    const next = S.base.dates.find((date) => date > last);
    const to = next === undefined ? end : next;
    const ids = notes.map((n) => n['xml:id']);
    if (S.selKind === 'span') return { kind: 'span', ids, from: first, to, label: span(first, to) };
    if (S.selKind === 'arrow' && notes.length === 2 && first < last) {
      const [a, b] = ids.map((id) => S.result.byId.get(id));
      return { kind: 'arrow', ids, from: first, to, label: `${pitchName(a)} → ${pitchName(b)}, ${where(first)} to ${where(last)}` };
    }
    const parts = [...new Set(notes.map((n) => n.part))];
    const hands = parts.length === 1 ? `, ${hand(parts[0])}` : '';
    if (notes.length === 1) {
      const live = S.result.byId.get(ids[0]);
      return { kind: 'notes', ids, from: first, to, label: `${live ? pitchName(live) : 'one note'}, ${where(first)}${hands}` };
    }
    const placed = first === last ? where(first) : span(first, to);
    return { kind: S.selKind === 'box' ? 'box' : 'notes', ids, from: first, to, label: `${notes.length} notes, ${placed}${hands}` };
  };

  const placePen = () => {
    if (!S.pen.open || !G.penAt) {
      if (S.pen.open && !G.penAt) pen.style.opacity = '0';
      return;
    }
    pen.style.opacity = '1';
    pen.classList.toggle('up', G.penAt.grows === 'up');
    const left = clamp(G.penAt.x, G.gutter + 4, G.width - pen.offsetWidth - 8);
    const topAt = clamp(G.penAt.grows === 'up' ? G.penAt.y - pen.offsetHeight : G.penAt.y, 2, G.height - 30);
    pen.style.left = `${left}px`;
    pen.style.top = `${topAt}px`;
  };

  /** The pen takes the room of its words and no more: what it covers cannot be clicked. */
  const growPen = () => {
    ctx.font = `500 16px ${palette.serif}`;
    const widest = Math.max(...(penText.value || penText.placeholder).split('\n').map((line) => ctx.measureText(line).width));
    penText.style.width = `${clamp(widest + 22, 150, Math.min(320, G.width - 24))}px`;
    penText.style.height = 'auto';
    penText.style.height = `${penText.scrollHeight + 2}px`;
  };

  /** What a reader might be about to say of this, going by what is left in it. */
  const suggest = (scope) => {
    const ideas = [];
    const has = (name) => S.anns.some((ann) => ann.enabled && ann.calls.some((call) => call.name === name || (call.options && call.options.call && call.options.call.name === name)));
    const ids = scope.kind === 'piece' ? [] : idsOf(scope);
    const left = leftIn(S.result, ids);
    const tempoAssumed = S.result.assumed.tempo.some((gap) => gap.from < scope.to && gap.to > scope.from);
    const notes = ids.length ? ids.map((id) => S.result.byId.get(id)).filter(Boolean) : S.result.notes;
    const mean = (key) => notes.reduce((sum, note) => sum + note[key], 0) / Math.max(1, notes.length);
    if (scope.kind === 'piece') {
      if (left.chords > 20) ideas.push('arpeggio throughout');
      if (tempoAssumed) ideas.push('steady tempo on bars');
      if (!has('InsertPedal')) ideas.push('pedal changes with the harmony');
      if (!tempoAssumed && left.loud > 2) ideas.push('the strong beats are marked');
    } else if (scope.kind === 'span') {
      const barsLong = (scope.to - scope.from) / 2880;
      if (left.chords > 20) ideas.push('the chords are rolled');
      if (tempoAssumed) ideas.push(barsLong > 2.5 ? 'steady tempo on half bars' : 'broadening');
      if (left.loud > 2) {
        const early = notes.filter((n) => n.date < (scope.from + scope.to) / 2);
        const late = notes.filter((n) => n.date >= (scope.from + scope.to) / 2);
        const level = (list) => list.reduce((sum, n) => sum + n.loud, 0) / Math.max(1, list.length);
        ideas.push(level(late) - level(early) > 1 ? 'crescendo' : level(early) - level(late) > 1 ? 'dying away' : 'one level');
      }
      ideas.push('pull towards the downbeat');
    } else if (scope.kind === 'arrow') {
      const half = (scope.from + scope.to) / 2;
      const level = (list) => list.reduce((sum, n) => sum + n.velocity, 0) / Math.max(1, list.length);
      const swell = level(notes.filter((n) => n.date >= half)) - level(notes.filter((n) => n.date < half));
      ideas.push('towards it', swell > 2 ? 'growing into it' : swell < -2 ? 'falling into it' : 'pressing forward', 'broadening into it');
    } else if (notes.length === 1) {
      const note = notes[0];
      if (note.loud > 2.5) ideas.push('presumably played quieter', 'accented');
      else if (note.loud < -2.5) ideas.push('presumably played louder');
      if (note.longMs < -150) ideas.push('played shorter than written');
      else if (note.longMs > 150) ideas.push('held over');
      if (Math.abs(note.late) > 60) ideas.push(note.late > 0 ? 'comes late' : 'comes early');
      if (!ideas.length) ideas.push('presumably played quieter');
    } else {
      const oneHand = new Set(notes.map((n) => n.part)).size === 1;
      if (oneHand && notes[0].part === 1 && mean('loud') > 0.8) ideas.push('the melody sings out over the accompaniment');
      if (new Set(notes.map((n) => n.date)).size === 1 && left.chords > 20) ideas.push('this chord is rolled');
      ideas.push(mean('longMs') < -120 ? 'detached' : 'legato, held over');
      if (mean('loud') > 2) ideas.push('accented');
    }
    return ideas.slice(0, 3);
  };

  /** The note a direction would name at a date: the right hand's highest there, or failing that anybody's. */
  const leadAt = (date) => {
    const there = S.result.notes.filter((note) => note.date === date).sort((a, b) => b.pitch - a.pitch);
    return there.find((note) => note.part === 1) || there[0];
  };

  const renderPenUnder = () => {
    const under = $('#penUnder');
    under.replaceChildren();
    if (!penText.value.trim()) {
      for (const idea of suggest(scopeNow())) {
        under.append(
          el('button', {
            class: 'chip',
            text: idea,
            onclick: () => {
              penText.value = idea;
              penText.focus();
              growPen();
              renderPenUnder();
            },
          }),
        );
      }
    } else {
      under.append(el('span', { class: 'keys', text: S.sample || !S.sampleAsked ? 'Enter to translate · Esc to drop' : 'Enter to keep (the expert answers when this page is open in Claude)' }));
    }
    // A passage can be made a direction, and a direction a passage: the same notes, held otherwise.
    const scope = scopeNow();
    const ends = scope.kind === 'span' ? [leadAt(scope.from), leadAt(S.result.dates.findLast((date) => date < scope.to))] : [];
    if (scope.kind === 'arrow' || (ends[0] && ends[1] && ends[0].date < ends[1].date)) {
      const turned = scope.kind === 'arrow' ? [idsOf(scope), 'span'] : [ends.map((note) => note.id), 'arrow'];
      under.append(el('button', { class: 'turn', text: scope.kind === 'arrow' ? 'make it a passage' : 'make it an arrow', title: scope.kind === 'arrow' ? 'Hold these notes in a brace' : 'Draw it as a direction, from its first note to its last', onclick: () => select(...turned) }));
    }
    // What is in hand can be heard by itself before anything is said of it.
    if (scope.kind !== 'piece') {
      under.append(
        el('button', {
          class: 'hear',
          title: 'Hear this by itself',
          text: 'hear it',
          onclick: () => {
            if (Player.playing) Player.stop();
            else Player.start();
            penText.focus({ preventScroll: true });
          },
        }),
      );
    }
  };

  const openPen = (seed) => {
    if (S.reference || !S.result) return;
    closePop();
    S.pen.open = true;
    pen.hidden = false;
    pen.style.opacity = '0';
    const scope = scopeNow();
    penText.placeholder =
      scope.kind === 'piece' ? 'about the whole piece…' : scope.kind === 'span' ? `about ${scope.label}…` : scope.kind === 'arrow' ? 'where is it going…' : scope.ids.length === 1 ? 'about this note…' : `about these ${scope.ids.length} notes…`;
    if (seed !== undefined) penText.value = seed;
    growPen();
    renderPenUnder();
    renderHint();
    draw();
    // At once, so that what is typed next goes into it; it is shown when it has been placed.
    penText.focus({ preventScroll: true });
  };

  const closePen = (keepSelection) => {
    S.pen.open = false;
    S.pen.editing = null;
    pen.hidden = true;
    penText.value = '';
    if (!keepSelection) {
      S.selection.clear();
      S.selKind = 'none';
    }
    renderHint();
    draw();
  };

  const select = (ids, kind, additive) => {
    if (S.pen.editing) {
      S.pen.editing = null;
      penText.value = '';
    }
    if (!additive) S.selection.clear();
    for (const id of ids) S.selection.add(id);
    S.selKind = S.selection.size === 0 ? 'none' : additive && S.selKind !== 'none' && S.selKind !== kind ? 'notes' : kind;
    if (S.selection.size) openPen();
    else if (!penText.value.trim()) closePen();
    else openPen();
  };

  penText.addEventListener('input', () => {
    growPen();
    renderPenUnder();
  });
  penText.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      describe();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closePen();
      canvas.focus({ preventScroll: true });
    }
  });

  // ------------------------------------------------------------------------------------------
  // Pointer
  // ------------------------------------------------------------------------------------------

  let drag = null;
  const local = (event) => {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  /** The note at a point: the solid one there, or else the one whose shadow is there. */
  const noteAt = (x, y) => {
    for (const rects of [G.rects, G.shades || []]) {
      let best = null;
      for (const rect of rects) {
        if (x < rect.x - 2 || x > rect.x + rect.w + 2 || y < rect.y - 2 || y > rect.y + rect.h + 2) continue;
        if (!best || rect.w * rect.h < best.w * best.h) best = rect;
      }
      if (best) return best.note;
    }
    return null;
  };
  const markAt = (x, y) => {
    for (let i = G.marks.length - 1; i >= 0; i--) {
      const m = G.marks[i];
      if (x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h) return m;
    }
    return null;
  };
  const inLanes = (y) => y < G.top - 5;

  canvas.addEventListener('pointerdown', (event) => {
    if (!S.result || event.button > 0) return;
    const { x, y } = local(event);
    closeMenu();
    tip.hidden = true;
    if (S.reference) return;
    // A remark stands among the notes now, so a press on one may be the start of a stroke as well.
    const mark = markAt(x, y);
    const touch = event.pointerType === 'touch';
    const note = mark || inLanes(y) ? null : noteAt(x, y);
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    if (touch && !S.view.pencil) {
      drag = { kind: 'tap', x0: x, y0: y, note, mark, additive };
      return;
    }
    // A press that lands on a note or a remark is a click on it only if it does not go on to be a stroke.
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that cannot be captured still draws; it only stops at the roll's edge.
    }
    drag = { kind: 'band', x0: x, y0: y, x1: x, y1: y, note, mark, additive, lanes: inLanes(y), flat: true, moved: false, scroll: scroller.scrollLeft };
  });

  const pick = (note, additive) => {
    closePop();
    if (additive && S.selection.has(note.id)) {
      S.selection.delete(note.id);
      select([], S.selKind, true);
    } else select([note.id], 'notes', additive);
  };

  canvas.addEventListener('pointermove', (event) => {
    const { x, y } = local(event);
    if (drag && drag.kind === 'band') {
      // The bracket is drawn in what is on screen, and the roll may scroll under it.
      drag.x0 += drag.scroll - scroller.scrollLeft;
      drag.scroll = scroller.scrollLeft;
      drag.x1 = x;
      drag.y1 = y;
      drag.moved = drag.moved || Math.abs(x - drag.x0) > 4 || Math.abs(y - drag.y0) > 4;
      // A stroke along the roll is a bracket over a stretch; one that goes down it is a box.
      drag.flat = drag.lanes || Math.abs(y - drag.y0) < 16;
      // From a note to another note is an arrow.
      const aim = drag.note && drag.moved ? noteAt(x, y) : null;
      drag.aim = aim && aim.date !== drag.note.date ? aim : null;
      draw();
      return;
    }
    if (drag || event.pointerType === 'touch') return;
    const mark = S.reference ? null : markAt(x, y);
    const hover = mark ? mark.ann : null;
    if (hover !== S.hoverAnn) {
      S.hoverAnn = hover;
      draw();
      if (!$('#drawer').hidden) renderMpm();
    }
    const note = inLanes(y) || mark ? null : noteAt(x, y);
    canvas.style.cursor = mark || note ? 'pointer' : inLanes(y) && G.promptRow && y >= G.promptRow.y ? 'text' : 'crosshair';
    if ((note ? note.id : null) !== S.hoverNote) {
      S.hoverNote = note ? note.id : null;
      draw();
    }
    if (note) showTip(note, x, y);
    else tip.hidden = true;
  });

  const endDrag = (event) => {
    if (!drag) return;
    const done = drag;
    drag = null;
    const { x, y } = local(event);
    if (done.kind === 'tap') {
      if (Math.hypot(x - done.x0, y - done.y0) >= 8) return;
      if (done.mark) openPop(done.mark.ann, done.mark);
      else if (done.note) pick(done.note, done.additive);
      else emptyClick(done.x0, done.y0);
      return;
    }
    if (done.kind !== 'band') return;
    if (!done.moved) {
      if (done.mark) openPop(done.mark.ann, done.mark);
      else if (done.note) pick(done.note, done.additive);
      else emptyClick(done.x0, done.y0);
      draw();
      return;
    }
    if (done.aim) {
      closePop();
      select([done.note.id, done.aim.id], 'arrow');
      return;
    }
    const x0 = Math.min(done.x0, done.x1);
    const x1 = Math.max(done.x0, done.x1);
    const y0 = Math.min(done.y0, done.y1);
    const y1 = Math.max(done.y0, done.y1);
    const within = S.result.notes.filter((note) => {
      const r = rectOf(note);
      return r.x <= x1 && r.x + Math.min(r.w, 12) >= x0;
    });
    const boxed = done.flat ? within : within.filter((note) => {
      const r = rectOf(note);
      return r.y + r.h >= y0 && r.y <= y1;
    });
    if (boxed.length === 0) {
      notice('No notes in that stretch.');
      draw();
      return;
    }
    closePop();
    // A box that takes in every note of its stretch is a bracket over the stretch.
    select(boxed.map((note) => note.id), done.flat || boxed.length === within.length ? 'span' : 'box', done.additive);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => {
    drag = null;
    draw();
  });
  canvas.addEventListener('pointerleave', () => {
    tip.hidden = true;
    if (S.hoverAnn || S.hoverNote) {
      S.hoverAnn = null;
      S.hoverNote = null;
      draw();
    }
  });

  /** A click on nothing: puts away what is open, or starts a remark about the whole piece. */
  const emptyClick = (x, y) => {
    if (S.openAnn) {
      closePop();
      return;
    }
    const prompt = G.promptRow && inLanes(y) && y >= G.promptRow.y && y <= G.promptRow.y + G.promptRow.h;
    const kept = S.pen.open && penText.value.trim();
    if (S.pen.open && !kept) closePen();
    // On the ruler or among the notes, a click on nothing is where the playing begins.
    if (!prompt && !kept && x >= G.gutter && y >= G.lanes * LANE) {
      Player.seek(msOf(x));
      return;
    }
    if (prompt || kept) {
      // Words already written stay, and are now about the whole piece.
      const words = penText.value;
      S.pen.editing = null;
      S.selection.clear();
      S.selKind = 'none';
      openPen(words);
    }
  };

  scroller.addEventListener('scroll', () => {
    tip.hidden = true;
    draw();
    if (S.openAnn) closePop();
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15, local(event).x);
    },
    { passive: false },
  );

  const zoom = (factor, anchorPx) => {
    const anchor = anchorPx === undefined ? G.width / 2 : anchorPx;
    const ms = msOf(anchor);
    S.view.ppt = clamp(S.view.ppt * factor, 0.002, 0.4);
    layout();
    scroller.scrollLeft = Math.max(0, G.gutter + ms * S.view.ppt - anchor);
    draw();
  };
  const fit = () => {
    if (!S.result) return;
    S.view.ppt = Math.max(0.002, (G.width - G.gutter - 70) / S.result.total);
    layout();
    scroller.scrollLeft = 0;
    draw();
  };

  // ------------------------------------------------------------------------------------------
  // Playing: the roll heard, as it was played, as the MPM has it, or both at once
  // ------------------------------------------------------------------------------------------

  /** The stretches of the clock over which the pedal is down, and a key let go rings on. */
  const pedalled = (result, which) => {
    if (which === 'played') return result.pedals.played.filter((press) => press.kind === 'sustain').map((press) => [press.ms, press.msEnd]);
    const spans = [];
    let down = null;
    for (const move of result.pedals.mpm.filter((move) => move.kind === 'sustain')) {
      if (move.value >= 64 && down === null) down = move.ms;
      else if (move.value < 64 && down !== null) {
        spans.push([down, move.ms]);
        down = null;
      }
    }
    if (down !== null) spans.push([down, result.total]);
    return spans;
  };

  /** Every key struck, in order: when, how hard, and when it is damped. */
  const keysOf = (result, source, only) => {
    const voice = (which, pan) => {
      const spans = pedalled(result, which);
      const damped = (end) => (spans.find(([down, up]) => end >= down && end < up) || [0, end])[1];
      const keys = result.notes
        .filter((note) => !only || only.has(note.id))
        .map((note) => ({ pitch: note.pitch, sound: which === 'played' ? note : note.mpm }))
        .map(({ pitch, sound }) => ({ ms: sound.ms, end: damped(sound.msEnd), pitch, velocity: sound.velocity, pan }));
      // The grace notes are in the recording only: the score gives them no time to render.
      if (which === 'played') {
        for (const grace of result.graces.filter((grace) => !only || only.has(grace.principal))) {
          keys.push({ ms: grace.ms, end: damped(grace.ms + 160), pitch: grace.pitch, velocity: grace.velocity, pan });
        }
      }
      // A key struck again is damped first, however long the pedal would have held it.
      keys.sort((a, b) => a.ms - b.ms);
      const last = new Map();
      for (const key of keys) {
        const before = last.get(key.pitch);
        if (before && before.end > key.ms) before.end = key.ms;
        last.set(key.pitch, key);
      }
      return keys;
    };
    const played = source === 'mpm' ? [] : voice('played', source === 'both' ? -0.55 : 0);
    const rendered = source === 'played' ? [] : voice('mpm', source === 'both' ? 0.55 : 0);
    return [...played, ...rendered].sort((a, b) => a.ms - b.ms);
  };

  const Player = (() => {
    let only = null;
    let scoped = false;

    const reflect = () => {
      const on = transport.playing;
      S.play.on = on;
      const button = $('#playBtn');
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', on ? 'Pause' : 'Play');
      $('#playIcon').setAttribute('d', on ? 'M2 1.5h3v9H2zM7 1.5h3v9H7z' : 'M2.5 1v10l8.5-5z');
      renderHint();
      draw();
    };

    const transport = createPlayer({
      onChange: reflect,
      onEnd: () => {
        if (!scoped) S.play.at = 0;
      },
      onLoading: (done, total) => {
        S.play.loading = done < total ? { done, total } : null;
        renderHint();
      },
    });

    /**
     * The stretch of the clock to play. What is in hand is played by itself, from its first note
     * to its last: a passage whole, a set of notes without the others. With nothing in hand the
     * roll is played from the line, or from the left edge where the line is out of sight.
     */
    const stretch = () => {
      const result = S.result;
      const scope = S.pen.open || S.selection.size ? scopeNow() : S.openAnn ? S.openAnn.scope : null;
      if (scope && scope.kind !== 'piece') {
        const ids = idsOf(scope);
        const sounds = ids
          .map((id) => result.byId.get(id))
          .filter(Boolean)
          .flatMap((note) => (S.play.source === 'played' ? [note] : S.play.source === 'mpm' ? [note.mpm] : [note, note.mpm]));
        if (sounds.length) {
          return { from: Math.min(...sounds.map((sound) => sound.ms)) - 40, until: Math.max(...sounds.map((sound) => sound.msEnd)) + 500, only: new Set(ids), scoped: true };
        }
      }
      const seen = X(S.play.at) >= G.gutter - 1 && X(S.play.at) < G.width;
      const from = seen ? S.play.at : Math.max(0, msOf(G.gutter));
      return { from: from < result.total - 200 ? from : 0, until: result.total + 600, only: null, scoped: false };
    };

    const start = async (over) => {
      if (!S.result || transport.loading) return;
      const played = over || stretch();
      ({ only, scoped } = played);
      const started = await transport.play(keysOf(S.result, S.play.source, only), played);
      S.play.loading = null;
      if (!started) notice('The piano could not be heard here.');
    };

    /** Stop. Stopped in the middle of the roll, the line stays where the playing was. */
    const stop = () => {
      if (!transport.playing) return;
      if (!scoped) S.play.at = clamp(transport.position(), 0, S.result.total);
      transport.stop();
    };

    /** Put the line somewhere; the playing, if there is any, goes on from there. */
    const seek = (ms) => {
      if (!S.result) return;
      S.play.at = clamp(ms, 0, S.result.total);
      if (transport.playing) start({ from: S.play.at, until: S.result.total + 600, only: null, scoped: false });
      else draw();
    };

    const refresh = () => transport.replace(keysOf(S.result, S.play.source, only));

    const hear = (source) => {
      S.play.source = source;
      for (const button of document.querySelectorAll('#hear button')) button.setAttribute('aria-pressed', String(button.dataset.src === source));
      // A passage is heard again from its start; the roll goes on where it is.
      if (transport.playing && scoped) start();
      else refresh();
    };

    return {
      start,
      stop,
      seek,
      refresh,
      hear,
      toggle: () => (transport.playing ? stop() : start()),
      now: () => transport.position(),
      get playing() {
        return transport.playing;
      },
    };
  })();

  $('#playBtn').addEventListener('click', () => Player.toggle());
  for (const button of document.querySelectorAll('#hear button')) button.addEventListener('click', () => Player.hear(button.dataset.src));

  const signed = (value, unit, digits = 0) => {
    const number = Number(value.toFixed(digits));
    if (number === 0) return `0${unit ? ` ${unit}` : ''}`;
    return `${number > 0 ? '+' : '−'}${Math.abs(number).toFixed(digits)}${unit ? ` ${unit}` : ''}`;
  };

  const showTip = (note, x, y) => {
    tip.replaceChildren(
      el('div', {}, el('b', { text: pitchName(note) }), ` · ${where(note.date)} · ${hand(note.part)}`),
      el('div', { class: 'row' }, el('span', { class: 'k', text: 'played' }), `velocity ${note.velocity}, ${Math.round(note.msEnd - note.ms)} ms long`),
      el(
        'div',
        { class: 'row' },
        el('span', { class: 'k', text: 'the MPM' }),
        Math.abs(note.late) < 8 && Math.abs(note.loud) < 1.5 && Math.abs(note.longMs) < 30
          ? 'has it as it was played'
          : `has it ${[
              Math.abs(note.late) >= 8 && `${Math.round(Math.abs(note.late))} ms ${note.late > 0 ? 'too early' : 'too late'}`,
              Math.abs(note.loud) >= 1.5 && `${Math.abs(note.loud).toFixed(1)} ${note.loud > 0 ? 'too soft' : 'too loud'}`,
              Math.abs(note.longMs) >= 30 && `${Math.round(Math.abs(note.longMs))} ms ${note.longMs > 0 ? 'too short' : 'too long'}`,
            ]
              .filter(Boolean)
              .join(', ')}`,
      ),
      note.arrived && el('div', { class: 'row' }, el('span', { class: 'k', text: 'the roll' }), `had velocity ${note.arrived.velocity}, ${Math.round(note.arrived.msEnd - note.arrived.ms)} ms long: corrected`),
    );
    tip.hidden = false;
    const left = clamp(x + 14, G.gutter, G.width - tip.offsetWidth - 8);
    const topAt = y + 16 + tip.offsetHeight > G.height ? y - tip.offsetHeight - 10 : y + 16;
    tip.style.left = `${left}px`;
    tip.style.top = `${topAt}px`;
  };

  // ------------------------------------------------------------------------------------------
  // Meters and the line under the roll
  // ------------------------------------------------------------------------------------------

  /** A distance as it is shown: a time in milliseconds, or in seconds once it is one; a loudness in velocities. */
  const amountOf = (key, value) => {
    if (key === 'loud') return value.toFixed(1);
    if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} s`;
    return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ms`;
  };
  const METERS = {
    pulse: ['Timing', 'How early or late a chord sounds against where it was played. Remarks about tempo and rubato bring it down.'],
    chords: ['In chords', 'How far the notes of one chord were played from each other, beyond what the MPM has: rolled chords, hands not together.'],
    loud: ['Loudness', 'How much louder or softer a note was played, in key velocity (the MIDI scale, 1 to 127). Dynamics and accents.'],
    length: ['Length', 'How much longer or shorter a note was held. Articulation: legato, detached, held over.'],
  };

  const renderLegend = () => {
    const now = S.result && S.result.left;
    const was = S.base && S.base.left;
    $('#legend').replaceChildren(
      el('h2', { text: 'How far the notes still are from their shadows' }),
      el('p', {
        text: 'A note is what the MPM so far renders, its shadow the same note as it was played. Each number is the distance between the two, averaged over all the notes. They fall as you describe more; at zero the MPM plays what the pianist played. The bar under a number is how much is left of what there was with nothing described.',
      }),
      el(
        'dl',
        {},
        Object.entries(METERS).flatMap(([key, [name, text]]) => [
          el('dt', { text: name }),
          el('dd', {}, text, now && was && el('span', { class: 'now', text: `${amountOf(key, now[key])} now · ${amountOf(key, was[key])} with nothing described` })),
        ]),
      ),
    );
  };
  const setLegend = (open) => {
    $('#legend').hidden = !open;
    $('#meters').setAttribute('aria-expanded', String(open));
    if (open) renderLegend();
  };
  $('#meters').addEventListener('click', () => setLegend($('#legend').hidden));

  const renderMeters = () => {
    const now = S.result ? (S.result.left = S.result.left || leftIn(S.result)) : null;
    const was = S.base ? (S.base.left = S.base.left || leftIn(S.base)) : null;
    for (const meter of document.querySelectorAll('.meter')) {
      const key = meter.dataset.k;
      const value = meter.querySelector('.val');
      const fill = meter.querySelector('.fill');
      if (!now || !was || !Number.isFinite(now[key])) {
        value.textContent = '–';
        continue;
      }
      value.textContent = amountOf(key, now[key]);
      fill.style.width = `${clamp((now[key] / Math.max(was[key], 1e-9)) * 100, 2, 100)}%`;
      fill.style.opacity = S.fitting ? '0.45' : '1';
    }
    if (!$('#legend').hidden) renderLegend();
  };

  let noticeTimer = 0;
  const notice = (text, undo) => {
    S.notice = { text, undo };
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      S.notice = null;
      renderHint();
    }, 7000);
    renderHint();
  };

  /** One line under the roll: what can be done now, or what is being done. */
  const renderHint = () => {
    const hint = $('#hint');
    hint.replaceChildren();
    if (S.reference) {
      hint.append('Showing the published reconstruction: 443 calls made by hand in the MPM Desk. ', el('button', { text: 'Back to my remarks', onclick: () => setReference(false) }));
      return;
    }
    if (S.notice) {
      hint.append(S.notice.text, ' ');
      if (S.notice.undo) hint.append(el('button', { text: 'Undo', onclick: S.notice.undo }));
      return;
    }
    if (S.play.loading) {
      hint.append(el('span', { class: 'pulse' }), `Fetching the piano: ${S.play.loading.done} of ${S.play.loading.total} samples.`);
      return;
    }
    if (S.pen.open) {
      hint.append(`Writing about ${scopeNow().label}.`);
      return;
    }
    if (S.working) {
      hint.append(el('span', { class: 'pulse' }), `Reading “${shown(S.working.text)}”${S.queue.length ? `, ${S.queue.length} more waiting` : ''}. You can go on writing.`);
      return;
    }
    if (S.sampleAsked && !S.sample) {
      hint.append('The expert answers when this page is open in Claude. Remarks written here are kept, and their calls can be written by hand.');
      return;
    }
    if (!S.result) return;
    const key = 'Notes: what the MPM so far renders. Shadows: what was played. ';
    if (S.anns.length === 0) {
      hint.append('Nothing is described yet: one steady tempo, one level. ', key, 'Describe what you see until the notes cover their shadows: drag to bracket a passage, click a note, or just type.');
      return;
    }
    hint.append(key, S.result.assumed.tempo.length ? 'Dashed bar lines: tempo only assumed. ' : '', 'Click a remark to see what it became. Space plays.');
  };

  // ------------------------------------------------------------------------------------------
  // A remark, called up
  // ------------------------------------------------------------------------------------------

  /** What a remark's elements are, counted by kind: `tempo x 8`. */
  const kinds = (report) => {
    const counts = new Map();
    report.elements.forEach((id, i) => {
      const tag = /^<([\w.:-]+)/.exec(report.written[i] || '');
      const kind = tag ? tag[1] : (/^[A-Za-z]+/.exec(id) || ['element'])[0];
      counts.set(kind, (counts.get(kind) || 0) + 1);
    });
    return [...counts.entries()];
  };

  const effectOf = (ann) => {
    if (!ann.delta) return null;
    const parts = [];
    if (Math.abs(ann.delta.pulse) >= 1) parts.push(`timing ${signed(-ann.delta.pulse, 'ms')}`);
    if (Math.abs(ann.delta.chords) >= 1) parts.push(`in chords ${signed(-ann.delta.chords, 'ms')}`);
    if (Math.abs(ann.delta.loud) >= 0.05) parts.push(`loudness ${signed(-ann.delta.loud, '', 2)}`);
    if (Math.abs(ann.delta.length) >= 1) parts.push(`length ${signed(-ann.delta.length, 'ms')}`);
    return parts.length ? parts.join(' · ') : 'nothing of what is measured';
  };

  const fittedLine = (fitted) =>
    fitted.bpm !== undefined
      ? `${place(fitted.from)}–${place(fitted.to)}  ${fitted.bpm.toFixed(1)}${fitted.transitionTo !== undefined ? ` → ${fitted.transitionTo.toFixed(1)}` : ''} bpm, ${fitted.onsets} chords, rms ${fitted.rmsMs.toFixed(0)} ms`
      : `${place(fitted.from)}–${place(fitted.to)}  level ${fitted.volume.toFixed(1)} over ${fitted.chords} chords`;

  const removeAnn = (ann) => {
    const before = [...S.anns];
    S.anns = S.anns.filter((other) => other !== ann);
    S.queue = S.queue.filter((entry) => entry.ann !== ann);
    if (ann.abort) ann.abort.abort();
    closePop();
    save();
    refit();
    notice(`Removed “${shown(ann.text)}”.`, () => {
      S.anns = before;
      S.notice = null;
      save();
      refit();
    });
  };

  const renderPop = () => {
    const ann = S.openAnn;
    if (!ann) return;
    const open = pop.querySelector('details') ? pop.querySelector('details').open : false;
    const typed = pop.querySelector('.ask input') ? pop.querySelector('.ask input').value : '';
    pop.replaceChildren();
    pop.setAttribute('style', `${pop.getAttribute('style') || ''}`);
    const report = ann.report;
    const waiting = S.queue.some((entry) => entry.ann === ann);

    pop.append(
      el('div', { class: 'said', text: ann.text }),
      el('div', { class: 'where' }, ann.scope.label, ann.example && el('span', { class: 'tag', text: 'example', title: 'An example, translated in advance. Remove it whenever you like.' }), !ann.enabled && el('span', { class: 'tag', text: 'muted' })),
    );

    if (ann.status === 'pending' || waiting) {
      pop.append(el('div', { class: 'reading' }, el('span', { class: 'pulse' }), waiting ? 'Waiting for its turn…' : 'Reading the remark…'));
      pop.append(el('div', { class: 'acts' }, !waiting && el('button', { class: 'btn quiet', text: 'Stop', onclick: () => ann.abort && ann.abort.abort() }), el('button', { class: 'btn quiet', text: 'Remove', onclick: () => removeAnn(ann) })));
      return;
    }

    if (ann.question) {
      const answer = el('input', { type: 'text', placeholder: 'Your answer', 'aria-label': 'Your answer', value: typed });
      answer.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && answer.value.trim()) {
          ann.thread = [...(ann.thread || []), { question: ann.question, answer: answer.value.trim() }];
          enqueue(ann, 'answer');
        }
        event.stopPropagation();
      });
      pop.append(el('div', { class: 'ask' }, ann.question, S.sample && answer));
    }
    if (ann.failure) pop.append(el('div', { class: 'err', text: ann.failure }));
    if (report) {
      for (const error of report.errors) {
        const call = ann.calls[error.index];
        pop.append(el('div', { class: 'err', text: `${call ? call.name : 'A step'} did not run: ${error.message}` }));
      }
    }
    if (ann.calls.length && report) {
      const steps = el('div', { class: 'steps' });
      const written = kinds(report);
      for (const [kind, count] of written) steps.append(el('span', { class: 'step' }, kind, count > 1 && el('em', { text: ` ×${count}` })));
      if (!written.length && ann.enabled && !report.errors.length) steps.append(el('span', { class: 'step', text: 'corrects the recording' }));
      const effect = effectOf(ann);
      if (effect && ann.enabled) steps.append(el('span', { class: `effect${effect.startsWith('nothing') ? ' none' : ''}`, text: effect, title: 'What it took off what is left unexplained in its passage' }));
      pop.append(steps);
      // Who turned the words into these steps, and when: all that is kept besides the two.
      const day = ann.date ? new Date(ann.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
      pop.append(el('div', { class: 'note', text: [ann.model || 'steps written by hand', day].filter(Boolean).join(' · ') }));
    }

    const acts = el('div', { class: 'acts' });
    acts.append(
      el('button', {
        class: 'btn quiet',
        text: 'Rephrase',
        title: 'Write it again in other words',
        onclick: () => {
          closePop();
          S.selection.clear();
          S.selKind = 'none';
          S.pen.editing = ann;
          openPen(ann.text);
        },
      }),
    );
    if (ann.calls.length) {
      acts.append(
        el('button', {
          class: 'btn quiet',
          text: ann.enabled ? 'Mute' : 'Unmute',
          title: 'Run the chain without this remark, to see what it accounts for',
          onclick: () => {
            ann.enabled = !ann.enabled;
            save();
            refit();
          },
        }),
      );
    }
    if (S.sample && (ann.failure || (report && report.errors.length))) {
      acts.append(el('button', { class: 'btn quiet', text: report && report.errors.length ? 'Ask to repair' : 'Ask again', onclick: () => enqueue(ann, report && report.errors.length ? 'repair' : 'new') }));
    }
    acts.append(el('button', { class: 'btn quiet', text: 'Remove', onclick: () => removeAnn(ann) }));
    pop.append(acts);

    // The steps themselves, for somebody who knows the MPM Desk and wants to see or mend them.
    const details = el('details', {});
    details.open = open;
    details.append(el('summary', { text: ann.calls.length ? `${ann.calls.length} ${ann.calls.length === 1 ? 'call' : 'calls'} to the chain` : 'Write its calls by hand' }));
    const area = el('textarea', { class: 'calls', spellcheck: 'false', 'aria-label': 'The calls of this remark, as JSON' });
    area.value = JSON.stringify(ann.calls, null, 1);
    area.addEventListener('keydown', (event) => event.stopPropagation());
    const status = el('span', { class: 'note' });
    details.append(
      area,
      el(
        'div',
        { class: 'acts' },
        el('button', {
          class: 'btn quiet',
          text: 'Apply',
          onclick: () => {
            try {
              const calls = JSON.parse(area.value);
              if (!Array.isArray(calls) || calls.some((call) => !call || typeof call.name !== 'string')) throw new Error('a list of {name, options}');
              ann.calls = calls.map((call) => ({ name: call.name, options: call.options || {} }));
              ann.model = null;
              ann.status = 'done';
              ann.failure = null;
              ann.question = null;
              apply(ann);
            } catch (error) {
              status.textContent = `Not valid: ${error.message}`;
            }
          },
        }),
        status,
      ),
    );
    if (report && (report.fitted.length || report.written.length)) {
      const list = el('ul', { class: 'list' });
      for (const fitted of report.fitted.slice(0, 40)) list.append(el('li', { text: fittedLine(fitted) }));
      for (const tag of report.written.filter(Boolean).slice(0, 40)) list.append(el('li', { text: tag }));
      for (const definition of report.definitions.slice(0, 20)) list.append(el('li', { text: definition }));
      details.append(list);
    }
    pop.append(details);
  };

  const placePop = () => {
    const anchor = pop.anchor || { x: G.gutter + 10, y: 10, w: 10, h: 10 };
    const left = clamp(anchor.x, 8, G.width - pop.offsetWidth - 8);
    const below = anchor.y + anchor.h + 8;
    const topAt = below + Math.min(pop.offsetHeight, 220) > G.height ? Math.max(8, anchor.y - pop.offsetHeight - 8) : below;
    pop.style.left = `${left}px`;
    pop.style.top = `${topAt}px`;
  };

  const openPop = (ann, mark) => {
    if (S.pen.open) closePen();
    S.openAnn = ann;
    pop.anchor = mark ? { x: mark.x, y: mark.y, w: mark.w, h: mark.h } : null;
    pop.hidden = false;
    renderPop();
    placePop();
    draw();
    if (!$('#drawer').hidden) renderMpm();
  };
  const closePop = () => {
    if (!S.openAnn) return;
    S.openAnn = null;
    pop.hidden = true;
    pop.replaceChildren();
    draw();
  };

  // ------------------------------------------------------------------------------------------
  // MPM
  // ------------------------------------------------------------------------------------------

  const pretty = (xml) => {
    const tokens = xml.replace(/>\s*</g, '>\n<').split('\n');
    let depth = 0;
    const lines = [];
    for (const token of tokens) {
      if (/^<\//.test(token)) depth = Math.max(0, depth - 1);
      lines.push('  '.repeat(depth) + token);
      if (/^<[^!?/][^>]*[^/]>$/.test(token) && !/^<[^>]+>.*<\/[^>]+>$/.test(token)) depth++;
    }
    return lines.join('\n');
  };

  const renderMpm = () => {
    const pre = $('#mpmXml');
    const counts = $('#mpmCounts');
    pre.replaceChildren();
    counts.replaceChildren();
    if (!S.result) return;
    const lit = S.hoverAnn || S.openAnn;
    const hot = new Set(lit && lit.report ? lit.report.elements : []);
    const tally = new Map();
    let firstHot = null;
    for (const line of pretty(S.result.mpm).split('\n')) {
      const match = /^(\s*)<(\/?)([\w.:-]+)([^>]*?)(\/?)>(.*)$/.exec(line);
      if (!match) {
        pre.append(line, '\n');
        continue;
      }
      const [, indent, closing, tag, attributes, selfClosing, rest] = match;
      const id = /xml:id="([^"]+)"/.exec(attributes);
      const row = el('span', { class: id && hot.has(id[1]) ? 'hot' : undefined });
      if (id && hot.has(id[1]) && !firstHot) firstHot = row;
      row.append(indent, '<', closing, el('span', { class: 't', text: tag }));
      for (const attribute of attributes.matchAll(/\s+([\w.:-]+)="([^"]*)"/g)) {
        row.append(' ', el('span', { class: 'a', text: attribute[1] }), '="', el('span', { class: 'v', text: attribute[2] }), '"');
      }
      row.append(selfClosing ? ' />' : '>', rest);
      pre.append(row, '\n');
      if (!closing && !/Map$|Styles$|^(mpm|performance|global|part|header|dated|styleDef|metadata)$/.test(tag)) tally.set(tag, (tally.get(tag) || 0) + 1);
    }
    for (const [tag, count] of [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      counts.append(el('span', { class: 'step' }, tag, el('em', { text: ` ×${count}` })));
    }
    if (firstHot) firstHot.scrollIntoView({ block: 'center' });
  };

  /** The calls as the MPM Desk would hold them: a fitted step as the stated one it came to. */
  const workFile = () => JSON.stringify({ name: S.piece.title, mei: 'transcription.mei', mpm: 'performance.mpm', provenance: S.result.record }, null, 2);


  const flash = (button, text) => {
    const was = button.textContent;
    button.textContent = text;
    setTimeout(() => (button.textContent = was), 1400);
  };
  $('#copyMpm').addEventListener('click', async (event) => {
    if (!S.result) return;
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(pretty(S.result.mpm));
      flash(button, 'Copied');
    } catch {
      const range = document.createRange();
      range.selectNodeContents($('#mpmXml'));
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      flash(button, 'Selected: copy it');
    }
  });
  const saveFile = async (button, filename, data) => {
    try {
      await S.downloads.save({ filename, data });
      flash(button, 'Saved');
    } catch {
      flash(button, 'Not saved');
    }
  };
  $('#saveMpm').addEventListener('click', (event) => S.result && saveFile(event.currentTarget, 'performance.mpm', pretty(S.result.mpm)));
  $('#saveWork').addEventListener('click', (event) => S.result && saveFile(event.currentTarget, 'work.json', workFile()));

  const setDrawer = (open) => {
    $('#drawer').hidden = !open;
    $('#mpmBtn').setAttribute('aria-expanded', String(open));
    if (open) renderMpm();
  };
  $('#mpmBtn').addEventListener('click', () => setDrawer($('#drawer').hidden));
  $('#closeDrawer').addEventListener('click', () => setDrawer(false));

  const closeMenu = () => {
    $('#menu').hidden = true;
    $('#menuBtn').setAttribute('aria-expanded', 'false');
  };
  $('#menuBtn').addEventListener('click', () => {
    const open = $('#menu').hidden;
    setLegend(false);
    $('#menu').hidden = !open;
    $('#menuBtn').setAttribute('aria-expanded', String(open));
    $('#refState').textContent = S.reference ? 'on' : 'off';
    $('#ghostState').textContent = S.view.shadows ? 'on' : 'off';
  });

  // ------------------------------------------------------------------------------------------
  // The expert
  // ------------------------------------------------------------------------------------------

  const COPY = {
    not_granted: 'Claude was not allowed to answer for this page, so remarks cannot be translated here.',
    sampling_disabled: 'Claude is not available for this account.',
    rate_limited: 'Too many requests for now. Try again in a little while.',
    session_expired: 'You are signed out. Sign in again and retry.',
    refused: 'Claude declined this remark. Try wording it differently.',
    prompt_too_large: 'There is too much to send at once.',
    empty_completion: 'No answer came back. Try again, or say less at a time.',
    invalid_json: 'The answer could not be read as steps. Try again.',
    upstream_error: 'The connection failed. Try again.',
  };

  const noteTable = () => {
    const rows = ['id\thand\ttick\tbar:beat\tticks\tpitch\tname\tonset_ms\tsounds_ms\tvelocity\tleft_late_ms\tleft_loud\tleft_long_ms'];
    for (const note of [...S.result.notes].sort((a, b) => a.date - b.date || a.pitch - b.pitch)) {
      rows.push(
        [note.id, note.part === 1 ? 'R' : 'L', note.date, place(note.date), note.duration, note.pitch, pitchName(note), Math.round(note.ms), Math.round(note.msEnd - note.ms), note.velocity, Math.round(note.late), note.loud.toFixed(1), Math.round(note.longMs)].join('\t'),
      );
    }
    return rows.join('\n');
  };

  const pedalTable = () =>
    ['id\tpedal\tdown_ms\tup_ms']
      .concat(S.piece.alignment.pedals.map((p) => [p['xml:id'], p.type, Math.round(p['milliseconds.date'] - S.firstMs), Math.round(p['milliseconds.date.end'] - S.firstMs)].join('\t')))
      .join('\n');

  const graceTable = () => {
    const groups = new Map();
    for (const grace of S.piece.alignment.graces) {
      const group = groups.get(grace.group) || { principal: grace.principal, date: grace.date, notes: 0 };
      group.notes++;
      groups.set(grace.group, group);
    }
    return ['group\tprincipal\tbar:beat\tnotes'].concat([...groups].map(([id, g]) => [id, g.principal, place(g.date), g.notes].join('\t'))).join('\n');
  };

  const measureText = (left) => {
    const m = measures(left);
    return `${m.notes} notes: pulse_ms ${m.pulse_ms}, spread_ms ${m.spread_ms}, velocity ${m.velocity}, length_ms ${m.length_ms}`;
  };

  const stateText = (ann) => {
    const lines = [];
    const others = S.anns.filter((other) => other !== ann && other.status === 'done' && other.enabled && other.calls.length);
    if (others.length === 0) lines.push('Nothing has been described yet.');
    for (const other of others) {
      lines.push(`- "${other.text}" (about ${other.scope.label}; ticks ${other.scope.from}–${other.scope.to}) → ${JSON.stringify(other.calls)}`);
    }
    const { tempo, level, levelDates } = S.result.assumed;
    lines.push('', 'Assumed by the engine where nothing is described (do not restate these; they give way to your calls):');
    lines.push(`- steady tempo: ${tempo.map((gap) => `[${gap.from},${gap.to}) ${gap.bpm.toFixed(1)} bpm`).join(', ') || 'none, the tempo is described throughout'}`);
    lines.push(`- level: velocity ${level} from ticks ${levelDates.join(', ') || '(none, dynamics are described throughout)'}`);
    lines.push('', `Still unexplained over the whole piece, ${measureText(leftIn(S.result))}.`);
    return lines.join('\n');
  };

  const buildPrompt = (ann, mode) => {
    const scope = ann.scope;
    const bars = S.bars.map((bar) => `${bar.n}:${bar.from}`).join(' ');
    const picked = scope.kind === 'piece' ? [] : scope.ids;
    const how =
      scope.kind === 'piece'
        ? 'selected nothing, so speaks about the whole piece'
        : scope.kind === 'span'
          ? 'drew a bracket over a passage, both hands, every note in it'
          : scope.kind === 'arrow'
            ? 'drew an arrow from one note to another, a direction: the playing sets out at the first and makes for the last'
          : scope.kind === 'box'
            ? 'drew a box round some of the notes of a passage'
            : `picked ${picked.length === 1 ? 'one note' : 'these notes'}`;
    const sections = [
      S.knowledge,
      '# THE PIECE',
      `${S.piece.title}`,
      `Resolution: ${PPQ} ticks per quarter note. Time signatures: ${JSON.stringify(S.result.timeSignatures)}. The score ends at tick ${S.result.end}.`,
      `Bars as "number:first tick" (bar 0 is the upbeat): ${bars}`,
      'Hands: R is part 1 (scope 0, upper staff), L is part 2 (scope 1, lower staff). Bars 9–16 are the written-out repeat of bars 1–8 (ids ending in -rend2).',
      '',
      '## Every note, with what the chain as it stands leaves unexplained',
      'onset_ms and sounds_ms are the recording (ms from the first note); velocity is the recording. The three left_ columns are the recording less what the MPM as it stands renders, the rendering being laid against the recording wherever a tempo begins on a chord: left_late_ms the onset (positive: played later than the MPM has it), left_loud the velocity, left_long_ms the sounded length.',
      noteTable(),
      '',
      '## Pedal presses as recorded (ms from the first note)',
      pedalTable(),
      '',
      '## Grace-note groups as recorded (a principal that is not in the note table is struck only as the grace note tied into it)',
      graceTable(),
      '',
      '# WHAT HAS BEEN DESCRIBED SO FAR',
      stateText(ann),
      '',
      '# THE REMARK TO TRANSLATE',
      `The reader ${how}: ${scope.label}.`,
      `Ticks: from ${scope.from} (first selected onset) to ${scope.to} (the next onset in the score after the last selected one${scope.kind === 'piece' ? '; here the end of the score' : ''}).`,
      scope.kind === 'arrow' ? `The arrow runs from note ${picked[0]} to note ${picked[1]}, whose chord is the last before tick ${scope.to}; its passage is every note from tick ${scope.from} up to tick ${scope.to}, both hands.` : picked.length ? `Selected note ids: ${picked.join(' ')}` : '',
      `Before your calls, what is left in the passage, ${measureText(leftIn(S.result, idsOf(scope)))}.`,
      '',
      `The remark, verbatim: """${ann.text}"""`,
    ];
    if (ann.thread && ann.thread.length) {
      sections.push('', '# WHAT YOU ASKED, AND WHAT THE READER ANSWERED');
      for (const turn of ann.thread) sections.push(`You asked: ${turn.question}`, `The reader answered: """${turn.answer}"""`);
      sections.push('Translate the remark in the light of the answer.');
    }
    if (mode === 'repair' && ann.calls.length) {
      sections.push(
        '',
        '# YOUR EARLIER ANSWER, WHICH NEEDS MENDING',
        `Calls: ${JSON.stringify(ann.calls)}`,
        ann.report && ann.report.errors.length ? `What the chain said: ${ann.report.errors.map((e) => `call ${e.index} (${ann.calls[e.index] ? ann.calls[e.index].name : '?'}): ${e.message}`).join(' | ')}` : '',
        'Answer again with calls that run.',
      );
    }
    sections.push(
      '',
      '# ANSWER',
      S.tools
        ? 'Check your calls with try_calls before you answer, as the section "What is left, and the tool that tells you" says: three tries at most.'
        : 'You have no try_calls here, so keep to option shapes you are sure of.',
      'Then reply with one JSON object and nothing else, in exactly this shape:',
      '{"calls": [{"name": "<transformer or DescribeIt step>", "options": { ... }}],',
      ' "question": null}',
      'Leave "calls" empty and put one short question in "question", in the language of the remark, only when the remark cannot be translated without knowing more.',
    );
    return sections.filter((line) => line !== undefined).join('\n');
  };

  const parseAnswer = (text) => {
    const candidates = [];
    const last = text.lastIndexOf('}');
    // With the tool the answer is the last object written, after whatever was said on the way.
    const tail = text.lastIndexOf('{"calls"');
    if (tail !== -1 && last > tail) candidates.push(text.slice(tail, last + 1));
    const fence = /```(?:json)?\s*([\s\S]*?)```/g;
    let match;
    while ((match = fence.exec(text))) candidates.push(match[1]);
    const first = text.indexOf('{');
    if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
    for (const candidate of candidates) {
      try {
        const value = JSON.parse(candidate);
        if (value && typeof value === 'object' && ('calls' in value || 'question' in value)) return value;
      } catch {
        // try the next way of reading it
      }
    }
    return null;
  };

  /** The first elements a call wrote, and the definitions those name. */
  const shownOf = (report) => {
    const first = report.written.filter(Boolean).slice(0, 8);
    const names = new Set(first.map((tag) => (/\sname\.ref="([^"]+)"/.exec(tag) || [])[1]).filter(Boolean));
    const definitions = (report.definitions || []).filter((definition) => names.has((/\sname="([^"]+)"/.exec(definition) || [])[1]));
    return [...first, ...definitions.slice(0, 8)];
  };

  const tryTool = (ann) => ({
    name: 'try_calls',
    description:
      'Runs the fitting chain with your calls added to everything already described, keeping nothing. Returns per call an error, or what it wrote (counts by MPM element, and the first elements themselves with their fitted attributes) and what a fitted step read off the recording; then pulse_ms, spread_ms, velocity and length_ms left in the passage and in the piece, before and after.',
    inputSchema: {
      type: 'object',
      properties: { calls: { type: 'array', description: 'The calls, each {name, options}', items: { type: 'object' } } },
      required: ['calls'],
    },
    execute: async (input) => {
      const calls = Array.isArray(input.calls) ? input.calls : [];
      if (calls.some((call) => !call || typeof call.name !== 'string')) throw new Error('each call needs a "name" and "options"');
      ann.progress = `Trying ${calls.length} ${calls.length === 1 ? 'step' : 'steps'} on the roll…`;
      if (S.openAnn === ann) renderPop();
      const mine = calls.map((call, index) => ({ id: `try:${index}`, name: call.name, options: call.options || {} }));
      const result = await Engine.run([...stepsOf(S.anns.filter((other) => other !== ann)), ...mine]);
      const ids = idsOf(ann.scope);
      return {
        calls: result.calls
          .filter((report) => report.id.startsWith('try:'))
          .map((report) => {
            const index = Number(report.id.slice(4));
            if (report.error) return { call: index, name: calls[index].name, error: report.error };
            const fitted = report.fitted || [];
            return {
              call: index,
              name: calls[index].name,
              wrote: kinds(report).map(([kind, count]) => `${kind} x${count}`),
              written: shownOf(report),
              ...(report.elements.length > 8 ? { written_shown: `8 of ${report.elements.length} elements, with the definitions they name` } : {}),
              ...(fitted.length ? { fitted: fitted.slice(0, 48).map(fittedLine), ...(fitted.length > 48 ? { fitted_shown: `48 of ${fitted.length}` } : {}) } : {}),
              fitted_to_notes: report.evidence.length,
            };
          }),
        left_in_passage: { before: measures(leftIn(S.result, ids)), after: measures(leftIn(result, ids)) },
        left_in_piece: { before: measures(leftIn(S.result)), after: measures(leftIn(result)) },
      };
    },
  });

  const translate = async (ann, mode) => {
    const controller = new AbortController();
    ann.status = 'pending';
    ann.abort = controller;
    ann.failure = null;
    const asked = ann.question;
    ann.question = null;
    renderAll();
    try {
      const options = { ...EXPERT, signal: controller.signal };
      if (S.tools) options.tools = [tryTool(ann)];
      else options.cache = false;
      const { text } = await S.sample(buildPrompt(ann, mode), options);
      const answer = parseAnswer(text);
      if (!answer) throw { code: 'invalid_json' };
      ann.model = EXPERT.model;
      ann.question = typeof answer.question === 'string' && answer.question.trim() ? answer.question : null;
      const calls = Array.isArray(answer.calls) ? answer.calls.filter((call) => call && typeof call.name === 'string') : [];
      ann.calls = calls.map((call) => ({ name: call.name, options: call.options && typeof call.options === 'object' ? call.options : {} }));
      ann.status = 'done';
      ann.abort = null;
      await apply(ann);
    } catch (error) {
      ann.status = 'done';
      ann.abort = null;
      ann.question = asked;
      if (error && error.code === 'cancelled') ann.failure = 'Stopped before an answer came.';
      else ann.failure = (error && COPY[error.code]) || COPY.upstream_error;
      if (error && (error.code === 'not_granted' || error.code === 'sampling_disabled')) S.sample = null;
      if (error && !error.code) console.error(error);
      save();
      renderAll();
    }
  };

  /** Remarks are read one at a time, in the order they were written. */
  const pump = async () => {
    if (S.working) return;
    const next = S.queue.shift();
    if (!next) {
      renderAll();
      return;
    }
    S.working = next.ann;
    renderAll();
    try {
      await translate(next.ann, next.mode);
    } finally {
      S.working = null;
      pump();
    }
  };

  /** Settled once the viewer has said whether the expert can be asked here. */
  let expertKnown;
  const whenExpertKnown = new Promise((resolve) => (expertKnown = resolve));

  const enqueue = async (ann, mode) => {
    // A remark written in the first moment of the page waits to hear whether there is an expert.
    if (!S.sampleAsked) await whenExpertKnown;
    if (!S.anns.includes(ann)) return;
    if (!S.sample) {
      ann.failure = 'Not translated: the expert answers when this page is open in Claude. Its calls can still be written by hand.';
      save();
      renderAll();
      return;
    }
    if (S.working === ann || S.queue.some((entry) => entry.ann === ann)) return;
    S.queue.push({ ann, mode });
    renderAll();
    pump();
  };

  /** Run the chain with a remark's calls in it, and note what it took off what is left. */
  const apply = async (ann, unsaved) => {
    const ids = idsOf(ann.scope);
    const before = S.result ? leftIn(S.result, ids) : null;
    ann.enabled = true;
    await refit();
    if (before && S.result) {
      const after = leftIn(S.result, ids);
      ann.delta = { pulse: before.pulse - after.pulse, chords: before.chords - after.chords, loud: before.loud - after.loud, length: before.length - after.length };
    }
    if (!unsaved) save();
    renderAll();
  };

  const describe = () => {
    const text = penText.value.trim();
    if (!text || !S.result || S.reference) return;
    const editing = S.pen.editing;
    if (editing) {
      // The same remark in other words: what the old words became goes with them.
      const changed = editing.text !== text;
      editing.text = text;
      closePen();
      if (changed || !editing.calls.length) {
        editing.calls = [];
        editing.date = new Date().toISOString();
        editing.question = null;
        editing.thread = null;
        editing.delta = null;
        editing.example = false;
        save();
        refit().then(() => enqueue(editing, 'new'));
      }
      return;
    }
    const ann = {
      id: `r${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
      text,
      scope: scopeNow(),
      status: 'done',
      calls: [],
      enabled: true,
      date: new Date().toISOString(),
    };
    S.anns.push(ann);
    closePen();
    save();
    enqueue(ann, 'new');
    canvas.focus({ preventScroll: true });
  };

  // ------------------------------------------------------------------------------------------
  // Keeping, and the rest of the controls
  // ------------------------------------------------------------------------------------------

  const save = () => {
    try {
      const anns = S.anns.map(({ id, text, scope, calls, enabled, model, date, question, thread, delta, example, failure }) => ({ id, text, scope, calls, enabled, model, date, question, thread, delta, example, failure }));
      localStorage.setItem(STORE, JSON.stringify({ anns }));
    } catch {
      // Without storage the remarks last as long as the page does.
    }
  };
  const restore = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (stored && Array.isArray(stored.anns)) return stored.anns.map((ann) => ({ ...ann, status: 'done', calls: ann.calls || [] }));
    } catch {
      // Nothing kept, or nothing readable.
    }
    return null;
  };

  const renderAll = () => {
    renderMeters();
    renderHint();
    if (S.openAnn) {
      if (S.anns.includes(S.openAnn)) renderPop();
      else closePop();
    }
    if (!$('#drawer').hidden) renderMpm();
    layout();
    draw();
  };

  const setReference = async (on) => {
    if (on && !S.refCalls) {
      try {
        S.refCalls = await (await fetch('reference.json')).json();
      } catch {
        notice('The published reconstruction could not be loaded.');
        return;
      }
    }
    S.reference = on;
    S.hoverAnn = null;
    closePop();
    if (S.pen.open) closePen();
    renderAll();
    refit();
  };

  $('#refBtn').addEventListener('click', () => {
    closeMenu();
    setReference(!S.reference);
  });
  $('#ghostBtn').addEventListener('click', () => {
    S.view.shadows = !S.view.shadows;
    closeMenu();
    draw();
  });
  $('#clearBtn').addEventListener('click', () => {
    closeMenu();
    if (!S.anns.length) return;
    const before = [...S.anns];
    for (const ann of S.anns) if (ann.abort) ann.abort.abort();
    S.anns = [];
    S.queue = [];
    closePop();
    save();
    refit();
    notice(`Removed ${before.length} ${before.length === 1 ? 'remark' : 'remarks'}.`, () => {
      S.anns = before;
      S.notice = null;
      save();
      refit();
    });
  });
  // Where the frame the page is shown in allows it, the roll can have the whole screen.
  if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
    $('#fullBtn').hidden = false;
    $('#fullBtn').addEventListener('click', () => {
      closeMenu();
      const asked = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      Promise.resolve(asked).catch(() => notice('The roll cannot have the whole screen here.'));
    });
    document.addEventListener('fullscreenchange', () => ($('#fullState').textContent = document.fullscreenElement ? 'on' : 'off'));
  }
  const VIEW = 'describeit.view';
  try {
    const kept = JSON.parse(localStorage.getItem(VIEW) || 'null');
    if (kept && Number.isFinite(kept.height)) S.view.height = clamp(kept.height, 0.25, 4);
  } catch {
    // Nothing kept: the heights are the usual ones.
  }
  const setHeight = (factor) => {
    S.view.height = clamp(S.view.height * factor, 0.25, 4);
    try {
      localStorage.setItem(VIEW, JSON.stringify({ height: S.view.height }));
    } catch {
      // It lasts as long as the page does.
    }
    draw();
  };
  $('#lowerBtn').addEventListener('click', () => setHeight(1 / 1.25));
  $('#higherBtn').addEventListener('click', () => setHeight(1.25));
  $('#zoomIn').addEventListener('click', () => zoom(1.3));
  $('#zoomOut').addEventListener('click', () => zoom(1 / 1.3));
  $('#zoomFit').addEventListener('click', fit);
  $('#pencilBtn').addEventListener('click', (event) => {
    S.view.pencil = !S.view.pencil;
    event.currentTarget.setAttribute('aria-pressed', String(S.view.pencil));
    canvas.classList.toggle('pencil', S.view.pencil);
    notice(S.view.pencil ? 'Drag a finger across the roll to bracket a passage. Tap ✎ again to scroll.' : 'Scrolling again. Tap a note to write about it.');
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);
    if (event.key === 'Escape') {
      if (!$('#menu').hidden) closeMenu();
      else if (!$('#legend').hidden) setLegend(false);
      else if (S.openAnn) closePop();
      else if (S.pen.open) closePen();
      else if (!$('#drawer').hidden) setDrawer(false);
      return;
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey || !S.result) return;
    if (target && target.tagName === 'BUTTON' && (event.key === ' ' || event.key === 'Enter')) return;
    // Space plays and stops, unless a remark is being written, where it is a space.
    if (event.key === ' ' && !S.pen.open) {
      event.preventDefault();
      Player.toggle();
      return;
    }
    if (S.reference) return;
    // Anything typed with nothing else in hand is the start of a remark.
    if (event.key.length === 1 && (event.key !== ' ' || S.pen.open)) {
      event.preventDefault();
      if (!S.pen.open) openPen(event.key);
      else {
        penText.value += event.key;
        penText.focus();
        growPen();
        renderPenUnder();
      }
    }
  });
  // A button clicked with the mouse hands the keys back to the roll, so that Space still plays.
  document.addEventListener('click', (event) => {
    if (event.detail > 0 && event.target.closest('.top button, .foot button, .menu button')) (S.pen.open ? penText : canvas).focus({ preventScroll: true });
  });
  document.addEventListener('pointerdown', (event) => {
    if (!$('#menu').hidden && !event.target.closest('#menu') && !event.target.closest('#menuBtn')) closeMenu();
    if (!$('#legend').hidden && !event.target.closest('#legend') && !event.target.closest('#meters')) setLegend(false);
    if (S.openAnn && !event.target.closest('#pop') && !event.target.closest('#roll') && !event.target.closest('#drawer') && !event.target.closest('#mpmBtn') && !event.target.closest('.foot')) closePop();
  });

  // ------------------------------------------------------------------------------------------
  // Start
  // ------------------------------------------------------------------------------------------

  const start = async () => {
    readPalette();
    new ResizeObserver(resize).observe(scroller);
    if (document.fonts && document.fonts.load) {
      Promise.all([document.fonts.load('500 14.5px "Source Serif 4"'), document.fonts.load('italic 400 14px "Source Serif 4"'), document.fonts.ready]).then(draw, draw);
    }
    if (matchMedia('(pointer: coarse)').matches) $('#pencilBtn').hidden = false;

    try {
      const [piece, knowledge, examples] = await Promise.all([
        fetch('piece.json').then((r) => r.json()),
        fetch('knowledge.txt').then((r) => r.text()),
        fetch('examples.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
      ]);
      S.piece = piece;
      S.knowledge = knowledge;
      for (const note of piece.alignment.allNotes) S.score.set(note['xml:id'], note);
      S.firstMs = Math.min(...piece.alignment.allNotes.map((n) => n['milliseconds.date']));
      const pitches = [...piece.alignment.allNotes, ...piece.alignment.graces].map((n) => n['midi.pitch']);
      // The keys the piece uses, and no others.
      G.lo = Math.min(...pitches);
      G.hi = Math.max(...pitches);

      S.base = await Engine.run([]);
      index(S.base);
      S.bars = buildBars(S.base.timeSignatures, S.base.end);
      // The scale of loudness: a note in the loudest twentieth stands four rows tall.
      S.level = S.base.level;
      // The scale of loudness: the loudest fiftieth of the notes stand three rows tall.
      const velocities = S.base.notes.map((n) => n.velocity).sort((a, b) => a - b);
      const loudest = velocities[Math.floor(velocities.length * 0.98)];
      G.perOctave = 2 / Math.max(0.15, Math.log2(Math.max(loudest, S.level + 1) / S.level));
      S.result = S.base;

      const kept = restore();
      $('#loading').hidden = true;
      resize();
      // Some three quarters of a minute across the roll: eight or nine bars of this piece.
      S.view.ppt = clamp((G.width - G.gutter) / 45000, 0.012, 0.05);
      if (kept) {
        S.anns = kept;
        renderAll();
        if (S.anns.some((ann) => ann.calls.length)) await refit();
      } else {
        // The examples, applied one after the other, so that each shows what it took off.
        for (const [i, example] of examples.entries()) {
          const ann = { ...example, id: `example${i}`, status: 'done', enabled: true, example: true };
          S.anns.push(ann);
          await apply(ann, true);
        }
        renderAll();
      }
    } catch (error) {
      console.error(error);
      $('#loading').hidden = false;
      $('#loading').textContent = 'The roll could not be loaded. Reload the page to try again.';
      return;
    }

    // The expert and the save dialog arrive when the viewer has answered, and may never.
    if (window.claude && typeof window.claude.use === 'function') {
      window.claude.use('sample').then(async (sample) => {
        S.sample = sample || null;
        if (sample && typeof sample.limits === 'function') {
          const limits = await sample.limits().catch(() => null);
          S.tools = Boolean(limits && limits.tools);
        }
        S.sampleAsked = true;
        expertKnown();
        renderAll();
      });
      window.claude.use('downloads').then((downloads) => {
        S.downloads = downloads || null;
        $('#saveMpm').hidden = $('#saveWork').hidden = !downloads;
      });
    } else {
      S.sampleAsked = true;
      expertKnown();
      renderHint();
    }
  };

  // For a test that drives the page: handed the state and the few verbs a reader has.
  if (typeof window.__describeItTest === 'function') window.__describeItTest({ S, G, select, describe, refit, apply, Engine, openPop, buildPrompt, tryTool, Player });

  start();
})();
