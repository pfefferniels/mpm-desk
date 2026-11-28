import {
    clamp,
    crisp,
    GUTTER_STAFF,
    liftOf,
    PEDAL,
    pedalY,
    rowOf,
    RULER,
    SIGN,
    staffRows,
    TOP,
    xOf,
    yOf,
    type BarLine,
    type Frame,
    type Notation,
    type PlacedNote,
} from './geometry';
import { ACCIDENTAL_GLYPH, accidentalBaseline, accidentalSize, clefSize, F_CLEF, G_CLEF, MUSIC_FONT } from './smufl';
import { BASS, signatureMarks, TREBLE, type Signature } from './staff';
import { DESCRIBED, GRACE, LEFT_HAND, RIGHT_HAND, type Tones } from './tones';
import type { PedalKind, RollGrace, RollPedals } from './types';

/**
 * The music as the roll draws it, layer by layer in the order they lie on one another: the
 * staves, the bar lines, the shadows, the notes, the pedals, and over them the ruler and the
 * playhead; and beside the roll, the gutter.
 *
 * Each layer is handed where things are and draws them; none of them knows of the pointer.
 */

// ---------------------------------------------------------------------------------------------
// Under the notes
// ---------------------------------------------------------------------------------------------

/** The two staves, or a line under every C. */
export const Staves = ({ frame, width, tones }: { frame: Frame; width: number; tones: Tones }) => {
    const rows: number[] = [];
    if (frame.staff) rows.push(...staffRows(frame));
    else for (let pitch = Math.ceil(frame.low / 12) * 12; pitch <= frame.high; pitch += 12) rows.push(pitch - 0.5);
    return (
        <path
            data-layer="staves"
            d={rows.map((row) => `M0 ${String(crisp(yOf(frame, row)))}H${String(width)}`).join('')}
            fill="none"
            stroke={frame.staff ? tones.faint : tones.rule}
            strokeOpacity={0.8}
            pointerEvents="none"
        />
    );
};

interface BarsProps {
    lines: readonly BarLine[];
    beats: readonly number[];
    frame: Frame;
    tones: Tones;
}

/** Bar and beat lines where the tempo so far puts them; a bar line is dashed where that tempo is only assumed. */
export const Bars = ({ lines, beats, frame, tones }: BarsProps) => {
    const upright = (x: number, from: number) => `M${String(crisp(x))} ${String(from)}V${String(frame.bottom)}`;
    const bars = (assumed: boolean) =>
        lines
            .filter((line) => line.assumed === assumed)
            .map((line) => upright(line.x, frame.top - 5))
            .join('');
    return (
        <g data-layer="bars" fill="none" pointerEvents="none">
            <path d={beats.map((x) => upright(x, frame.top)).join('')} stroke={tones.rule} strokeOpacity={0.9} />
            <path data-bars="described" d={bars(false)} stroke={tones.soft} strokeOpacity={0.7} />
            <path data-bars="assumed" d={bars(true)} stroke={tones.faint} strokeOpacity={0.6} strokeDasharray="3 4" />
        </g>
    );
};

// ---------------------------------------------------------------------------------------------
// The notes
// ---------------------------------------------------------------------------------------------

/** Which notes stand out, and how far the others are taken back. */
export interface Dimming {
    keep: ReadonlySet<string>;
    /** How much of a note's ink is left once it is dimmed. */
    left: number;
}

const round = (rect: { w: number; h: number }) => Math.min(2.5, rect.w / 2, rect.h / 2);

interface ShadowsProps {
    placed: readonly PlacedNote[];
    dimming: Dimming | null;
    tones: Tones;
}

/**
 * The notes as they were played, gray and dashed behind the notes: drawn only where one differs
 * visibly from its note, so that a note covering its shadow leaves nothing to see. A note the
 * recording was corrected in has a second, dotted outline where the roll had it.
 */
