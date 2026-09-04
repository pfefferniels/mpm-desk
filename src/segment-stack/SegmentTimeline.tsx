import { useMemo, useState, type ReactNode } from "react";
import { Divider, Paper, Popper, Stack, type PopperPlacementType } from "@mui/material";
import type { Segment, Span } from "../model/Reconstruction";
import { controllerOf, type PerformanceReader } from "../utils/mpm";
import { beatTicksAt } from "../utils/score";
import { beatGrid, tickRange, timelineRows } from "./StackModel";
import { dynamicsCurve, pedalCurve, tempoCurve, type CurvePoint } from "./instructionCurves";
import { getLaneColor } from "./spanColors";
import { InstructionAttributes } from "./InstructionAttributes";
import { wordFor } from "./words";

/** Wide enough for `accentuationPattern`, the longest type name in the corpus. */
export const TYPE_COLUMN = 106;
/** The track a card is drawn on. A caller with more room of its own may say otherwise. */
const TRACK_WIDTH = 250;
/** A row that only has to say *when* — a bar and a beat grid fit in this. */
const BAR_ROW = 15;
/**
 * A row that has to say *what*.
 *
 * Twice a bar row and no more: every instruction type is meant to be drawn this way in the
 * end, so a row's height is multiplied by however many kinds of gesture a segment is made
 * of. Thirty pixels is about the least a curve can be read at, and it keeps the tallest
 * segment in the corpus — seven kinds — inside a card you can take in at once.
 */
const CURVE_ROW = 30;
/**
 * Also the shortest a gesture may be drawn: rounded to its own height, a gesture
 * on a single date comes out as a dot, so one rectangle does for both and
 * nothing has to be given a duration it does not have.
 */
const BAR_HEIGHT = 5;
/** Breathing room above and below a curve, so the extremes are not on the row's edge. */
const CURVE_PAD = 4;
/** The narrowest a gesture may be to still be reachable with a pointer. */
const MIN_HIT_WIDTH = 9;

/**
 * How flat a lane may read before the drawing stops magnifying it.
 *
 * Each curve is scaled to its own window, which is what makes a small shaping gesture
 * visible at all — but without a floor, a tempo that holds within a tenth of a beat per
 * minute would be drawn as a mountain range. In the units of each lane.
 */
const FLAT_FLOOR: Record<string, number> = { tempo: 6, dynamics: 6 };

/** The lanes that are drawn as what they do, rather than as when they happen. */
const DRAWN = new Set(["tempo", "dynamics", "movement"]);

interface Row {
    lane: string;
    type: string;
    label: string;
    /** `@controller`, for a `movement` row — the pedal the curve belongs to. */
    controller: string | null;
    /** Whether this lane is drawn as what it does, or still only as when it happens. */
    drawn: boolean;
    bars: { id: string; span: Span; left: number; width: number }[];
    top: number;
    height: number;
}

/**
 * The window a lane is drawn in, as the two values its row's edges stand for.
 *
 * Named by edge rather than by size because one lane runs the other way up: see
 * {@link PEDAL_PLOT}. `bottomValue` above `topValue` is a picture upside down, not a
 * mistake.
 */
interface Plot {
    bottomValue: number;
    topValue: number;
}

/**
 * The pedal's row, read the way a foot reads it: 0 at the top, 1 at the bottom.
 *
 * A sustain pedal is *pressed down*, so a picture where depressing it moves the line up is
 * a picture of the wrong gesture. Flipped, the fill hangs from the rest position and grows
 * downwards as the pedal goes down, which is the thing itself.
 *
 * Unlike tempo and dynamics this is never scaled to what happens to be in the window: 0 and
 * 1 are the ends of the dial, so the same picture always means the same thing.
 */
const PEDAL_PLOT: Plot = { bottomValue: 1, topValue: 0 };

/** The window a lane is drawn in: its own range, widened to at least {@link FLAT_FLOOR}. */
function plotOf(points: CurvePoint[], floor: number): Plot {
    let min = Infinity;
    let max = -Infinity;
    for (const point of points) {
        if (point.value < min) min = point.value;
        if (point.value > max) max = point.value;
    }
    if (!Number.isFinite(min)) return { bottomValue: 0, topValue: 1 };

    const middle = (min + max) / 2;
    const half = Math.max((max - min) / 2, floor / 2);
    // A little more than the extremes, so the peak of a swell is not clipped by the row.
    return { bottomValue: middle - half * 1.2, topValue: middle + half * 1.2 };
}

