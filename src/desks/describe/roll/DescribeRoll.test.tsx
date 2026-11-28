import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { ScrollSyncProvider } from '../../../hooks/ScrollSyncProvider';
import { ZoomContext } from '../../../hooks/ZoomProvider';
import { theme } from '../../../theme';
import { DescribeRoll, type DescribeRollProps } from './DescribeRoll';
import { RULER } from './geometry';
import { F_CLEF, G_CLEF } from './smufl';
import type { About, RollNote, RollRemark, Sounded } from './types';

/**
 * The roll, mounted: that it draws what it is handed, and that a gesture on it is reported as
 * what it would be about. Where things are is the business of the pure helpers and their tests;
 * here a place is read off the drawing, the way a hand finds it.
 */

/**
 * An identity screen matrix, which jsdom has no notion of: every gesture goes through `svgPoint`,
 * which answers `null` where there is none. With it a client coordinate is a place on the roll.
 */
beforeAll(() => {
    const identity = { a: 1, inverse: () => identity };
    const proto = SVGSVGElement.prototype as unknown as { getScreenCTM: () => unknown; createSVGPoint: () => unknown };
    proto.getScreenCTM = () => identity;
    proto.createSVGPoint = () => {
        const point = { x: 0, y: 0, matrixTransform: () => ({ x: point.x, y: point.y }) };
        return point;
    };
});

/** A hundred pixels to the second, so that a second is easy to find. */
const ZOOM = 100;

const sound = (ms: number, msEnd: number, velocity = 64): Sounded => ({ ms, msEnd, velocity });

const note = (id: string, over: Partial<RollNote> & Pick<RollNote, 'pitch' | 'letter' | 'date' | 'played'>): RollNote => ({
    id,
    part: 1,
    staff: 'treble',
    alter: 0,
    duration: 720,
    rendered: over.played,
    ...over,
});

/**
 * A rising line over a bass. `a` is rendered where it was played; `b` is rendered late and `c`
 * too soft, so each has a shadow; `d` is an F and `e` an F sharp, which is loud, so there is no
 * key for the sharp to belong to; `f` is middle C written for the left hand, and was corrected.
 */
const notes: RollNote[] = [
    note('a', { pitch: 72, letter: 'c', date: 0, played: sound(1000, 2000) }),
    note('b', { pitch: 76, letter: 'e', date: 720, played: sound(2000, 3000), rendered: sound(2400, 3400) }),
    note('c', { pitch: 79, letter: 'g', date: 1440, played: sound(3000, 4000, 90), rendered: sound(3000, 4000, 64) }),
    note('d', { part: 2, staff: 'bass', pitch: 41, letter: 'f', date: 0, played: sound(1000, 3000) }),
    note('e', { part: 2, staff: 'bass', pitch: 54, letter: 'f', alter: 1, date: 1440, played: sound(3000, 4000, 100) }),
    note('f', { part: 2, staff: 'bass', pitch: 60, letter: 'c', date: 2160, played: sound(4000, 5000), arrived: sound(4200, 5000) }),
];

const whole: About = { kind: 'piece', from: 0, to: 2880, notes: [] };
const remark = (id: string, text: string, about: About, state: RollRemark['state'] = 'done'): RollRemark => ({ id, text, about, state });
const remarks: RollRemark[] = [
    remark('all', 'arpeggio throughout', whole),
    remark('passage', 'steady here', { kind: 'span', from: 0, to: 1440, notes: [] }),
    remark('set', 'bring these out', { kind: 'notes', from: 1440, to: 2880, notes: ['e', 'f'] }, 'question'),
    remark('line', 'towards the top', { kind: 'arrow', from: 0, to: 2160, notes: ['a', 'c'] }, 'trouble'),
];

const base: DescribeRollProps = {
    notes,
    graces: [{ id: 'g', pitch: 46, staff: 'bass', ms: 900 }],
    pedals: {
        played: [
            { kind: 'sustain', ms: 1000, msEnd: 2500 },
            { kind: 'sustain', ms: 3000, msEnd: 4500 },
        ],
        rendered: [
            { kind: 'sustain', ms: 1000, value: 127 },
            { kind: 'sustain', ms: 2000, value: 0 },
        ],
    },
    // A beat a second, from the first second on.
    beats: [0, 720, 1440, 2160, 2880, 3600, 4320, 5040, 5760].map((date) => ({ date, ms: 1000 + (date / 720) * 1000 })),
    bars: [
        { n: 1, from: 0, to: 2880 },
        { n: 2, from: 2880, to: 5760 },
    ],
    assumed: [{ from: 2880, to: 5760 }],
    remarks,
    view: { staff: true, shadows: true, loudnessGain: 1 },
    editable: true,
};

