import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { VerovioToolkit } from 'verovio/esm';
import { loadVerovio, renderScore } from '../../verovio/toolkit';
import type { Segment } from '../../model/Reconstruction';
import type { PerformanceReader } from '../../utils/mpm';
import { getLaneColor } from '../spanColors';
import { SYMBOLIC_RECORDING, type ScoreNote } from './bandMei';
import { buildSigns, laneLayout, type BandGeometry, type NotePlacement, type Sign } from './signs';

/**
 * The score in the middle of the tree: the notes on the tree's own tick axis, and every
 * instruction the reconstruction claims drawn into them as a sign.
 *
 * Engraving takes a few hundred milliseconds, so it happens once per zoom the reader settles on.
 * In between, the last engraving is stretched to the new zoom, which keeps it on the axis while
 * a drag is still moving.
 */

/** verovio's `scale` for the band, and the MEI unit it is drawn in. */
const SCALE = 45;
const UNIT = 9;
/** How many pixels one tick takes per unit of `performanceScale`, at one millisecond per tick. */
const PX_PER_TICK_PER_SCALE = ((UNIT * 10) / 1000) * (SCALE / 1000);
const RE_ENGRAVE_AFTER_MS = 250;
/** Before the first engraving the band holds this much room, so the tree does not jump twice. */
const PROVISIONAL_HEIGHT = 200;

const engrave = (toolkit: VerovioToolkit, mei: string, pxPerTick: number): string =>
    renderScore(toolkit, mei, {
        performanceAlignment: true,
        performanceRecording: SYMBOLIC_RECORDING,
        performanceBreaks: 'time',
        performanceSystemDuration: 3600,
        performanceScale: Math.min(1000, Math.max(0.1, pxPerTick / PX_PER_TICK_PER_SCALE)),
        performanceUnmatched: 'plain',
        performanceVelocityOpacity: false,
        performanceRuler: false,
        adjustPageWidth: true,
        adjustPageHeight: true,
        scale: SCALE,
        unit: UNIT,
        pageMarginLeft: 0,
        pageMarginRight: 0,
        pageMarginTop: 0,
        pageMarginBottom: 0,
    })[0] ?? '';

const median = (values: number[]) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};

interface Measured {
    geometry: BandGeometry;
    /** Where the engraving's own tick 0 lies, which the band shifts to the axis's. */
    offset: number;
    padTop: number;
    height: number;
}

/** Read where verovio put everything, with the engraving's left edge at x 0 and tick 0 at `offset`. */
const measure = (root: HTMLElement, scoreNotes: ReadonlyMap<string, ScoreNote>, pxPerTick: number, end: number): Measured | null => {
    const svg = root.querySelector('svg');
    if (!svg) return null;
    const base = svg.getBoundingClientRect();
    if (base.width === 0) return null;

    const notes = new Map<string, NotePlacement>();
    const shifts: number[] = [];
    for (const g of root.querySelectorAll<SVGGElement>('g.note[data-id]')) {
        const id = g.getAttribute('data-id');
        if (!id) continue;
        const head = g.querySelector('.notehead') ?? g;
        const rect = head.getBoundingClientRect();
        const staff = Number(g.closest('g.staff')?.getAttribute('data-n') ?? 1);
        notes.set(id, { x: rect.left - base.left, width: rect.width, top: rect.top - base.top, bottom: rect.bottom - base.top, staff });
        const note = scoreNotes.get(id);
        if (note) shifts.push(rect.left - base.left - note.date * pxPerTick);
    }

    const staves = new Map<number, { top: number; bottom: number }>();
    for (const g of root.querySelectorAll<SVGGElement>('g.staff[data-n]')) {
        const n = Number(g.getAttribute('data-n'));
        if (staves.has(n)) continue;
        const lines = [...g.children].filter((child) => child.tagName.toLowerCase() === 'path');
        if (lines.length === 0) continue;
        const rects = lines.map((line) => line.getBoundingClientRect());
        staves.set(n, { top: Math.min(...rects.map((x) => x.top)) - base.top, bottom: Math.max(...rects.map((x) => x.bottom)) - base.top });
    }
    const upper = staves.get(1);
    const staffSpace = upper ? (upper.bottom - upper.top) / 4 : 8;

    const offset = median(shifts);
    const geometry: BandGeometry = {
        x: (tick) => tick * pxPerTick,
        staffSpace,
        staves: new Map([...staves].map(([n, s]) => [n, s])),
        notes: new Map([...notes].map(([id, n]) => [id, { ...n, x: n.x - offset }])),
        scoreNotes,
        end,
    };
    const lanes = laneLayout(geometry);
    const padTop = Math.max(4, 1.6 * staffSpace - lanes.tempo);
    const padBottom = Math.max(4, lanes.soft + staffSpace - base.height);
    const shift = (y: number) => y + padTop;
    return {
        offset,
        padTop,
        height: Math.ceil(padTop + base.height + padBottom),
        geometry: {
            ...geometry,
            staves: new Map([...geometry.staves].map(([n, s]) => [n, { top: shift(s.top), bottom: shift(s.bottom) }])),
            notes: new Map([...geometry.notes].map(([id, n]) => [id, { ...n, top: shift(n.top), bottom: shift(n.bottom) }])),
        },
    };
};

export interface SignFocus {
    elementId: string;
    anchor: Element;
}

interface ScoreBandProps {
    /** The prepared MEI, see `prepareBandMei`. */
    mei: string;
    scoreNotes: readonly ScoreNote[];
    segments: Segment[];
    mpm: PerformanceReader;
    /** Pixels per tick: the tree's zoom. */
    pxPerTick: number;
    width: number;
    spotlit: ReadonlySet<string>;
    locked: ReadonlySet<string>;
    onHeight: (height: number) => void;
    onSegmentHover: (segmentId: string | null) => void;
    onSegmentLock: (segmentId: string) => void;
    onSignFocus: (focus: SignFocus | null) => void;
    onBackgroundClick: () => void;
}