interface CurveGeometry {
    line: string;
    area: string;
    first: { x: number; y: number; value: number };
    last: { x: number; y: number; value: number };
}

/**
 * @param rest the value the shading hangs from — silence for a level, the released
 *   position for a pedal — or null for a lane that is a rate rather than a level and so
 *   has nothing to be shaded towards.
 */
function geometryOf(
    points: CurvePoint[],
    plot: Plot,
    xOf: (tick: number) => number,
    top: number,
    height: number,
    rest: number | null,
): CurveGeometry | null {
    if (points.length < 2) return null;

    const bottom = top + height - CURVE_PAD;
    const span = plot.topValue - plot.bottomValue || 1;
    const yOf = (value: number) =>
        bottom - ((value - plot.bottomValue) / span) * (height - CURVE_PAD * 2);

    const at = (point: CurvePoint) => ({
        x: xOf(point.tick),
        y: yOf(point.value),
        value: point.value,
    });

    let line = "";
    for (let i = 0; i < points.length; i++) {
        const { x, y } = at(points[i]);
        line += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }

    const first = at(points[0]);
    const last = at(points[points.length - 1]);
    // Closed against `rest`, not against the row's floor: on the pedal's flipped axis the
    // released position is the *top* edge, and shading down from it is what says "pressed".
    const base = rest === null ? bottom : yOf(rest).toFixed(1);
    return {
        line,
        area: `${line}L${last.x.toFixed(1)},${base}L${first.x.toFixed(1)},${base}Z`,
        first,
        last,
    };
}

/** A number written on the curve, kept legible wherever the curve happens to be. */
const CurveLabel = ({ x, y, anchor, color, children }: {
    x: number;
    y: number;
    anchor: "start" | "end";
    color: string;
    children: ReactNode;
}) => (
    <text
        x={x}
        y={y}
        textAnchor={anchor}
        fontSize={8.5}
        fontWeight={600}
        fill={color}
        stroke="#ffffff"
        strokeWidth={2.5}
        paintOrder="stroke"
        strokeLinejoin="round"
        pointerEvents="none"
    >
        {children}
    </text>
);

interface SegmentTimelineProps {
    segment: Segment;
    mpm: PerformanceReader;
    /** Gives a segment that acts on a single point a width to be drawn over. */
    minPointSpan: number;
    /** The gesture the pointer is on, and how to say so — null while the card is untouchable. */
    hovered: Span | null;
    onHover: ((span: Span | null) => void) | null;
    /** How wide the tracks are drawn. Defaults to {@link TRACK_WIDTH}, what a card affords. */
    trackWidth?: number;
    /**
     * Whether a lane that is already drawn as a curve may still be pointed at.
     *
     * False in the card, where the pane under it exists to stand in for a drawing that does not
     * exist yet. True where the source itself is the point — the narrative desk quotes a
     * `<tempo>`'s own `@bpm` beside the curve of it, because there the question is what the
     * document says, not what it sounds like.
     */
    reachDrawn?: boolean;
}

/**
 * A segment's gestures, each drawn as the thing it does.
 *
 * Every row shares one axis, the segment's own stretch, beat-gridded, so the picture reads
 * down a column as well as along a line: where the tempo gave way, and what the pedal was
 * doing while it did.
 *
 * Three lanes are drawn as curves so far. `tempo` and `dynamics` are each scaled to their own
 * window, since what matters about a shaping gesture is its shape rather than where it sits
 * on an absolute scale a two-hundred-pixel card could not label; the endpoint numbers give
 * the absolute reading back. The pedal is neither scaled nor the same way up; see
 * {@link PEDAL_PLOT}.
 *
 * The curves are drawn across the whole card rather than only the stretch the segment claims,
 * an instruction being legible only against what it interrupts. What the segment claims is
 * tinted underneath.
 *
 * A lane with a drawing carries no pointer target: the pane under the card stands in for a
 * drawing that does not exist yet rather than glossing one that does.
 */