export const Shadows = ({ placed, dimming, tones }: ShadowsProps) => (
    <g data-layer="shadows" pointerEvents="none">
        {placed.map(({ note, was, shadowed, arrived }) => {
            const dim = dimming !== null && !dimming.keep.has(note.id);
            return (
                <g key={note.id}>
                    {shadowed && (
                        <rect
                            data-shadow={note.id}
                            x={was.x + 0.5}
                            y={was.y + 0.5}
                            width={Math.max(1, was.w - 1)}
                            height={Math.max(1, was.h - 1)}
                            rx={round(was)}
                            fill={tones.soft}
                            // A shadow stays fainter than any note, and within that the louder is the darker.
                            fillOpacity={(0.08 + 0.48 * (was.ink - 0.3)) * (dim ? 0.3 : 1)}
                            stroke={tones.soft}
                            strokeOpacity={dim ? 0.18 : 0.7}
                            strokeDasharray="3 2"
                        />
                    )}
                    {arrived && (
                        <rect
                            data-arrived={note.id}
                            x={arrived.x + 0.5}
                            y={arrived.y + 0.5}
                            width={Math.max(1, arrived.w - 1)}
                            height={Math.max(1, arrived.h - 1)}
                            rx={round(arrived)}
                            fill="none"
                            stroke={tones.soft}
                            strokeOpacity={dim ? 0.15 : 0.6}
                            strokeDasharray="1 3"
                        />
                    )}
                </g>
            );
        })}
    </g>
);

interface NotesProps {
    placed: readonly PlacedNote[];
    frame: Frame;
    dimming: Dimming | null;
    tones: Tones;
}

/**
 * The notes as the MPM so far renders them: each a box on its line or in its space, in its hand's
 * colour, the louder the taller and the more solid, with its ledger lines and, where it departs
 * from the key signature, its accidental.
 */
export const Notes = ({ placed, frame, dimming, tones }: NotesProps) => {
    // Loudest first, so that a soft note over a loud one stays visible.
    const order = [...placed].sort((a, b) => b.note.rendered.velocity - a.note.rendered.velocity);
    const ledgers = placed
        .flatMap(({ now, ledgers: lines }) => lines.map((y) => `M${String(now.x - 5)} ${String(crisp(y))}H${String(now.x + now.w + 5)}`))
        .join('');
    const size = accidentalSize(frame.rowHeight);
    return (
        <g data-layer="notes" pointerEvents="none">
            <path data-ledgers d={ledgers} fill="none" stroke={tones.soft} strokeOpacity={0.75} />
            {order.map(({ note, now, y, accidental }) => {
                const dim = dimming !== null && !dimming.keep.has(note.id);
                const left = dim && dimming ? dimming.left : 1;
                const hand = note.part === 1 ? RIGHT_HAND : LEFT_HAND;
                const edge = Math.min(1, now.ink + 0.25) * left;
                return (
                    <g key={note.id}>
                        <rect
                            data-note={note.id}
                            data-part={note.part}
                            data-dim={dim || undefined}
                            x={now.x}
                            y={now.y}
                            width={now.w}
                            height={now.h}
                            rx={round(now)}
                            fill={hand}
                            fillOpacity={now.ink * left}
                        />
                        {/* Its head, drawn firmer: where one note ends and the next begins on the same row would not show otherwise. */}
                        <rect x={now.x} y={now.y} width={Math.min(2, now.w)} height={now.h} fill={hand} fillOpacity={edge} />
                        {accidental !== null && (
                            <text
                                data-accidental={note.id}
                                x={now.x - 2.5}
                                y={accidentalBaseline(y, size)}
                                textAnchor="end"
                                fontFamily={MUSIC_FONT}
                                fontSize={size}
                                fill={hand}
                                fillOpacity={edge}
                            >
                                {ACCIDENTAL_GLYPH.get(accidental)}
                            </text>
                        )}
                    </g>
                );
            })}
        </g>
    );
};

/** How far the note under the pointer is from where it was played: a line between the two, and the shadow outlined. */
export const Apart = ({ entry, tones }: { entry: PlacedNote; tones: Tones }) => (
    <g data-apart={entry.note.id} fill="none" stroke={tones.trouble} strokeWidth={1.5} strokeOpacity={0.9} pointerEvents="none">
        <line x1={entry.now.x} y1={crisp(entry.y)} x2={entry.was.x} y2={crisp(entry.y)} />
        <rect x={entry.was.x + 0.5} y={entry.was.y + 0.5} width={Math.max(1, entry.was.w - 1)} height={Math.max(1, entry.was.h - 1)} rx={round(entry.was)} />
    </g>
);

interface GracesProps {
    graces: readonly RollGrace[];
    notation: Notation;
    frame: Frame;
    pxPerSecond: number;
    /** Taken back with the notes while a remark is lit. */
    dimmed: boolean;
}

