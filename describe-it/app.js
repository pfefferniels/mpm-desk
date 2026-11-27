/* DescribeIt: the page. The fitting is `engine.js`; this draws what it leaves, takes down what a
   reader writes on the roll, and asks the expert what it means. */
/* global window, document, console, localStorage, fetch, navigator, performance, Worker, AbortController, ResizeObserver, getComputedStyle, getSelection, matchMedia, requestAnimationFrame, setTimeout, clearTimeout */
(() => {
  'use strict';

  const PPQ = 720;
  const STORE = 'describeit.v2';
  const EXPERT = { model: 'claude-opus-5-5', modelTier: 'complex' };
  const TONES = 6;
  const LANE = 24;
  const RULER = 18;

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
    selKind: 'none', // none (the whole piece) | notes | span | box
    pen: { open: false, editing: null },
    level: 64, // the velocity drawn one row tall
    view: { ppt: 0.03, shadows: true, pencil: false },
    hoverAnn: null,
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

  const callsOf = (anns) =>
    anns
      .filter((ann) => ann.enabled && ann.calls && ann.calls.length)
      .flatMap((ann) => ann.calls.map((call, index) => ({ id: `${ann.id}:${index}`, name: call.name, options: call.options || {} })));

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
    const calls = S.reference ? S.refCalls : callsOf(S.anns);
    try {
      const result = await Engine.run(calls);
      if (token !== fitToken) return;
      if (S.result && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        S.tween = { from: new Map(S.result.notes.map((note) => [note.id, note.mpm])), beats: new Map(S.result.beats.map((beat) => [beat.date, beat.ms])), start: performance.now(), t: 0 };
      }
      S.result = result;
      index(result);
      for (const ann of S.anns) ann.report = reportOf(ann, result);
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

  /**
   * The two ways from a date of the score to the roll's clock: when it was played, through the
   * chords of the recording, and when the tempo as it stands has it, through the beats the
   * engine placed.
   */
  const index = (result) => {
    const byDate = new Map();
    for (const note of result.notes) {
      const list = byDate.get(note.date);
      if (list) list.push(note.ms);
      else byDate.set(note.date, [note.ms]);
    }
    const dates = [...byDate.keys()].sort((a, b) => a - b);
    result.dates = dates;
    result.played = dates.map((date) => {
      const list = byDate.get(date).sort((a, b) => a - b);
      return list[list.length >> 1];
    });
    result.beatDates = result.beats.map((beat) => beat.date);
    result.beatMs = result.beats.map((beat) => beat.ms);
    result.total = result.notes.reduce((max, note) => Math.max(max, note.msEnd), result.beatMs[result.beatMs.length - 1] || 0);
    result.byId = new Map(result.notes.map((note) => [note.id, note]));
  };

  /** When a date of the score was played. */
  const playedAt = (result, date) => along(result.dates, result.played, date);
  /** When the tempo as it stands has a date of the score: on its way there, for a moment after a run. */
  const encodedAt = (result, date) => {
    const now = along(result.beatDates, result.beatMs, date);
    const was = S.tween ? S.tween.beats.get(date) : undefined;
    return was === undefined ? now : was + (now - was) * S.tween.t;
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
  /** The notes a remark is about, which is where its effect is measured. */
  const idsOf = (scope) => {
    if (scope.kind === 'piece') return [];
    if (scope.kind === 'span') return S.base.notes.filter((note) => note.date >= scope.from && note.date < scope.to).map((note) => note.id);
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
  const G = { gutter: 34, lanes: 1, top: 50, bottom: 8, width: 0, height: 0, rowH: 8, lo: 36, hi: 84, k: 6, rects: [], marks: [], penAt: null, promptRow: null };
  let palette = {};

  const readPalette = () => {
    const style = getComputedStyle(document.documentElement);
    const get = (name) => style.getPropertyValue(name).trim();
    palette = {
      roll: get('--roll'), band: get('--band'), grid: get('--grid'), ink: get('--ink'), ink2: get('--ink-2'), ink3: get('--ink-3'),
      rh: get('--rh'), lh: get('--lh'), grace: get('--grace'), ghost: get('--ghost'), pencil: get('--pencil'), raised: get('--raised'), line: get('--line'),
      accent: get('--accent'), bad: get('--bad'), apart: get('--apart'), tones: Array.from({ length: TONES }, (_, i) => get(`--c${i + 1}`)),
      font: get('--font') || 'sans-serif', mono: get('--mono') || 'monospace', hand: get('--hand') || 'cursive',
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
    G.rowH = Math.max(3, (G.height - G.top - G.bottom) / (G.hi - G.lo + 1));
  };

  // The roll is laid out on the recording's clock: `ppt` is pixels to the millisecond.
  const X = (ms) => G.gutter + ms * S.view.ppt - scroller.scrollLeft;
  const msOf = (px) => (px - G.gutter + scroller.scrollLeft) / S.view.ppt;
  const Y = (pitch) => G.top + (G.hi - pitch + 0.5) * G.rowH;
  /** How tall a velocity is drawn: one row at the level, doubling every `k` above it. */
  const tall = (velocity) => G.rowH * Math.min(7, Math.max(0.34, 2 ** ((velocity - S.level) / G.k)));
  /** A note as it was played. It stays where it is: the recording is what everything is held against. */
  const rectOf = (note) => {
    const h = tall(note.velocity);
    return { x: X(note.ms), y: Y(note.pitch) - h / 2, w: Math.max(2, (note.msEnd - note.ms) * S.view.ppt), h };
  };
  /**
   * The same note as the MPM as it stands sounds it: where the run has it, or, for a moment
   * after a run, on its way there from where the run before had it. What a remark did is seen
   * as the encoding going to the playing, or failing to.
   */
  const encodedOf = (note) => {
    const from = S.tween ? S.tween.from.get(note.id) : null;
    const t = S.tween ? S.tween.t : 1;
    const mix = (key) => (from ? from[key] + (note.mpm[key] - from[key]) * t : note.mpm[key]);
    const h = tall(mix('velocity'));
    return { x: X(mix('ms')), y: Y(note.pitch) - h / 2, w: Math.max(2, (mix('msEnd') - mix('ms')) * S.view.ppt), h };
  };
  /** The box round a set of notes, where they now stand. */
  const boxOf = (ids) => {
    let box = null;
    for (const id of ids) {
      const note = S.result.byId.get(id);
      if (!note) continue;
      const r = rectOf(note);
      box = box
        ? { x0: Math.min(box.x0, r.x), y0: Math.min(box.y0, r.y), x1: Math.max(box.x1, r.x + r.w), y1: Math.max(box.y1, r.y + r.h) }
        : { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h };
    }
    return box;
  };

  const rounded = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  };
  const toneOf = (ann) => palette.tones[ann.tone % TONES];
  const hasTrouble = (ann) => Boolean(ann.failure || (ann.report && ann.report.errors.length));
  const shown = (text) => (text.length > 64 ? `${text.slice(0, 62)}…` : text.replace(/\s+/g, ' '));

  /** A remark as it stands on the roll: the reader's words in their own hand, and how it fared. */
  const drawLabel = (ann, x, y, halo) => {
    const text = shown(ann.text);
    ctx.font = `600 18px ${palette.hand}`;
    ctx.textBaseline = 'middle';
    const width = ctx.measureText(text).width;
    const pending = ann.status === 'pending' || S.queue.some((entry) => entry.ann === ann);
    const lit = S.hoverAnn === ann || S.openAnn === ann;
    if (halo) {
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = palette.roll;
      ctx.globalAlpha = 0.92;
      ctx.strokeText(text, x, y);
    }
    ctx.globalAlpha = S.reference ? 0.35 : pending ? 0.45 + 0.3 * Math.sin(performance.now() / 260) : 1;
    ctx.fillStyle = ann.enabled ? toneOf(ann) : palette.ink3;
    ctx.fillText(text, x, y);
    if (!ann.enabled) {
      ctx.strokeStyle = palette.ink3;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + 1);
      ctx.lineTo(x + width, y + 1);
      ctx.stroke();
    }
    if (lit) {
      ctx.strokeStyle = toneOf(ann);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + 9.5);
      ctx.lineTo(x + width, y + 9.5);
      ctx.stroke();
    }
    let extra = 0;
    const badge = pending ? null : ann.question ? '?' : hasTrouble(ann) ? '!' : null;
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
      extra = 20;
    }
    ctx.globalAlpha = 1;
    G.marks.push({ ann, x: x - 3, y: y - 11, w: width + extra + 6, h: 22 });
    return width + extra;
  };

  const widthOfLabel = (text) => {
    ctx.font = `600 18px ${palette.hand}`;
    return ctx.measureText(shown(text)).width;
  };

  /** A bracket over a stretch of the roll: a line with a tick down at each end. */
  const bracket = (xa, xb, y, color, dashed) => {
    const a = Math.max(xa, G.gutter - 4);
    const b = Math.min(xb, G.width + 4);
    if (b <= a) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(dashed ? [4, 3] : []);
    ctx.beginPath();
    if (xa >= G.gutter - 4) {
      ctx.moveTo(xa + 0.75, y + 5);
      ctx.lineTo(xa + 0.75, y);
    } else ctx.moveTo(a, y);
    ctx.lineTo(b, y);
    if (xb <= G.width + 4) ctx.lineTo(xb - 0.75, y + 5);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  /** Four corners round some notes: a box drawn the way one is pencilled, not ruled. */
  const corners = (box, color, dashed) => {
    const pad = 5;
    const x0 = box.x0 - pad;
    const y0 = box.y0 - pad;
    const x1 = box.x1 + pad;
    const y1 = box.y1 + pad;
    const arm = Math.min(12, (x1 - x0) / 3, (y1 - y0) / 3);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(dashed ? [4, 3] : []);
    ctx.beginPath();
    for (const [cx, cy, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      ctx.moveTo(cx + dx * arm, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + dy * arm);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    return { x0, y0, x1, y1 };
  };

  /**
   * Which remarks stand in the lanes above the notes, and where.
   *
   * What was said of the whole piece is written along the top, one remark after the other, and
   * stays in view however the roll is scrolled. What was said of a stretch stands over it.
   */
  const lanesOf = () => {
    const whole = [];
    let x = G.gutter + 8;
    let row = 0;
    for (const ann of S.anns) {
      if (ann.scope.kind !== 'piece') continue;
      const w = widthOfLabel(ann.text) + 22;
      if (x + w > G.width - 8 && x > G.gutter + 8) {
        row++;
        x = G.gutter + 8;
      }
      whole.push({ ann, x, row });
      x += w + 18;
    }
    const wholeRows = whole.length ? row + 1 : 0;

    const rows = [];
    const placed = [];
    for (const ann of S.anns) {
      if (ann.scope.kind !== 'span' || S.pen.editing === ann) continue;
      const a = playedAt(S.result, ann.scope.from);
      const b = playedAt(S.result, ann.scope.to);
      const reach = Math.max(b, a + (widthOfLabel(ann.text) + 40) / S.view.ppt);
      let at = rows.findIndex((endsAt) => endsAt <= a - 2 / S.view.ppt);
      if (at === -1) {
        at = rows.length;
        rows.push(reach);
      } else rows[at] = reach;
      placed.push({ ann, a, b, row: wholeRows + at });
    }
    return { whole, wholeRows, placed, rows: wholeRows + rows.length };
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
    const wanted = Math.min(lanes.rows + 1, 9);
    if (wanted !== G.lanes) {
      G.lanes = wanted;
      layout();
    }
    const top = G.top;
    const bottom = height - G.bottom;
    const editing = S.pen.editing;
    const draft = S.pen.open && !editing ? scopeNow() : null;

    // The keys: black ones a shade apart, and a line under every C.
    ctx.fillStyle = palette.band;
    for (let pitch = G.lo; pitch <= G.hi; pitch++) {
      if ([1, 3, 6, 8, 10].includes(pitch % 12)) ctx.fillRect(G.gutter, Y(pitch) - G.rowH / 2, width - G.gutter, G.rowH);
    }
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
      const a = Math.max(G.gutter, X(playedAt(result, draft.from)));
      const b = Math.min(width, X(playedAt(result, draft.to)));
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

    // The notes, as they were played.
    const lit = S.hoverAnn || S.openAnn;
    const evidence = lit && lit.report && lit.report.evidence.size ? lit.report.evidence : lit ? new Set(idsOf(lit.scope)) : null;
    // While a remark is being written about some notes, the others stand back.
    const chosen = !lit && draft && draft.kind !== 'piece' ? S.selection : null;
    const dimmed = (id) => (evidence && evidence.size ? !evidence.has(id) : chosen ? !chosen.has(id) : false);
    // A note the reader has corrected keeps the roll's own value behind it, dashed.
    ctx.lineWidth = 1;
    ctx.strokeStyle = palette.ghost;
    ctx.fillStyle = palette.ghost;
    ctx.setLineDash([2, 2]);
    for (const note of result.notes) {
      if (!note.arrived) continue;
      const was = rectOf({ ...note, ...note.arrived });
      if (was.x + was.w < G.gutter || was.x > width) continue;
      ctx.globalAlpha = dimmed(note.id) ? 0.04 : 0.1;
      rounded(was.x, was.y, was.w, was.h, 2);
      ctx.fill();
      ctx.globalAlpha = dimmed(note.id) ? 0.14 : 0.5;
      rounded(was.x + 0.5, was.y + 0.5, was.w - 1, was.h - 1, 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Louder notes underneath, so that a soft one over a loud one can still be seen and picked.
    for (const note of [...result.notes].sort((a, b) => b.loud - a.loud)) {
      const r = rectOf(note);
      if (r.x + r.w < G.gutter || r.x > width) continue;
      const dim = dimmed(note.id);
      ctx.globalAlpha = dim ? (chosen ? 0.3 : 0.16) : 0.74;
      ctx.fillStyle = note.part === 1 ? palette.rh : palette.lh;
      rounded(r.x, r.y, r.w, r.h, 2.5);
      ctx.fill();
      // The onset, a darker edge: what makes a chord read as lined up, or not.
      ctx.globalAlpha = dim ? (chosen ? 0.4 : 0.2) : 0.95;
      ctx.fillRect(r.x, r.y, Math.min(2, r.w), r.h);
      G.rects.push({ note, ...r });
    }
    ctx.globalAlpha = 1;

    // Over each note, what the MPM as it stands makes of it, in pencil: a stroke where it has the
    // note begin, as tall as it has it loud, and a line as long as it has it last. Where the
    // encoding has a note as it was played there is nothing to draw, so what is on the roll is
    // where the two run apart; and the further apart, the fainter, a rendering half a bar from
    // its note being no use in finding it.
    if (S.view.shadows) {
      ctx.strokeStyle = palette.pencil;
      for (const note of result.notes) {
        const now = rectOf(note);
        const enc = encodedOf(note);
        if (Math.max(now.x + now.w, enc.x + enc.w) < G.gutter || Math.min(now.x, enc.x) > width) continue;
        const dx = Math.abs(enc.x - now.x);
        const dh = Math.abs(enc.h - now.h);
        const dw = Math.abs(enc.x + enc.w - (now.x + now.w));
        if (dx < 1.5 && dh < 1 && dw < 2.5) continue;
        const near = clamp(1 - dx / 240, 0.22, 1) * (dimmed(note.id) ? 0.3 : 1);
        const y = Y(note.pitch);
        const x0 = Math.round(enc.x) + 0.5;
        if (dx >= 1.5) {
          // How far apart the two begin, in red: the thing to be corrected.
          ctx.strokeStyle = palette.apart;
          ctx.globalAlpha = 0.85 * near;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(now.x, Math.round(y) + 0.5);
          ctx.lineTo(enc.x, Math.round(y) + 0.5);
          ctx.stroke();
          ctx.strokeStyle = palette.pencil;
        }
        if (dx >= 1.5 || dw >= 2.5) {
          ctx.globalAlpha = 0.4 * near;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x0, Math.round(y) + 0.5);
          ctx.lineTo(enc.x + enc.w, Math.round(y) + 0.5);
          ctx.moveTo(Math.round(enc.x + enc.w) + 0.5, y - 2.5);
          ctx.lineTo(Math.round(enc.x + enc.w) + 0.5, y + 2.5);
          ctx.stroke();
        }
        if (dx >= 1.5 || dh >= 1) {
          ctx.globalAlpha = 0.9 * near;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x0, y - enc.h / 2);
          ctx.lineTo(x0, y + enc.h / 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
    }

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

    // Remarks about some of the notes stand among them: corners round a group, a stroke to one.
    const among = (scope, color, dashed) => {
      const box = boxOf(scope.ids);
      if (!box) return null;
      if (scope.kind === 'box' || scope.ids.length > 3) return corners(box, color, dashed);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      for (const id of scope.ids) {
        const note = result.byId.get(id);
        if (!note) continue;
        const r = rectOf(note);
        rounded(r.x - 2, r.y - 2, r.w + 4, r.h + 4, 4);
        ctx.stroke();
      }
      return { x0: box.x0 - 2, y0: box.y0 - 2, x1: box.x1 + 2, y1: box.y1 + 2 };
    };
    const labelSpot = (frame) => ({
      x: clamp(frame.x0 + 1, G.gutter + 6, width - 60),
      y: frame.y0 - 13 < top + 10 ? frame.y1 + 13 : frame.y0 - 13,
    });
    // The pen goes where the label will stand, and grows away from the notes it is about, so
    // that none of them is under it: they may still have to be clicked.
    const penSpot = (frame) => {
      const spot = labelSpot(frame);
      return spot.y < frame.y0 ? { x: spot.x, y: frame.y0 - 1, grows: 'up' } : { x: spot.x, y: frame.y1 + 2, grows: 'down' };
    };
    if (!S.reference) {
      for (const ann of S.anns) {
        if (ann.scope.kind !== 'box' && ann.scope.kind !== 'notes') continue;
        const active = S.hoverAnn === ann || S.openAnn === ann;
        ctx.globalAlpha = ann.enabled ? (active ? 1 : 0.8) : 0.4;
        const frame = among(ann.scope, ann.enabled ? toneOf(ann) : palette.ink3, false);
        ctx.globalAlpha = 1;
        if (!frame || frame.x1 < G.gutter || frame.x0 > width) continue;
        const spot = labelSpot(frame);
        if (editing === ann) G.penAt = penSpot(frame);
        else drawLabel(ann, spot.x, spot.y, true);
      }
    }
    if (draft && (draft.kind === 'box' || draft.kind === 'notes')) {
      const frame = among(draft, palette.pencil, true);
      if (frame) G.penAt = penSpot(frame);
    }
    if (drag && drag.kind === 'band' && drag.moved) {
      const x = Math.min(drag.x0, drag.x1);
      const y = Math.min(drag.y0, drag.y1);
      const w = Math.abs(drag.x1 - drag.x0);
      if (drag.flat) {
        ctx.fillStyle = palette.pencil;
        ctx.globalAlpha = 0.06;
        ctx.fillRect(x, top, w, bottom - top);
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = palette.pencil;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x + 0.5, y + 0.5, w, Math.abs(drag.y1 - drag.y0));
        ctx.setLineDash([]);
      }
    }

    // Above the notes: what was said of a stretch, or of the whole, each under its bracket.
    ctx.fillStyle = palette.raised;
    ctx.fillRect(0, 0, width, top - 5);
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, top - 5.5);
    ctx.lineTo(width, top - 5.5);
    ctx.stroke();

    const rowY = (row) => 3 + row * LANE;
    const wholeEnd = result.total + 60 / S.view.ppt;
    for (let row = 0; row < lanes.wholeRows && row < G.lanes; row++) {
      ctx.globalAlpha = S.reference ? 0.3 : 0.75;
      bracket(X(0), X(wholeEnd), rowY(row) + 19, palette.ink3, false);
      ctx.globalAlpha = 1;
    }
    for (const { ann, x, row } of lanes.whole) {
      if (row >= G.lanes) continue;
      if (editing === ann) G.penAt = { x, y: rowY(row) - 3 };
      else drawLabel(ann, x, rowY(row) + 9, false);
    }
    for (const { ann, a, b, row } of lanes.placed) {
      if (row >= G.lanes) continue;
      const y = rowY(row);
      const xa = X(a);
      const xb = X(b);
      if (xb < G.gutter || xa > width) continue;
      const color = ann.enabled ? toneOf(ann) : palette.ink3;
      ctx.globalAlpha = S.reference ? 0.3 : 1;
      bracket(xa, xb, y + 19, color, false);
      ctx.globalAlpha = 1;
      const labelW = widthOfLabel(ann.text);
      drawLabel(ann, clamp(xa + 7, G.gutter + 7, xb - labelW - 12), y + 9, false);
      G.marks.push({ ann, x: Math.max(xa, G.gutter), y: y + 14, w: Math.min(xb, width) - Math.max(xa, G.gutter), h: 10 });
    }
    // The row the next remark goes in: a bracket being drawn, or an invitation to write.
    const free = Math.min(lanes.rows, G.lanes - 1);
    const y = rowY(free);
    G.promptRow = { y, h: LANE };
    if (editing && editing.scope.kind === 'span') {
      const a = playedAt(result, editing.scope.from);
      bracket(X(a), X(playedAt(result, editing.scope.to)), y + 19, toneOf(editing), true);
      G.penAt = { x: clamp(X(a) + 7, G.gutter + 7, width - 80), y: y - 3 };
    } else if (editing) {
      // Its own place holds the pen; nothing else is to be written meanwhile.
    } else if (draft && (draft.kind === 'piece' || draft.kind === 'span')) {
      const a = draft.kind === 'piece' ? 0 : playedAt(result, draft.from);
      const b = draft.kind === 'piece' ? wholeEnd : playedAt(result, draft.to);
      bracket(X(a), X(b), y + 19, palette.pencil, true);
      G.penAt = { x: clamp(X(a) + 7, G.gutter + 7, width - 80), y: y - 3 };
    } else if (drag && drag.kind === 'band' && drag.moved && drag.flat) {
      bracket(Math.min(drag.x0, drag.x1), Math.max(drag.x0, drag.x1), y + 19, palette.pencil, true);
    } else if (!S.pen.open && !S.reference) {
      ctx.font = `500 17px ${palette.hand}`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = palette.ink3;
      ctx.globalAlpha = 0.9;
      ctx.fillText(S.anns.length ? 'write here about the whole piece…' : 'write here about the whole piece, or drag across the notes to bracket a passage…', G.gutter + 8, y + 10);
      ctx.globalAlpha = 1;
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

    placePen();
    // A remark still being read breathes, so the roll is drawn again while one is.
    if (S.tween) draw();
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
      if (S.pen.open && !G.penAt) pen.style.visibility = 'hidden';
      return;
    }
    pen.style.visibility = 'visible';
    pen.classList.toggle('up', G.penAt.grows === 'up');
    const left = clamp(G.penAt.x, G.gutter + 4, G.width - pen.offsetWidth - 8);
    const topAt = clamp(G.penAt.grows === 'up' ? G.penAt.y - pen.offsetHeight : G.penAt.y, 2, G.height - 30);
    pen.style.left = `${left}px`;
    pen.style.top = `${topAt}px`;
  };

  /** The pen takes the room of its words and no more: what it covers cannot be clicked. */
  const growPen = () => {
    ctx.font = `600 21px ${palette.hand}`;
    const widest = Math.max(...(penText.value || penText.placeholder).split('\n').map((line) => ctx.measureText(line).width));
    penText.style.width = `${clamp(widest + 26, 150, Math.min(300, G.width - 24))}px`;
    penText.style.height = 'auto';
    penText.style.height = `${penText.scrollHeight + 2}px`;
  };

  /** What a reader might be about to say of this, going by what is left in it. */
  const suggest = (scope) => {
    const ideas = [];
    const has = (name) => S.anns.some((ann) => ann.enabled && ann.calls.some((call) => call.name === name || (call.options && call.options.call && call.options.call.name === name)));
    const ids = scope.kind === 'piece' ? [] : scope.kind === 'span' ? idsOf(scope) : scope.ids;
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
  };

  const openPen = (seed) => {
    if (S.reference || !S.result) return;
    closePop();
    S.pen.open = true;
    pen.hidden = false;
    pen.style.visibility = 'hidden';
    const scope = scopeNow();
    penText.placeholder =
      scope.kind === 'piece' ? 'about the whole piece…' : scope.kind === 'span' ? `about ${scope.label}…` : scope.ids.length === 1 ? 'about this note…' : `about these ${scope.ids.length} notes…`;
    if (seed !== undefined) penText.value = seed;
    growPen();
    renderPenUnder();
    renderHint();
    draw();
    requestAnimationFrame(() => penText.focus({ preventScroll: true }));
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
  const noteAt = (x, y) => {
    let best = null;
    for (const rect of G.rects) {
      if (x < rect.x - 2 || x > rect.x + rect.w + 2 || y < rect.y - 2 || y > rect.y + rect.h + 2) continue;
      if (!best || rect.w * rect.h < best.w * best.h) best = rect;
    }
    return best ? best.note : null;
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
    const mark = S.reference ? null : markAt(x, y);
    if (mark) {
      drag = { kind: 'mark', mark, x0: x, y0: y };
      return;
    }
    if (S.reference) return;
    const touch = event.pointerType === 'touch';
    const note = inLanes(y) ? null : noteAt(x, y);
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    if (touch && !S.view.pencil) {
      drag = { kind: 'tap', x0: x, y0: y, note, additive };
      return;
    }
    // A press that lands on a note is a click on it only if it does not go on to be a stroke.
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that cannot be captured still draws; it only stops at the roll's edge.
    }
    drag = { kind: 'band', x0: x, y0: y, x1: x, y1: y, note, additive, lanes: inLanes(y), flat: true, moved: false, scroll: scroller.scrollLeft };
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
    if (note) showTip(note, x, y);
    else tip.hidden = true;
  });

  const endDrag = (event) => {
    if (!drag) return;
    const done = drag;
    drag = null;
    const { x, y } = local(event);
    if (done.kind === 'mark') {
      if (Math.hypot(x - done.x0, y - done.y0) < 6) openPop(done.mark.ann, done.mark);
      return;
    }
    if (done.kind === 'tap') {
      if (Math.hypot(x - done.x0, y - done.y0) >= 8) return;
      if (done.note) pick(done.note, done.additive);
      else emptyClick(done.x0, done.y0);
      return;
    }
    if (done.kind !== 'band') return;
    if (!done.moved) {
      if (done.note) pick(done.note, done.additive);
      else emptyClick(done.x0, done.y0);
      draw();
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
    if (S.hoverAnn) {
      S.hoverAnn = null;
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
    if (S.pen.open && !penText.value.trim()) {
      closePen();
      if (!prompt) return;
    }
    if (prompt || (S.pen.open && penText.value.trim())) {
      // Words already written stay, and are now about the whole piece.
      const kept = penText.value;
      S.pen.editing = null;
      S.selection.clear();
      S.selKind = 'none';
      openPen(kept);
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

  const UNITS = { pulse: 'ms', chords: 'ms', loud: '', length: 'ms' };
  const renderMeters = () => {
    const now = S.result ? (S.result.left = S.result.left || leftIn(S.result)) : null;
    const was = S.base ? (S.base.left = S.base.left || leftIn(S.base)) : null;
    for (const meter of document.querySelectorAll('.meter')) {
      const key = meter.dataset.k;
      const value = meter.querySelector('.lab span:last-child');
      const fill = meter.querySelector('.fill');
      if (!now || !was || !Number.isFinite(now[key])) {
        value.textContent = '–';
        continue;
      }
      const amount = now[key] >= 100 ? String(Math.round(now[key])) : now[key].toFixed(1);
      value.textContent = `${amount}${UNITS[key] ? ` ${UNITS[key]}` : ''}`;
      fill.style.width = `${clamp((now[key] / Math.max(was[key], 1e-9)) * 100, 2, 100)}%`;
      fill.style.opacity = S.fitting ? '0.45' : '1';
    }
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
    const key = 'In pencil, where the MPM has each note; in red, how far that is from where it was played. ';
    if (S.anns.length === 0) {
      hint.append('Nothing is described yet, so the MPM is one steady tempo and one level. ', key, 'Drag across the roll to bracket a passage, click a note, or just type.');
      return;
    }
    hint.append(key, S.result.assumed.tempo.length ? 'Dashed bar lines: the tempo there is only assumed. ' : '', 'Click a remark to see what it became.');
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
    if (Math.abs(ann.delta.pulse) >= 1) parts.push(`pulse ${signed(-ann.delta.pulse, 'ms')}`);
    if (Math.abs(ann.delta.chords) >= 1) parts.push(`chords ${signed(-ann.delta.chords, 'ms')}`);
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
    pop.style.setProperty('--tone', `var(--c${(ann.tone % TONES) + 1})`);
    const report = ann.report;
    const waiting = S.queue.some((entry) => entry.ann === ann);

    pop.append(
      el('div', { class: 'said', text: ann.text }),
      el('div', { class: 'where' }, ann.scope.label, ann.example && el('span', { class: 'tag', text: 'example', title: 'An example, translated in advance. Remove it whenever you like.' }), !ann.enabled && el('span', { class: 'tag', text: 'muted' })),
    );

    if (ann.status === 'pending' || waiting) {
      pop.append(el('div', { class: 'reading' }, el('span', { class: 'pulse' }), waiting ? 'Waiting for its turn…' : ann.reading || ann.progress || 'Reading the remark…'));
      pop.append(el('div', { class: 'acts' }, !waiting && el('button', { class: 'btn quiet', text: 'Stop', onclick: () => ann.abort && ann.abort.abort() }), el('button', { class: 'btn quiet', text: 'Remove', onclick: () => removeAnn(ann) })));
      return;
    }

    if (ann.reading) pop.append(el('div', { class: 'reading', text: ann.reading }));
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
  const workFile = () => {
    const calls = S.result.calls.flatMap((report) => report.concrete).map((call) => ({ id: call.id, name: call.name, options: call.options }));
    const assumed = S.result.assumed.tempo.map((gap, i) => ({
      id: `assumed-tempo-${i}`,
      name: 'InsertTempo',
      options: { scope: 'global', from: gap.from, to: gap.to, bpm: gap.bpm, beatLength: 0.25 },
    }));
    const remarks = S.anns.filter((ann) => ann.calls.length).map((ann) => ({ text: ann.text, about: ann.scope.label, from: ann.scope.from, to: ann.scope.to, notes: ann.scope.kind === 'span' ? [] : ann.scope.ids }));
    return JSON.stringify({ name: S.piece.title, mei: 'transcription.mei', mpm: 'performance.mpm', provenance: [...assumed, ...calls], secondary: { describeIt: { remarks } } }, null, 2);
  };

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
      picked.length ? `Selected note ids: ${picked.join(' ')}` : '',
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
      '{"reading": "one or two plain sentences to the reader, in the language of the remark: how you understood it and what it becomes, in musical terms, naming the MPM instruction",',
      ' "calls": [{"name": "<transformer or DescribeIt step>", "options": { ... }}],',
      ' "question": null}',
      'Put "reading" first. Leave "calls" empty and put one short question in "question" only when the remark cannot be translated without knowing more.',
    );
    return sections.filter((line) => line !== undefined).join('\n');
  };

  const readingSoFar = (text) => {
    const match = /"reading"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(text);
    if (!match) return null;
    try {
      return JSON.parse(`"${match[1].replace(/\\$/, '')}"`);
    } catch {
      return match[1];
    }
  };

  const parseAnswer = (text) => {
    const candidates = [];
    const last = text.lastIndexOf('}');
    // With the tool the answer is the last object written, after whatever was said on the way.
    const tail = text.lastIndexOf('{"reading"');
    if (tail !== -1 && last > tail) candidates.push(text.slice(tail, last + 1));
    const fence = /```(?:json)?\s*([\s\S]*?)```/g;
    let match;
    while ((match = fence.exec(text))) candidates.push(match[1]);
    const first = text.indexOf('{');
    if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
    for (const candidate of candidates) {
      try {
        const value = JSON.parse(candidate);
        if (value && typeof value === 'object' && ('calls' in value || 'reading' in value)) return value;
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
      const result = await Engine.run([...callsOf(S.anns.filter((other) => other !== ann)), ...mine]);
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
    ann.progress = null;
    if (mode !== 'repair') ann.reading = null;
    const asked = ann.question;
    ann.question = null;
    renderAll();
    try {
      const options = {
        ...EXPERT,
        signal: controller.signal,
        onText: ({ text }) => {
          const reading = readingSoFar(text.slice(Math.max(0, text.lastIndexOf('{"reading"'))));
          if (reading && reading !== ann.reading) {
            ann.reading = reading;
            if (S.openAnn === ann) renderPop();
          }
        },
      };
      if (S.tools) options.tools = [tryTool(ann)];
      else options.cache = false;
      const { text } = await S.sample(buildPrompt(ann, mode), options);
      const answer = parseAnswer(text);
      if (!answer) throw { code: 'invalid_json' };
      ann.reading = typeof answer.reading === 'string' ? answer.reading : ann.reading;
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
        editing.reading = null;
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
      tone: S.anns.reduce((max, other) => Math.max(max, other.tone + 1), 0),
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
      const anns = S.anns.map(({ id, text, scope, calls, enabled, tone, reading, question, thread, delta, example, failure }) => ({ id, text, scope, calls, enabled, tone, reading, question, thread, delta, example, failure }));
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
      else if (S.openAnn) closePop();
      else if (S.pen.open) closePen();
      else if (!$('#drawer').hidden) setDrawer(false);
      return;
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey || S.reference || !S.result) return;
    if (target && target.tagName === 'BUTTON' && (event.key === ' ' || event.key === 'Enter')) return;
    // Anything typed with nothing else in hand is the start of a remark.
    if (event.key.length === 1 && event.key !== ' ') {
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
  document.addEventListener('pointerdown', (event) => {
    if (!$('#menu').hidden && !event.target.closest('#menu') && !event.target.closest('#menuBtn')) closeMenu();
    if (S.openAnn && !event.target.closest('#pop') && !event.target.closest('#roll') && !event.target.closest('#drawer') && !event.target.closest('#mpmBtn')) closePop();
  });

  // ------------------------------------------------------------------------------------------
  // Start
  // ------------------------------------------------------------------------------------------

  const start = async () => {
    readPalette();
    new ResizeObserver(resize).observe(scroller);
    if (document.fonts && document.fonts.load) {
      Promise.all([document.fonts.load('600 18px Caveat'), document.fonts.load('500 17px Caveat'), document.fonts.ready]).then(draw, draw);
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
      const pitches = piece.alignment.allNotes.map((n) => n['midi.pitch']);
      G.lo = Math.min(...pitches) - 2;
      G.hi = Math.max(...pitches) + 3;

      S.base = await Engine.run([]);
      index(S.base);
      S.bars = buildBars(S.base.timeSignatures, S.base.end);
      // The scale of loudness: a note in the loudest twentieth stands four rows tall.
      S.level = S.base.level;
      const louds = S.base.notes.map((n) => Math.abs(n.velocity - S.level)).sort((a, b) => a - b);
      G.k = Math.max(2, louds[Math.floor(louds.length * 0.95)] / 2);
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
          const ann = { ...example, id: `example${i}`, status: 'done', enabled: true, tone: i, example: true };
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
  if (typeof window.__describeItTest === 'function') window.__describeItTest({ S, G, select, describe, refit, Engine, openPop, buildPrompt });

  start();
})();