export const SegmentTimeline = ({
    segment,
    mpm,
    minPointSpan,
    hovered,
    onHover,
    trackWidth = TRACK_WIDTH,
    reachDrawn = false,
}: SegmentTimelineProps) => {
    const { from, to } = useMemo(() => tickRange(segment, minPointSpan), [segment, minPointSpan]);

    const rows = useMemo(() => {
        /** The sustain pedal and the soft one share a map and share nothing else. */
        const controllerOfSpan = (span: Span) => {
            for (const id of span.elements) {
                const instruction = mpm.byId(id);
                if (instruction) return controllerOf(instruction);
            }
            return null;
        };

        const controllers = new Map<string, string>();
        const laneOf = (span: Span) => {
            if (span.type !== "movement") return span.type;
            const controller = controllerOfSpan(span);
            // Without one there is no curve to draw and nothing to divide by, so the
            // gesture falls back to the row every other type gets.
            if (controller === null) return span.type;
            const lane = `movement:${controller}`;
            controllers.set(lane, controller);
            return lane;
        };

        // Stacked by folding rather than by running a counter alongside the rows: a row's
        // top is the bottom of the one before it, and saying so leaves nothing to keep in
        // step. Rows come in the order they are drawn in, so the fold reads down the card.
        return timelineRows(segment, from, to, trackWidth, BAR_HEIGHT, laneOf)
            .reduce<Row[]>((placed, row) => {
                const controller = controllers.get(row.lane) ?? null;
                const drawn = row.type === "movement" ? controller !== null : DRAWN.has(row.type);
                const above = placed[placed.length - 1];
                return [...placed, {
                    ...row,
                    controller,
                    drawn,
                    label: controller ?? row.type,
                    top: above ? above.top + above.height : 0,
                    height: drawn ? CURVE_ROW : BAR_ROW,
                }];
            }, []);
    }, [segment, from, to, mpm, trackWidth]);

    const height = rows.reduce((sum, row) => sum + row.height, 0);
    // The beat in force where the axis begins. A card covers one segment, so this is the metre
    // that segment is in rather than a reading of the whole score.
    const beatLength = beatTicksAt(mpm.meter, from);
    const grid = useMemo(
        () => beatGrid(from, to, beatLength, trackWidth),
        [from, to, beatLength, trackWidth],
    );

    /** Every curve the card shows, read once — hovering must not resample anything. */
    const curves = useMemo(() => {
        const map = new Map<string, CurvePoint[]>();
        for (const row of rows) {
            if (!row.drawn) continue;
            map.set(
                row.lane,
                row.controller !== null
                    ? pedalCurve(mpm, row.controller, from, to)
                    : row.type === "tempo"
                        ? tempoCurve(mpm, from, to)
                        : dynamicsCurve(mpm, from, to),
            );
        }
        return map;
    }, [rows, mpm, from, to]);

    const xOf = (tick: number) =>
        Math.max(0, Math.min(1, (tick - from) / (to - from))) * trackWidth;

    return (
        <svg
            width={TYPE_COLUMN + trackWidth}
            height={height}
            style={{ display: "block", fontFamily: "system-ui, sans-serif" }}
            onMouseLeave={() => onHover?.(null)}
        >
            {rows.map(row => {
                const color = getLaneColor(row.type);
                const points = curves.get(row.lane);
                const pedal = row.controller !== null;
                const plot = pedal ? PEDAL_PLOT : plotOf(points ?? [], FLAT_FLOOR[row.type] ?? 1);
                // Tempo is a rate, so there is no "none of it" for a shading to reach down
                // to; a level has one, and the pedal's is the position it rests at.
                const rest = pedal ? 0 : row.type === "tempo" ? null : plot.bottomValue;
                const geometry = points
                    ? geometryOf(points, plot, xOf, row.top, row.height, rest)
                    : null;

                return (
                    <g key={row.lane}>
                        <text
                            x={TYPE_COLUMN - 8}
                            y={row.top + row.height / 2}
                            textAnchor="end"
                            dominantBaseline="middle"
                            fontSize={9.5}
                            fontWeight={600}
                            fill={color}
                        >
                            {row.label}
                        </text>

                        <g transform={`translate(${TYPE_COLUMN},0)`}>
                            <rect
                                x={0}
                                y={row.top}
                                width={trackWidth}
                                height={row.height - 1}
                                fill="#f9fafb"
                            />
                            {grid.map(x => (
                                <line
                                    key={x}
                                    x1={x}
                                    x2={x}
                                    y1={row.top}
                                    y2={row.top + row.height - 1}
                                    stroke="#e5e7eb"
                                    strokeWidth={1}
                                />
                            ))}

                            {/* What this segment claims of the lane, under the drawing —
                                and, on any row, which gesture the pointer is on. Marking
                                the one rather than dimming the rest is what keeps two
                                overlapping bars from compounding into a third shade. */}
                            {row.bars.map(bar => {
                                const tint = hovered?.id === bar.id ? 0.2 : geometry ? 0.09 : 0;
                                if (tint === 0) return null;
                                return (
                                    <rect
                                        key={bar.id}
                                        x={bar.left}
                                        y={row.top}
                                        width={Math.max(bar.width, 2)}
                                        height={row.height - 1}
                                        fill={color}
                                        fillOpacity={tint}
                                    />
                                );
                            })}

                            {geometry ? (
                                <>
                                    {rest !== null && (
                                        <path d={geometry.area} fill={color} fillOpacity={0.16} />
                                    )}
                                    <path
                                        d={geometry.line}
                                        fill="none"
                                        stroke={color}
                                        strokeWidth={1.6}
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                    {row.controller === null && (
                                        <>
                                            <CurveLabel
                                                x={geometry.first.x + 2}
                                                y={geometry.first.y - 3.5}
                                                anchor="start"
                                                color={color}
                                            >
                                                {geometry.first.value.toFixed(0)}
                                            </CurveLabel>
                                            {geometry.last.value.toFixed(0) !==
                                                geometry.first.value.toFixed(0) && (
                                                <CurveLabel
                                                    x={geometry.last.x - 2}
                                                    y={geometry.last.y - 3.5}
                                                    anchor="end"
                                                    color={color}
                                                >
                                                    {geometry.last.value.toFixed(0)}
                                                </CurveLabel>
                                            )}
                                        </>
                                    )}
                                </>
                            ) : (
                                row.bars.map(bar => (
                                    <rect
                                        key={bar.id}
                                        x={bar.left}
                                        y={row.top + (row.height - 1 - BAR_HEIGHT) / 2}
                                        width={bar.width}
                                        height={BAR_HEIGHT}
                                        rx={BAR_HEIGHT / 2}
                                        fill={color}
                                    />
                                ))
                            )}

                            {/* The reach of the pointer, over everything else in the row —
                                but only where there is something left to say. A lane that
                                is drawn has already answered the question the pane below
                                answers, so pointing at it would offer a worse version of
                                what is on the screen. */}
                            {onHover && (reachDrawn || !row.drawn) && row.bars.map(bar => (
                                <rect
                                    key={bar.id}
                                    x={Math.min(bar.left, trackWidth - MIN_HIT_WIDTH)}
                                    y={row.top}
                                    width={Math.max(bar.width, MIN_HIT_WIDTH)}
                                    height={row.height}
                                    fill="transparent"
                                    onMouseEnter={() => onHover(bar.span)}
                                />
                            ))}
                        </g>
                    </g>
                );
            })}
        </svg>
    );
};