/** The grace notes, each a small wedge where it was struck: the score gives them no time to be drawn against. */
export const Graces = ({ graces, notation, frame, pxPerSecond, dimmed }: GracesProps) => {
    const size = clamp(frame.unit, 5, 13);
    return (
        <g data-layer="graces" fill={GRACE} fillOpacity={dimmed ? 0.25 : 0.85} pointerEvents="none">
            {graces.map((grace) => {
                const place = notation.written.get(grace.id);
                if (!place) return null;
                const x = xOf(grace.ms, pxPerSecond);
                const y = yOf(frame, rowOf(frame, place));
                return (
                    <path
                        key={grace.id}
                        data-grace={grace.id}
                        d={`M${String(x)} ${String(y - size * 0.7)}L${String(x + size)} ${String(y)}L${String(x)} ${String(y + size * 0.7)}Z`}
                    />
                );
            })}
        </g>
    );
};

interface PedalsProps {
    pedals: RollPedals;
    rows: readonly { kind: PedalKind }[];
    frame: Frame;
    shadows: boolean;
    pxPerSecond: number;
    /** Where the last move of a pedal is held until. */
    end: number;
    tones: Tones;
}

/** Under the notes, in the same manner: a press as it was recorded is a shadow, and what the MPM moves is solid. */
export const Pedals = ({ pedals, rows, frame, shadows, pxPerSecond, end, tones }: PedalsProps) => (
    <g data-layer="pedals" pointerEvents="none">
        {rows.map(({ kind }, row) => {
            const y = pedalY(frame, row);
            const moves = pedals.rendered.filter((move) => move.kind === kind);
            const depths = moves
                .map((move, i) => {
                    const depth = (move.value / 127) * PEDAL;
                    const xa = xOf(move.ms, pxPerSecond);
                    const xb = xOf(i + 1 < moves.length ? moves[i + 1].ms : end, pxPerSecond);
                    return depth >= 0.5 && xb > xa ? `M${String(xa)} ${String(y + PEDAL - depth)}H${String(xb)}V${String(y + PEDAL)}H${String(xa)}Z` : '';
                })
                .join('');
            return (
                <g key={kind} data-pedal={kind}>
                    {shadows &&
                        pedals.played
                            .filter((press) => press.kind === kind)
                            .map((press, i) => {
                                const xa = xOf(press.ms, pxPerSecond);
                                const xb = xOf(press.msEnd, pxPerSecond);
                                return (
                                    <rect
                                        // By its place in the list: nothing says two presses cannot begin together.
                                        key={i}
                                        data-press={kind}
                                        x={xa + 0.5}
                                        y={y + 0.5}
                                        width={Math.max(1, xb - xa - 1)}
                                        height={PEDAL - 1}
                                        fill={tones.pencil}
                                        fillOpacity={0.1}
                                        stroke={tones.pencil}
                                        strokeOpacity={0.6}
                                        strokeDasharray="3 2"
                                    />
                                );
                            })}
                    <path data-moves={kind} d={depths} fill={tones.pencil} fillOpacity={0.8} />
                </g>
            );
        })}
    </g>
);

// ---------------------------------------------------------------------------------------------
// Over the notes, and beside them
// ---------------------------------------------------------------------------------------------

interface RulerProps {
    lines: readonly BarLine[];
    /** The stretches whose tempo is described, in pixels. */
    described: readonly (readonly [number, number])[];
    width: number;
    tones: Tones;
}

/** The ruler: the bar numbers, paler where the tempo is only assumed, and a line under what has a tempo of its own. */
export const Ruler = ({ lines, described, width, tones }: RulerProps) => (
    <g data-layer="ruler" pointerEvents="none">
        <rect x={0} y={0} width={width} height={RULER + 1} fill={tones.paper} />
        <line x1={0} y1={RULER + 0.5} x2={width} y2={RULER + 0.5} stroke={tones.rule} />
        {lines
            .filter((line) => line.numbered)
            .map((line) => (
                <text
                    // A bar is known by where it stands: a repeat may number two alike.
                    key={line.x}
                    data-bar={line.n}
                    x={line.x + 4}
                    y={RULER / 2 + 2}
                    dominantBaseline="central"
                    fontFamily={tones.type}
                    fontSize={11}
                    fontWeight={500}
                    fill={line.assumed ? tones.faint : tones.ink}
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                    {line.n}
                </text>
            ))}
        <path
            data-described
            d={described.map(([from, to]) => `M${String(from)} ${String(RULER - 0.5)}H${String(to)}`).join('')}
            fill="none"
            stroke={DESCRIBED}
            strokeWidth={2}
        />
    </g>
);