export const ScoreBand = memo(function ScoreBand({
    mei,
    scoreNotes,
    segments,
    mpm,
    pxPerTick,
    width,
    spotlit,
    locked,
    onHeight,
    onSegmentHover,
    onSegmentLock,
    onSignFocus,
    onBackgroundClick,
}: ScoreBandProps) {
    const toolkit = useRef<Promise<VerovioToolkit> | null>(null);
    const engraving = useRef<HTMLDivElement>(null);
    const [engraved, setEngraved] = useState<{ svg: string; pxPerTick: number } | null>(null);
    const [measured, setMeasured] = useState<Measured | null>(null);
    const [error, setError] = useState<string | null>(null);

    const notesById = useMemo(() => new Map(scoreNotes.map((note) => [note.id, note])), [scoreNotes]);
    const end = useMemo(() => Math.max(0, ...scoreNotes.map((note) => note.date + note.duration)), [scoreNotes]);

    // Engrave on load, and again once a new zoom has stayed put for a moment.
    const engravedAt = engraved?.pxPerTick;
    useEffect(() => {
        if (engravedAt !== undefined && Math.abs(pxPerTick / engravedAt - 1) < 0.02) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            toolkit.current ??= loadVerovio();
            toolkit.current
                .then((tk) => {
                    if (cancelled) return;
                    setEngraved({ svg: engrave(tk, mei, pxPerTick), pxPerTick });
                    setError(null);
                })
                .catch((reason: unknown) => {
                    if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
                });
        }, engravedAt === undefined ? 0 : RE_ENGRAVE_AFTER_MS);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [mei, pxPerTick, engravedAt]);

    // Measure the engraving as drawn, unstretched.
    useLayoutEffect(() => {
        const root = engraving.current;
        if (!root || !engraved) return;
        const container = root.parentElement;
        const saved = container?.style.transform ?? '';
        if (container) container.style.transform = 'none';
        const next = measure(root, notesById, engraved.pxPerTick, end);
        if (container) container.style.transform = saved;
        setMeasured(next);
    }, [engraved, notesById, end]);

    const height = measured?.height ?? PROVISIONAL_HEIGHT;
    useEffect(() => onHeight(height), [height, onHeight]);

    const signs = useMemo(
        () => (measured ? buildSigns(segments, mpm, measured.geometry) : []),
        [measured, segments, mpm],
    );

    const anyLit = spotlit.size > 0;
    const stretch = engraved ? pxPerTick / engraved.pxPerTick : 1;

    // Two steps: a word lights its signs, and a sign shows its own instruction's encoding. The
    // sign keeps its segment lit, so the way from the word into the score keeps the others in
    // view; the stack ignores this while a word is held open.
    const handle = (sign: Sign, entering: boolean, target: Element) => {
        onSignFocus(entering ? { elementId: sign.elementId, anchor: target } : null);
        onSegmentHover(entering ? sign.segmentIds[0] : null);
    };

    return (
        <div
            className="scoreBand"
            style={{ position: 'relative', width, height, overflow: 'hidden', background: '#fdfdfc', borderBlock: '1px solid #e5e7eb' }}
            onClick={onBackgroundClick}
        >
            {error && <div style={{ padding: 8, color: '#b91c1c', fontSize: 12 }}>The score could not be engraved: {error}</div>}
            <div style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', transform: `scaleX(${String(stretch)})` }}>
                <div
                    ref={engraving}
                    aria-hidden
                    style={{
                        position: 'absolute',
                        left: -(measured?.offset ?? 0),
                        top: measured?.padTop ?? 0,
                        color: '#3f4651',
                        opacity: measured ? 0.9 : 0,
                        pointerEvents: 'none',
                    }}
                    dangerouslySetInnerHTML={{ __html: engraved?.svg ?? '' }}
                />
                <svg
                    width={engraved ? width / stretch : width}
                    height={height}
                    style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
                    role="group"
                    aria-label="The reconstruction's instructions, drawn in the score"
                >
                    {signs.map((sign) => {
                        const lit = sign.segmentIds.some((id) => spotlit.has(id));
                        const color = getLaneColor(sign.type);
                        const opacity = anyLit ? (lit ? 1 : 0.14) : 0.55;
                        return (
                            <g
                                key={sign.elementId}
                                data-element={sign.elementId}
                                data-type={sign.type}
                                opacity={opacity}
                                style={{ cursor: 'pointer', transition: 'opacity 0.18s ease' }}
                                onPointerEnter={(event) => handle(sign, true, event.currentTarget)}
                                onPointerLeave={(event) => handle(sign, false, event.currentTarget)}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    if (!sign.segmentIds.some((id) => locked.has(id))) onSegmentLock(sign.segmentIds[0]);
                                }}
                            >
                                <path d={sign.stroke + sign.fill} fill="none" stroke="transparent" strokeWidth={12} vectorEffect="non-scaling-stroke" />
                                {sign.stroke && (
                                    <path
                                        d={sign.stroke}
                                        fill="none"
                                        stroke={color}
                                        strokeWidth={lit ? 2.2 : 1.4}
                                        strokeDasharray={sign.dashed ? '4 3' : undefined}
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        vectorEffect="non-scaling-stroke"
                                    />
                                )}
                                {sign.fill && <path d={sign.fill} fill={color} />}
                            </g>
                        );
                    })}
                </svg>
            </div>
        </div>
    );
});