interface SegmentTimelinePopoverProps {
    /** One column each: the one under the pointer, or the ones held open. */
    segments: Segment[];
    mpm: PerformanceReader;
    anchorEl: { getBoundingClientRect: () => DOMRect; contextElement?: Element };
    /** Above a word that leans down, below one that leans up — never over it. */
    placement: PopperPlacementType;
    minPointSpan: number;
    /**
     * Whether the card can be touched.
     *
     * A card that merely follows the pointer must not: reaching for it would take the
     * pointer off the word that is holding it open, and it would vanish on the way. Once a
     * word has been clicked the card stands on its own and the gestures in it can be
     * examined one by one.
     */
    interactive: boolean;
}

/**
 * What a segment is made of.
 *
 * The word is already on the line, spotlit and grown, so repeating it here would
 * be an echo. What the tree cannot show is the inside of a segment: which
 * gestures the claim rests on, and how they sit against each other over the
 * stretch it covers. This card draws them on the segment's own axis rather than
 * the piece's, so they stay legible at any zoom.
 *
 * The same card answers the pointer and holds still once a word is clicked, so
 * what you were reading is what gets kept. Held still, it answers the pointer
 * itself and quotes back whatever gesture it is put on.
 *
 * Several columns show when the playhead is inside more than one segment at
 * once. They argue one moment between them, and only then is the word worth
 * writing again, being what tells the columns apart.
 */