/** The playhead: a line hung from the ruler. */
export const Playhead = ({ x, frame, tones }: { x: number; frame: Frame; tones: Tones }) => (
    <g data-playhead transform={`translate(${String(crisp(x))} 0)`} pointerEvents="none">
        <line x1={0} y1={TOP - 6} x2={0} y2={frame.bottom} stroke={tones.ink} strokeWidth={1.5} strokeOpacity={0.85} />
        <path d={`M-5 ${String(TOP - 14)}H5L0 ${String(TOP - 6)}Z`} fill={tones.ink} />
    </g>
);

interface GutterProps {
    frame: Frame;
    width: number;
    height: number;
    signature: Signature;
    pedalRows: readonly { kind: PedalKind; label: string }[];
    tones: Tones;
}

/**
 * Beside the roll, where it stays when the roll is scrolled: the clefs and the key signature on
 * the ends of the staff lines, or the name of every C, and the names of the pedal rows.
 */
export const Gutter = ({ frame, width, height, signature, pedalRows, tones }: GutterProps) => {
    const sign = [...signature.values()].some((alter) => alter < 0) ? -1 : 1;
    const size = accidentalSize(frame.rowHeight);
    const cs: number[] = [];
    if (!frame.staff) for (let pitch = Math.ceil(frame.low / 12) * 12; pitch <= frame.high; pitch += 12) cs.push(pitch);
    const small = { fontFamily: tones.type, fontSize: 10.5, fill: tones.faint, dominantBaseline: 'central' } as const;
    return (
        <svg data-layer="gutter" width={width} height={height} viewBox={[0, 0, width, height].join(' ')} style={{ display: 'block' }} aria-hidden>
            <line x1={width - 0.5} y1={0} x2={width - 0.5} y2={height} stroke={tones.rule} />
            <line x1={0} y1={RULER + 0.5} x2={width} y2={RULER + 0.5} stroke={tones.rule} />
            {frame.staff && (
                <>
                    <path
                        d={staffRows(frame)
                            .map((row) => `M5 ${String(crisp(yOf(frame, row)))}H${String(width)}`)
                            .join('')}
                        fill="none"
                        stroke={tones.faint}
                        strokeOpacity={0.8}
                    />
                    {/* Each set on the bottom line of its staff, which is where the font has the clef stand on its own line. */}
                    <g fontFamily={MUSIC_FONT} fill={tones.soft}>
                        <text data-clef="treble" x={7} y={crisp(yOf(frame, TREBLE[0] + frame.shift))} fontSize={clefSize(frame.rowHeight)}>
                            {G_CLEF}
                        </text>
                        <text data-clef="bass" x={7} y={crisp(yOf(frame, BASS[0]))} fontSize={clefSize(frame.rowHeight)}>
                            {F_CLEF}
                        </text>
                        {(['treble', 'bass'] as const).flatMap((staff) =>
                            signatureMarks(signature, staff).map(({ step }, index) => (
                                <text
                                    key={`${staff}_${String(index)}`}
                                    data-signature={staff}
                                    x={GUTTER_STAFF - 2 + index * SIGN}
                                    y={accidentalBaseline(yOf(frame, step + liftOf(frame, staff)), size)}
                                    textAnchor="end"
                                    fontSize={size}
                                >
                                    {ACCIDENTAL_GLYPH.get(sign)}
                                </text>
                            )),
                        )}
                    </g>
                </>
            )}
            {cs.map((pitch) => (
                <text key={pitch} x={7} y={yOf(frame, pitch)} {...small}>
                    {`C${String(Math.floor(pitch / 12) - 1)}`}
                </text>
            ))}
            {pedalRows.map(({ kind, label }, row) => (
                <text key={kind} x={7} y={pedalY(frame, row) + PEDAL / 2 + 0.5} {...small}>
                    {label}
                </text>
            ))}
        </svg>
    );
};