const mount = (over: Partial<DescribeRollProps> = {}) => {
    const zoom = { symbolic: { stretchX: ZOOM / 200 }, physical: { stretchX: ZOOM }, setStretchX: () => undefined };
    const view = render(
        <ThemeProvider theme={theme}>
            <ZoomContext value={zoom}>
                <ScrollSyncProvider symbolicZoom={ZOOM / 200} physicalZoom={ZOOM}>
                    <DescribeRoll {...base} {...over} />
                </ScrollSyncProvider>
            </ZoomContext>
        </ThemeProvider>,
    );
    const one = <T extends Element = SVGElement>(selector: string): T => {
        const found = view.container.querySelector<T>(selector);
        if (!found) throw new Error(`nothing drawn for ${selector}`);
        return found;
    };
    const all = (selector: string) => [...view.container.querySelectorAll(selector)];
    const number = (element: Element, name: string) => Number(element.getAttribute(name));
    /** The box drawn for a note, and its middle. */
    const boxOf = (selector: string) => {
        const rect = one(selector);
        const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((name) => number(rect, name));
        return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
    };
    /** Where the words of a remark in the roll are laid over it, and their middle. */
    const wordsOf = (id: string) => {
        const held = one<HTMLElement>(`[data-said="${id}"]`);
        const before = /([\d.]+)px/.exec((held.firstElementChild as HTMLElement).style.flex);
        const x = Number.parseFloat(held.style.left) + Number(before?.[1] ?? 0);
        const y = Number.parseFloat(held.style.top);
        const w = number(one(`[data-words="${id}"]`), 'width');
        return { x, y, w, h: 20, cx: x + w / 2, cy: y + 10 };
    };
    const roll = () => one<SVGSVGElement>('[data-layer="roll"]');
    const at = (x: number, y: number, init: object = {}) => ({ clientX: x, clientY: y, pointerId: 1, button: 0, ...init });
    const pointer = {
        down: (x: number, y: number, init?: object, on: Element = roll()) => fireEvent.pointerDown(on, at(x, y, init)),
        move: (x: number, y: number, init?: object, on: Element = roll()) => fireEvent.pointerMove(on, at(x, y, init)),
        up: (x: number, y: number, init?: object) => fireEvent.pointerUp(roll(), at(x, y, init)),
        click: (x: number, y: number, init?: object, on: Element = roll()) => {
            fireEvent.pointerDown(on, at(x, y, init));
            fireEvent.pointerUp(roll(), at(x, y, init));
        },
        /** A stroke from one place to another, by way of the middle. */
        drag: (from: { x: number; y: number }, to: { x: number; y: number }, init?: object) => {
            fireEvent.pointerDown(roll(), at(from.x, from.y, init));
            fireEvent.pointerMove(roll(), at((from.x + to.x) / 2, (from.y + to.y) / 2, init));
            fireEvent.pointerMove(roll(), at(to.x, to.y, init));
            fireEvent.pointerUp(roll(), at(to.x, to.y, init));
        },
    };
    return { ...view, one, all, number, boxOf, wordsOf, roll, pointer };
};

const ids = (elements: Element[], name: string) => elements.map((element) => element.getAttribute(name));