export const SegmentTimelinePopover = ({
    segments,
    mpm,
    anchorEl,
    placement,
    minPointSpan,
    interactive,
}: SegmentTimelinePopoverProps) => {
    const [hovered, setHovered] = useState<Span | null>(null);

    /**
     * A gesture is only ever pointed at in the card it is drawn in, so when the card
     * changes what it is about, the quotation underneath has to go with it — otherwise the
     * next segment opens showing the last one's source.
     */
    const about = segments.map(segment => segment.id).join() + (interactive ? "!" : "");
    const [wasAbout, setWasAbout] = useState(about);
    if (about !== wasAbout) {
        setWasAbout(about);
        setHovered(null);
    }

    /**
     * The quotation opens away from the word, on whichever side the card is not anchored.
     *
     * It hangs outside the card's own box — see where it is rendered — so it has to be told
     * which way to hang, and the card's placement already knows: the anchored edge is the
     * one with the tree behind it.
     */
    const opensDown = placement.startsWith("bottom");

    return (
        <Popper
            open
            anchorEl={anchorEl}
            placement={placement}
            modifiers={[
                { name: "offset", options: { offset: [0, 8] } },
                { name: "preventOverflow", options: { padding: 8 } },
            ]}
            style={{ zIndex: 10, pointerEvents: interactive ? "auto" : "none" }}
        >
            {/* `'8px'` and not `2`: an `sx` number multiplies `shape.borderRadius`, which the
                theme raised from 4 to 6, so this card silently rounded from 8 to 12 the day a
                theme existed. The radius was chosen for the card, not derived from the shape. */}
            <Paper elevation={4} sx={{ borderRadius: "8px", px: 1.5, py: 1.25, position: "relative" }}>
                <Stack direction="row" divider={<Divider orientation="vertical" flexItem />} spacing={1.5}>
                    {segments.map(segment => (
                        <div key={segment.id} style={{ fontFamily: "system-ui, sans-serif" }}>
                            {segments.length > 1 && (
                                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                                    {wordFor(segment)}
                                </div>
                            )}
                            <SegmentTimeline
                                segment={segment}
                                mpm={mpm}
                                minPointSpan={minPointSpan}
                                hovered={hovered}
                                onHover={interactive ? setHovered : null}
                            />
                        </div>
                    ))}
                </Stack>

                {/* What the pictures cannot say yet.
                    Out of the card's flow, deliberately: laid out inside it, a pane opening
                    under the pointer would grow the card, and with a card anchored by its
                    lower edge that means the rows slide out from under the hand the moment
                    they are pointed at. Hanging outside, it can come and go freely. */}
                {hovered && (
                    <Paper
                        elevation={4}
                        sx={{
                            position: "absolute",
                            left: 12,
                            [opensDown ? "top" : "bottom"]: "calc(100% + 6px)",
                            boxSizing: "border-box",
                            width: TYPE_COLUMN + TRACK_WIDTH,
                            maxHeight: 168,
                            overflow: "auto",
                            // 4px, stated. This card and `SegmentGestures`' in the editor are the
                            // same card built twice, one per tree, down to the width and padding;
                            // that one writes a raw `4`, so a multiplied `1` here would have made
                            // the two disagree the moment the theme changed the shape.
                            borderRadius: "4px",
                            padding: "6px 8px",
                        }}
                    >
                        <InstructionAttributes elements={hovered.elements} mpm={mpm} />
                    </Paper>
                )}
            </Paper>
        </Popper>
    );
};