describe('DescribeRoll draws the notes', () => {
    it('draws every note as a box, as long as it sounded and where it began', () => {
        const { all, boxOf } = mount();
        expect(ids(all('[data-note]'), 'data-note').sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
        expect(boxOf('[data-note="a"]')).toMatchObject({ x: 100, w: 100 });
        // `b` is drawn where the MPM renders it, not where it was played.
        expect(boxOf('[data-note="b"]')).toMatchObject({ x: 240, w: 100 });
        expect(boxOf('[data-note="d"]')).toMatchObject({ x: 100, w: 200 });
    });

    it('draws each hand in its colour', () => {
        const { one } = mount();
        const right = one('[data-note="a"]').getAttribute('fill');
        const left = one('[data-note="d"]').getAttribute('fill');
        expect(right).toBe('#2c47cf');
        expect(left).toBe('#bf5412');
        expect(one('[data-note="c"]').getAttribute('fill')).toBe(right);
        expect(one('[data-note="f"]').getAttribute('fill')).toBe(left);
    });

    it('draws the louder note taller and more solid', () => {
        const { one, boxOf, number } = mount();
        expect(boxOf('[data-note="e"]').h).toBeGreaterThan(boxOf('[data-note="d"]').h);
        expect(number(one('[data-note="e"]'), 'fill-opacity')).toBeGreaterThan(number(one('[data-note="d"]'), 'fill-opacity'));
        // Twice the gain, and the loud note stands taller still; a note at the level stays as it is.
        const taller = mount({ view: { ...base.view, loudnessGain: 2 } });
        expect(taller.boxOf('[data-note="e"]').h).toBeGreaterThan(boxOf('[data-note="e"]').h);
        expect(taller.boxOf('[data-note="d"]').h).toBeCloseTo(boxOf('[data-note="d"]').h, 6);
    });

    it('puts a higher note higher, and the treble staff over the bass', () => {
        const { boxOf } = mount();
        expect(boxOf('[data-note="b"]').cy).toBeLessThan(boxOf('[data-note="a"]').cy);
        expect(boxOf('[data-note="c"]').cy).toBeLessThan(boxOf('[data-note="b"]').cy);
        expect(boxOf('[data-note="a"]').cy).toBeLessThan(boxOf('[data-note="f"]').cy);
    });

    it('gives a shadow only to the notes that were played otherwise than they are rendered', () => {
        const { all, boxOf, one } = mount();
        expect(ids(all('[data-shadow]'), 'data-shadow').sort()).toEqual(['b', 'c']);
        // The shadow of `b` stands where it was played, four tenths of a second before the note.
        expect(boxOf('[data-shadow="b"]').x).toBeCloseTo(200.5, 6);
        // The shadow of `c` is taller than the note: it was played louder than it is rendered.
        expect(boxOf('[data-shadow="c"]').h).toBeGreaterThan(boxOf('[data-note="c"]').h);
        // Gray and dashed.
        expect(one('[data-shadow="b"]').getAttribute('fill')).toBe(theme.palette.text.secondary);
        expect(one('[data-shadow="b"]').getAttribute('stroke-dasharray')).toBe('3 2');
    });

    it('outlines where the roll had a note before it was corrected', () => {
        const { all, boxOf } = mount();
        expect(ids(all('[data-arrived]'), 'data-arrived')).toEqual(['f']);
        expect(boxOf('[data-arrived="f"]').x).toBeCloseTo(420.5, 6);
    });

    it('draws no shadows at all when they are put away', () => {
        const { all } = mount({ view: { ...base.view, shadows: false } });
        expect(all('[data-shadow]')).toHaveLength(0);
        expect(all('[data-arrived]')).toHaveLength(0);
        expect(all('[data-press]')).toHaveLength(0);
        expect(all('[data-note]')).toHaveLength(6);
    });

    it('draws an accidental where a note departs from the key, and a ledger line where it leaves the staff', () => {
        const { all, one, boxOf } = mount();
        expect(ids(all('[data-accidental]'), 'data-accidental')).toEqual(['e']);
        expect(one('[data-accidental="e"]').textContent).toBe('');
        // To the left of its note.
        expect(Number(one('[data-accidental="e"]').getAttribute('x'))).toBeLessThan(boxOf('[data-note="e"]').x);
        // Middle C over the bass staff is the one note here off its staff: one line, through its box.
        const ledgers = one('[data-ledgers]').getAttribute('d') ?? '';
        expect(ledgers.match(/M/g)).toHaveLength(1);
        const [, x, y, to] = /M(-?[\d.]+) (-?[\d.]+)H(-?[\d.]+)/.exec(ledgers) ?? [];
        const middleC = boxOf('[data-note="f"]');
        expect(Number(x)).toBe(middleC.x - 5);
        expect(Number(to)).toBe(middleC.x + middleC.w + 5);
        expect(Math.abs(Number(y) - middleC.cy)).toBeLessThanOrEqual(1);
    });

    it('draws the two staves with their clefs beside them', () => {
        const { one, all } = mount();
        expect(one('[data-layer="staves"]').getAttribute('d')?.match(/M/g)).toHaveLength(10);
        expect(one('[data-clef="treble"]').textContent).toBe(G_CLEF);
        expect(one('[data-clef="bass"]').textContent).toBe(F_CLEF);
        expect(one('[data-clef="treble"]').closest('[data-layer="gutter"]')).not.toBeNull();
        // The G clef stands over the F clef.
        expect(Number(one('[data-clef="treble"]').getAttribute('y'))).toBeLessThan(Number(one('[data-clef="bass"]').getAttribute('y')));
        expect(all('[data-signature]')).toHaveLength(0);
    });

    it('writes the key signature on both staves', () => {
        const flat = (id: string, date: number): RollNote => note(id, { pitch: 70, letter: 'b', alter: -1, date, played: sound(1000 + date, 1500 + date) });
        const { all, one } = mount({ notes: [flat('x', 0), flat('y', 720)], remarks: [] });
        expect(ids(all('[data-signature]'), 'data-signature')).toEqual(['treble', 'bass']);
        expect(one('[data-signature="treble"]').textContent).toBe('');
        // And a note the signature covers needs no accidental of its own.
        expect(all('[data-accidental]')).toHaveLength(0);
    });

    it('can be put back key by key', () => {
        const { all, boxOf, one } = mount({ view: { ...base.view, staff: false } });
        expect(all('[data-clef]')).toHaveLength(0);
        expect(all('[data-accidental]')).toHaveLength(0);
        expect(one('[data-ledgers]').getAttribute('d')).toBe('');
        expect(screen.getByText('C4')).toBeInTheDocument();
        // Middle C is one key below the C sharp that was a line apart from it on the staves.
        expect(boxOf('[data-note="f"]').cy).toBeGreaterThan(boxOf('[data-note="a"]').cy);
        expect(boxOf('[data-note="e"]').cy).toBeGreaterThan(boxOf('[data-note="f"]').cy);
    });

    it('draws the grace notes, the pedals as pressed and as moved, and names the pedal row', () => {
        const { all, one } = mount();
        expect(ids(all('[data-grace]'), 'data-grace')).toEqual(['g']);
        expect(all('[data-press="sustain"]')).toHaveLength(2);
        expect(one('[data-moves="sustain"]').getAttribute('d')).toMatch(/^M100 /);
        expect(all('[data-pedal]')).toHaveLength(1);
        expect(screen.getByText('Ped')).toBeInTheDocument();
        expect(screen.queryByText('u.c.')).toBeNull();
    });

    it('takes the grace notes back with the notes while a remark is lit, and leaves them while one is being written', () => {
        const opacity = (over: Partial<DescribeRollProps>) => {
            const { one, number } = mount(over);
            return number(one('[data-layer="graces"]'), 'fill-opacity');
        };
        expect(opacity({ lit: 'passage' })).toBeLessThan(opacity({}));
        expect(opacity({ draft: { kind: 'span', from: 720, to: 2160, notes: [] } })).toBe(opacity({}));
    });

    it('draws an empty roll for a piece with no notes', () => {
        const { all, one } = mount({ notes: [], graces: [], pedals: { played: [], rendered: [] }, beats: [], bars: [], assumed: [], remarks: [] });
        expect(all('[data-note]')).toHaveLength(0);
        expect(all('[data-pedal]')).toHaveLength(0);
        // The staves are there all the same, as wide as the window.
        expect(one('[data-layer="staves"]').getAttribute('d')?.match(/M/g)).toHaveLength(10);
        expect(Number(one('[data-layer="roll"]').getAttribute('width'))).toBeGreaterThan(0);
    });

    it('is as long as the recording at the zoom, with a little to spare', () => {
        const { one, number } = mount();
        // The last beat is at nine seconds; a hundred pixels to the second.
        expect(number(one('[data-layer="roll"]'), 'width')).toBe(1100);
        const long = mount({ beats: [...base.beats, { date: 14400, ms: 21000 }] });
        expect(long.number(long.one('[data-layer="roll"]'), 'width')).toBe(2100 + 60);
    });

    it('numbers the bars on the ruler, dashes the bar line of an assumed tempo, and underlines what is described', () => {
        const { one } = mount();
        expect(one('[data-bar="1"]').textContent).toBe('1');
        expect(one('[data-bar="1"]').getAttribute('fill')).toBe(theme.palette.text.primary);
        expect(one('[data-bar="2"]').getAttribute('fill')).toBe(theme.palette.text.disabled);
        expect(one('[data-bars="described"]').getAttribute('d')).toMatch(/^M100\.5 /);
        expect(one('[data-bars="assumed"]').getAttribute('d')).toMatch(/^M500\.5 /);
        expect(one('[data-bars="assumed"]').getAttribute('stroke-dasharray')).toBe('3 4');
        // Described from the first beat to the second bar line.
        expect(one('[data-described]').getAttribute('d')).toBe(`M100 ${String(RULER - 0.5)}H500`);
    });

    it('hangs the playhead from the ruler where the playing is', () => {
        expect(mount().all('[data-playhead]')).toHaveLength(0);
        const { one } = mount({ playheadMs: 2500 });
        expect(one('[data-playhead]').getAttribute('transform')).toBe('translate(250.5 0)');
        expect(Number(one('[data-playhead] line').getAttribute('y1'))).toBe(RULER);
        // At the very start it is still drawn: nought is a place too.
        expect(mount({ playheadMs: 0 }).all('[data-playhead]')).toHaveLength(1);
    });
});

describe('DescribeRoll writes the remarks', () => {
    it('writes what is said of the whole piece over the roll, and the rest on it', () => {
        const { one } = mount();
        for (const { text } of remarks) expect(screen.getByText(text)).toBeInTheDocument();
        expect(screen.getByText('arpeggio throughout').closest('[data-layer="lanes"]')).not.toBeNull();
        expect(screen.getByText('steady here').closest('[data-said="passage"]')).not.toBeNull();
        expect(screen.getByText('steady here').closest('[data-layer="lanes"]')).toBeNull();
        expect(one('[data-remark="all"]').getAttribute('data-kind')).toBe('piece');
        expect(one('[data-remark="passage"]').getAttribute('data-kind')).toBe('span');
    });

    it('holds a passage in a brace, a set of notes in a hull, and draws an arrow from note to note', () => {
        const { one, boxOf } = mount();
        expect(one('[data-remark="passage"] [data-mark]').getAttribute('data-mark')).toBe('brace');
        expect(one('[data-remark="set"] [data-mark]').getAttribute('data-mark')).toBe('hull');
        expect(one('[data-remark="line"] [data-mark]').getAttribute('data-mark')).toBe('arrow');
        // The brace runs from the first beat of its stretch to the beat it ends before.
        expect(one('[data-remark="passage"] [data-mark]').getAttribute('d')).toMatch(/^M100 .* 300 [\d.]+$/);
        // The hull is closed, and filled with a breath of the pencil.
        expect(one('[data-remark="set"] [data-mark]').getAttribute('d')).toMatch(/Z$/);
        expect(one('[data-remark="set"] [data-mark]').getAttribute('fill')).not.toBe('none');
        // The arrow leaves from just over the first note and has a head.
        const arrow = one('[data-remark="line"] [data-mark]').getAttribute('d') ?? '';
        const first = boxOf('[data-note="a"]');
        expect(arrow.startsWith(`M${String(first.x + 5)} ${String(Math.round((first.y - 3) * 100) / 100)}`)).toBe(true);
        expect(arrow.match(/M/g)).toHaveLength(3);
    });

    it('writes the words of a mark over it, and no two in the same place', () => {
        const { wordsOf, one } = mount();
        const grounds = ['passage', 'set', 'line'].map(wordsOf);
        for (const [i, a] of grounds.entries()) {
            for (const b of grounds.slice(i + 1)) {
                expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
            }
        }
        // Over the middle of the brace, which runs from one second to three.
        expect(wordsOf('passage').cx).toBeCloseTo(200, 6);
        // And they may be anywhere along it: the box they are kept in is the brace's own stretch.
        const stretch = one<HTMLElement>('[data-said="passage"]').style;
        expect([Number.parseFloat(stretch.left), Number.parseFloat(stretch.left) + Number.parseFloat(stretch.width)]).toEqual([100, 300]);
    });

    it('shows how a remark stands', () => {
        const states: RollRemark[] = [
            remark('asked', 'what do you mean', whole, 'question'),
            remark('wrong', 'cannot be done', whole, 'trouble'),
            remark('aside', 'set aside', whole, 'muted'),
            remark('wait', 'being read', { kind: 'span', from: 0, to: 1440, notes: [] }, 'pending'),
            remark('fine', 'as it should be', whole),
        ];
        const { one, all } = mount({ remarks: states });
        // A badge where the expert asks back, and where something went wrong.
        expect(one('[data-remark="asked"]').textContent).toBe('what do you mean?');
        expect(one('[data-remark="wrong"]').textContent).toBe('cannot be done!');
        expect(one('[data-remark="wrong"] circle').getAttribute('fill')).toBe(theme.palette.error.main);
        expect(all('[data-remark="fine"] circle')).toHaveLength(0);
        // Struck through and pale when it is set aside.
        expect(screen.getByText('set aside').getAttribute('fill')).toBe(theme.palette.text.disabled);
        expect(all('[data-remark="aside"] line')).toHaveLength(1);
        expect(all('[data-remark="fine"] line')).toHaveLength(0);
        // Pulsing while it waits, its mark drawn all the same.
        expect(screen.getByText('being read')).toHaveClass('describe-roll-pending');
        expect(screen.getByText('as it should be')).not.toHaveClass('describe-roll-pending');
        expect(one('[data-remark="wait"] [data-mark]').getAttribute('data-mark')).toBe('brace');
        expect(ids(all('[data-remark]'), 'data-state')).toEqual(['question', 'trouble', 'muted', 'done', 'pending']);
    });

    it('draws a remark that is set aside more faintly than one that stands', () => {
        const stretch: About = { kind: 'span', from: 0, to: 1440, notes: [] };
        const { one, number } = mount({ remarks: [remark('on', 'stands', stretch), remark('off', 'set aside', { ...stretch, to: 2160 }, 'muted')] });
        expect(number(one('[data-remark="off"] [data-mark]'), 'stroke-opacity')).toBeLessThan(number(one('[data-remark="on"] [data-mark]'), 'stroke-opacity'));
    });

    it('writes a long remark on one line and not all of it', () => {
        mount({ remarks: [remark('long', `one\ntwo ${'x'.repeat(80)}`, whole)] });
        expect(screen.getByText(/^one two x+…$/).textContent).toHaveLength(63);
    });

    it('lights a remark: its words underlined, its notes left standing and the rest taken back', () => {
        const { all, one, number } = mount({ lit: 'passage' });
        expect(one('[data-remark="passage"]').getAttribute('data-lit')).toBe('true');
        expect(all('[data-lit]')).toHaveLength(1);
        expect(all('[data-words="passage"] line')).toHaveLength(1);
        expect(all('[data-words] line')).toHaveLength(1);
        expect(ids(all('[data-dim]'), 'data-note').sort()).toEqual(['c', 'e', 'f']);
        expect(number(one('[data-note="c"]'), 'fill-opacity')).toBeLessThan(number(one('[data-note="a"]'), 'fill-opacity') / 2);
        // And its mark is drawn firmer than the others'.
        expect(number(one('[data-remark="passage"] [data-mark]'), 'stroke-opacity')).toBe(1);
        expect(number(one('[data-remark="line"] [data-mark]'), 'stroke-opacity')).toBe(0.7);
    });

    it('lights the notes a remark was fitted to, where that is known, in place of the notes it is about', () => {
        const { all } = mount({ lit: 'passage', evidence: new Set(['f']) });
        expect(ids(all('[data-dim]'), 'data-note').sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
        // An empty set says nothing is known, and the remark's own stretch decides again.
        const unknown = mount({ lit: 'passage', evidence: new Set() });
        expect(ids(unknown.all('[data-dim]'), 'data-note').sort()).toEqual(['c', 'e', 'f']);
    });

    it('takes nothing back for a lit remark about the whole piece', () => {
        const { all, one } = mount({ lit: 'all' });
        expect(all('[data-dim]')).toHaveLength(0);
        expect(one('[data-remark="all"]').getAttribute('data-lit')).toBe('true');
    });

    it('holds the popover at the words of the lit remark, on the roll or over it', () => {
        const onRoll = mount({ lit: 'set', popover: <p>what came of it</p> });
        expect(onRoll.one('[data-held="popover"]').textContent).toBe('what came of it');
        expect(onRoll.one('[data-held="popover"]').closest('[data-layer="lanes"]')).toBeNull();
        const over = mount({ lit: 'all', popover: <p>of the whole piece</p> });
        expect(over.all('[data-held="popover"]')).toHaveLength(1);
        expect(screen.getByText('of the whole piece')).toBeInTheDocument();
        // With no remark lit there is nowhere to hold it.
        expect(mount({ popover: <p>unasked</p> }).all('[data-held]')).toHaveLength(0);
    });
});

describe('DescribeRoll draws what is being described', () => {
    const passage: About = { kind: 'span', from: 720, to: 2160, notes: [] };

    it('draws the selection like a remark without words, and takes the rest back', () => {
        const { one, all, number } = mount({ draft: passage });
        expect(one('[data-draft]').getAttribute('data-draft')).toBe('span');
        expect(one('[data-draft] [data-mark]').getAttribute('data-mark')).toBe('brace');
        expect(all('[data-draft] text')).toHaveLength(0);
        // The stretch is tinted from its first beat to where it ends.
        expect(number(one('[data-draft-span]'), 'x')).toBe(200);
        expect(number(one('[data-draft-span]'), 'width')).toBe(200);
        expect(ids(all('[data-dim]'), 'data-note').sort()).toEqual(['a', 'd', 'f']);
        // Dimmed, but not as far as by a lit remark: it is still what is being worked on.
        const lit = mount({ lit: 'passage' });
        expect(number(one('[data-note="a"]'), 'fill-opacity')).toBeGreaterThan(lit.number(lit.one('[data-note="c"]'), 'fill-opacity'));
    });

    it('draws a set in hand as a hull and an arrow in hand as an arrow', () => {
        const hull = mount({ draft: { kind: 'notes', from: 0, to: 720, notes: ['a', 'd'] } });
        expect(hull.one('[data-draft] [data-mark]').getAttribute('data-mark')).toBe('hull');
        expect(ids(hull.all('[data-dim]'), 'data-note').sort()).toEqual(['b', 'c', 'e', 'f']);
        const arrow = mount({ draft: { kind: 'arrow', from: 720, to: 2160, notes: ['b', 'c'] } });
        expect(arrow.one('[data-draft] [data-mark]').getAttribute('data-mark')).toBe('arrow');
        // An arrow is about everything on its way, in both hands.
        expect(ids(arrow.all('[data-dim]'), 'data-note').sort()).toEqual(['a', 'd', 'f']);
    });

    it('holds the pen at the selection', () => {
        const { one, all } = mount({ draft: passage, pen: <input aria-label="Your remark" /> });
        expect(screen.getByLabelText('Your remark').closest('[data-held="pen"]')).not.toBeNull();
        expect(one('[data-held="pen"]').closest('[data-layer="lanes"]')).toBeNull();
        expect(all('[data-held="pen"]')).toHaveLength(1);
    });

    it('holds the pen on the line that waits over the roll when the remark is about the whole piece', () => {
        const { all } = mount({ draft: whole, pen: <input aria-label="Your remark" /> });
        expect(all('[data-held="pen"]')).toHaveLength(1);
        expect(all('[data-draft]')).toHaveLength(0);
        expect(all('[data-dim]')).toHaveLength(0);
        // The line stops asking to be written on once it is being written on.
        expect(screen.queryByText(/write here about the whole piece/)).toBeNull();
    });

    it('lets a lit remark, not the selection, say which notes stand out', () => {
        const { all } = mount({ draft: passage, lit: 'set' });
        expect(ids(all('[data-dim]'), 'data-note').sort()).toEqual(['a', 'b', 'c', 'd']);
    });

    it('has no pen without a selection', () => {
        expect(mount({ pen: <input aria-label="Your remark" /> }).all('[data-held]')).toHaveLength(0);
    });
});

describe('DescribeRoll reports gestures', () => {
    const handlers = () => ({ onPick: vi.fn(), onStroke: vi.fn(), onRemark: vi.fn(), onHover: vi.fn(), onSeek: vi.fn() });
    /** Paper with nothing on it: after the last note, between the staves. */
    const nowhere = { x: 800, y: 300 };

    it('reports a click on a note as a pick', () => {
        const on = handlers();
        const { boxOf, pointer } = mount(on);
        const a = boxOf('[data-note="a"]');
        pointer.click(a.cx, a.cy);
        expect(on.onPick).toHaveBeenCalledExactlyOnceWith('a', false);
        expect(on.onStroke).not.toHaveBeenCalled();
        expect(on.onSeek).not.toHaveBeenCalled();
    });

    it('says when a pick is to be added to what is in hand', () => {
        const on = handlers();
        const { boxOf, pointer } = mount(on);
        const d = boxOf('[data-note="d"]');
        pointer.click(d.cx, d.cy, { shiftKey: true });
        pointer.click(d.cx, d.cy, { metaKey: true });
        expect(on.onPick.mock.calls).toEqual([
            ['d', true],
            ['d', true],
        ]);
    });

    it('picks a note by its shadow where the note itself has moved away', () => {
        const on = handlers();
        const { boxOf, pointer } = mount(on);
        const shadow = boxOf('[data-shadow="b"]');
        // The left end of the shadow, which the note, rendered late, does not cover.
        pointer.click(shadow.x + 10, shadow.cy);
        expect(on.onPick).toHaveBeenCalledExactlyOnceWith('b', false);
    });

    it('reports a stroke from one note to another as an arrow, and shows it on the way', () => {
        const on = handlers();
        const { boxOf, pointer, all, one } = mount(on);
        const [a, c] = [boxOf('[data-note="a"]'), boxOf('[data-note="c"]')];
        pointer.down(a.cx, a.cy);
        pointer.move(a.cx + 30, a.cy - 40);
        // On the way, over empty paper, it is a stroke like any other.
        expect(all('[data-preview="arrow"]')).toHaveLength(0);
        pointer.move(c.cx, c.cy);
        expect(one('[data-preview]').getAttribute('data-preview')).toBe('arrow');
        pointer.up(c.cx, c.cy);
        expect(on.onStroke).toHaveBeenCalledExactlyOnceWith({ kind: 'arrow', from: 0, to: 2160, notes: ['a', 'c'] }, false);
        expect(on.onPick).not.toHaveBeenCalled();
        expect(all('[data-preview]')).toHaveLength(0);
    });

    it('points an arrow forwards in the score whichever way it was drawn', () => {
        const on = handlers();
        const { boxOf, pointer } = mount(on);
        const [a, c] = [boxOf('[data-note="a"]'), boxOf('[data-note="c"]')];
        pointer.drag({ x: c.cx, y: c.cy }, { x: a.cx, y: a.cy });
        expect(on.onStroke).toHaveBeenCalledExactlyOnceWith({ kind: 'arrow', from: 0, to: 2160, notes: ['a', 'c'] }, false);
    });

    it('makes no arrow within one chord: a stroke between its notes takes them as it would any others', () => {
        const on = handlers();
        const { boxOf, pointer } = mount(on);
        const [a, d] = [boxOf('[data-note="a"]'), boxOf('[data-note="d"]')];
        // From the head of the one to the head of the other, a second in.
        pointer.drag({ x: a.x + 5, y: a.cy }, { x: d.x + 9, y: d.cy });
        expect(on.onStroke).toHaveBeenCalledExactlyOnceWith({ kind: 'span', from: 0, to: 720, notes: ['d', 'a'] }, false);
    });

    it('reports a flat stroke as a passage, of every note that begins under it', () => {
        const on = handlers();
        const { pointer, one } = mount(on);
        pointer.down(190, 300);
        pointer.move(330, 306);
        expect(one('[data-preview]').getAttribute('data-preview')).toBe('span');
        pointer.up(330, 306);
        // `b` at 2.4 s, and `c` and `e` at 3 s; the stretch ends at the next date of the score.
        expect(on.onStroke).toHaveBeenCalledExactlyOnceWith({ kind: 'span', from: 720, to: 2160, notes: ['b', 'e', 'c'] }, false);
        expect(on.onSeek).not.toHaveBeenCalled();
    });

    it('reports a tall stroke as a box of the notes it reaches down to', () => {
        const on = handlers();
        const { boxOf, pointer, one } = mount(on);
        const [b, c] = [boxOf('[data-note="b"]'), boxOf('[data-note="c"]')];
        pointer.down(b.x - 20, c.y - 20);
        pointer.move(c.x + 30, b.y + b.h + 20);
        expect(one('[data-preview]').getAttribute('data-preview')).toBe('box');
        pointer.up(c.x + 30, b.y + b.h + 20);
        // Under the same stroke `e` begins too, in the other hand, and is left out.
        expect(on.onStroke).toHaveBeenCalledExactlyOnceWith({ kind: 'box', from: 720, to: 2160, notes: ['b', 'c'] }, false);
    });

    it('says when a stroke is to be added to what is in hand', () => {
        const on = handlers();
        const { pointer } = mount(on);
        pointer.drag({ x: 190, y: 300 }, { x: 330, y: 306 }, { shiftKey: true });
        expect(on.onStroke).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'span' }), true);
    });

    it('reports nothing for a stroke that takes no note', () => {
        const on = handlers();
        const { pointer } = mount(on);
        pointer.drag(nowhere, { x: nowhere.x + 150, y: nowhere.y + 4 });
        for (const handler of Object.values(on)) expect(handler).not.toHaveBeenCalled();
    });

    it('reports a click on nothing as a place to play from', () => {
        const on = handlers();
        const { pointer } = mount(on);
        pointer.click(nowhere.x, nowhere.y);
        expect(on.onSeek).toHaveBeenCalledExactlyOnceWith(8000);
        expect(on.onPick).not.toHaveBeenCalled();
    });

    it('seeks from the ruler, and takes any stroke along it for a passage', () => {
        const on = handlers();
        const { pointer, boxOf } = mount(on);
        pointer.click(150, 5);
        expect(on.onSeek).toHaveBeenCalledExactlyOnceWith(1500);
        // Down the roll from the ruler, over where `a` is: still a passage, and no pick.
        const a = boxOf('[data-note="a"]');
        pointer.drag({ x: a.x - 10, y: 5 }, { x: a.x + 20, y: a.cy });
        expect(on.onStroke).toHaveBeenCalledExactlyOnceWith({ kind: 'span', from: 0, to: 720, notes: ['d', 'a'] }, false);
        expect(on.onPick).not.toHaveBeenCalled();
    });

    it('reports a click on the words of a remark, and never takes it for what is under them', () => {
        const on = handlers();
        const { wordsOf } = mount(on);
        const words = screen.getByText('steady here');
        const { cx, cy } = wordsOf('passage');
        fireEvent.pointerDown(words, { clientX: cx, clientY: cy });
        fireEvent.pointerUp(words, { clientX: cx, clientY: cy });
        fireEvent.click(words);
        expect(on.onRemark).toHaveBeenCalledExactlyOnceWith('passage');
        expect(on.onPick).not.toHaveBeenCalled();
        expect(on.onSeek).not.toHaveBeenCalled();
    });

    it('reports a click on a brace as a click on its remark', () => {
        const on = handlers();
        const { pointer, boxOf, one } = mount(on);
        const band = boxOf('[data-remark="passage"] rect');
        pointer.click(band.cx, band.cy, undefined, one('[data-remark="passage"] rect'));
        expect(on.onRemark).toHaveBeenCalledExactlyOnceWith('passage');
        expect(on.onSeek).not.toHaveBeenCalled();
    });

    it('reports a click on a remark about the whole piece', () => {
        const on = handlers();
        mount(on);
        fireEvent.click(screen.getByText('arpeggio throughout'));
        expect(on.onRemark).toHaveBeenCalledExactlyOnceWith('all');
    });

    it('reports the remark the pointer comes to rest on, once, and when it leaves', () => {
        const on = handlers();
        const { pointer, roll, boxOf, one } = mount(on);
        // On the brace, and along it.
        const band = boxOf('[data-remark="passage"] rect');
        pointer.move(band.cx, band.cy, undefined, one('[data-remark="passage"] rect'));
        pointer.move(band.cx + 20, band.cy, undefined, one('[data-remark="passage"] rect'));
        expect(on.onHover.mock.calls).toEqual([['passage']]);
        pointer.move(nowhere.x, nowhere.y);
        expect(on.onHover.mock.calls).toEqual([['passage'], [null]]);
        // On the words of another, and off them.
        fireEvent.pointerEnter(one('[data-words="line"]'));
        fireEvent.pointerLeave(one('[data-words="line"]'));
        expect(on.onHover.mock.calls).toEqual([['passage'], [null], ['line'], [null]]);
        // Off the roll and on to what is written over it, and away.
        fireEvent.pointerLeave(roll());
        fireEvent.pointerMove(screen.getByText('arpeggio throughout'), { clientX: 20, clientY: 10 });
        fireEvent.pointerLeave(one('[data-layer="lanes"]'));
        expect(on.onHover.mock.calls).toEqual([['passage'], [null], ['line'], [null], ['all'], [null]]);
    });

    it('shows how far the note under the pointer is from where it was played', () => {
        const { pointer, boxOf, all, one } = mount();
        const b = boxOf('[data-note="b"]');
        expect(all('[data-apart]')).toHaveLength(0);
        pointer.move(b.cx, b.cy);
        expect(one('[data-apart]').getAttribute('data-apart')).toBe('b');
        // From where the note begins to where its shadow does.
        expect(Number(one('[data-apart] line').getAttribute('x1'))).toBe(240);
        expect(Number(one('[data-apart] line').getAttribute('x2'))).toBe(200);
        pointer.move(nowhere.x, nowhere.y);
        expect(all('[data-apart]')).toHaveLength(0);
        // That is for reading, and is shown to a reader who may not write as well.
        const viewer = mount({ editable: false });
        viewer.pointer.move(b.cx, b.cy);
        expect(viewer.all('[data-apart]')).toHaveLength(1);
        expect(viewer.roll().style.cursor).toBe('default');
    });

    it('reports a click on the line that waits over the roll as a remark about the whole piece', () => {
        const on = handlers();
        const { one } = mount(on);
        expect(screen.getByText('write here about the whole piece…')).toBeInTheDocument();
        fireEvent.click(one('[data-prompt] rect'));
        expect(on.onStroke).toHaveBeenCalledExactlyOnceWith({ kind: 'piece', from: 0, to: 5760, notes: [] }, false);
        expect(on.onRemark).not.toHaveBeenCalled();
    });

    it('says more on that line while nothing has been said yet', () => {
        mount({ remarks: [] });
        expect(screen.getByText(/write here about the whole piece, or drag across the notes/)).toBeInTheDocument();
    });

    it('lets a finger tap but not draw, since a finger scrolls the roll', () => {
        const on = handlers();
        const { boxOf, pointer } = mount(on);
        const [a, c] = [boxOf('[data-note="a"]'), boxOf('[data-note="c"]')];
        pointer.drag({ x: a.cx, y: a.cy }, { x: c.cx, y: c.cy }, { pointerType: 'touch' });
        expect(on.onStroke).not.toHaveBeenCalled();
        expect(on.onPick).not.toHaveBeenCalled();
        pointer.click(a.cx, a.cy, { pointerType: 'touch' });
        expect(on.onPick).toHaveBeenCalledExactlyOnceWith('a', false);
    });

    it('ignores any button but the first', () => {
        const on = handlers();
        const { boxOf, pointer } = mount(on);
        const a = boxOf('[data-note="a"]');
        pointer.click(a.cx, a.cy, { button: 2 });
        for (const handler of Object.values(on)) expect(handler).not.toHaveBeenCalled();
    });

    it('drops a stroke that is cancelled', () => {
        const on = handlers();
        const { pointer, roll, all } = mount(on);
        pointer.down(190, 300);
        pointer.move(330, 306);
        fireEvent.pointerCancel(roll());
        expect(all('[data-preview]')).toHaveLength(0);
        pointer.up(330, 306);
        expect(on.onStroke).not.toHaveBeenCalled();
    });
});

describe('DescribeRoll in the viewer', () => {
    const handlers = () => ({ onPick: vi.fn(), onStroke: vi.fn(), onRemark: vi.fn(), onHover: vi.fn(), onSeek: vi.fn() });

    it('draws the same roll', () => {
        const { all } = mount({ editable: false });
        expect(all('[data-note]')).toHaveLength(6);
        expect(ids(all('[data-shadow]'), 'data-shadow').sort()).toEqual(['b', 'c']);
        for (const { text } of remarks) expect(screen.getByText(text)).toBeInTheDocument();
    });

    it('takes no strokes and picks no notes', () => {
        const on = handlers();
        const { boxOf, pointer, all } = mount({ ...on, editable: false });
        const [a, c] = [boxOf('[data-note="a"]'), boxOf('[data-note="c"]')];
        pointer.down(a.cx, a.cy);
        pointer.move(c.cx, c.cy);
        expect(all('[data-preview]')).toHaveLength(0);
        pointer.up(c.cx, c.cy);
        pointer.drag({ x: 190, y: 300 }, { x: 330, y: 306 });
        pointer.click(a.cx, a.cy);
        expect(on.onStroke).not.toHaveBeenCalled();
        expect(on.onPick).not.toHaveBeenCalled();
    });

    it('still calls up a remark, says which one the pointer is on, and seeks', () => {
        const on = handlers();
        const { pointer, boxOf, one } = mount({ ...on, editable: false });
        fireEvent.pointerEnter(one('[data-words="passage"]'));
        fireEvent.click(screen.getByText('steady here'));
        fireEvent.click(screen.getByText('arpeggio throughout'));
        const band = boxOf('[data-remark="passage"] rect');
        pointer.click(band.cx, band.cy, undefined, one('[data-remark="passage"] rect'));
        expect(on.onHover).toHaveBeenCalledExactlyOnceWith('passage');
        expect(on.onRemark.mock.calls).toEqual([['passage'], ['all'], ['passage']]);
        pointer.click(800, 300);
        expect(on.onSeek).toHaveBeenCalledExactlyOnceWith(8000);
    });

    it('keeps no line waiting to be written on', () => {
        const { all } = mount({ editable: false });
        expect(all('[data-prompt]')).toHaveLength(0);
        expect(screen.queryByText(/write here/)).toBeNull();
    });
});
