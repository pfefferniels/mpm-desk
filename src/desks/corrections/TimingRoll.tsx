import { useMemo, useRef, useState, type JSX } from 'react';
import { travelOf, type AlignedPedal, type Alignment } from '../../fitting/alignment';
import {
    newPressId,
    type AddedPress,
    type RedrawnPress,
} from '../../fitting/transformers/modification/CorrectPedal';
import {
    movedPlateau,
    movedVertex,
    positionAt,
    releaseShifted,
    returnToRest,
    withoutVertex,
    withVertex,
    type Travel,
} from '../../performance/pedalTravel';
import type { Scope } from '../TransformerViewProps';
import { usePhysicalZoom } from '../../hooks/ZoomProvider';
import { useScrollRegistration } from '../../hooks/useScrollRegistration';
import { svgPoint, svgUnitsPerPixel } from '../../utils/svgPoint';
import { onsetSeconds, soundedSeconds, wasSounded } from '../noteTiming';
import { PedalLaneLabels, PedalRails } from '../PedalBand';
import {
    lineOf,
    PEDAL_GUTTER,
    PEDAL_LABEL_WIDTH,
    pedalLanes,
    positionAtY,
    type PedalLane,
} from '../pedalGeometry';
import { COMMITTED_GHOST, DeltaGhost, PENDING_GHOST } from './DeltaGhost';
import { defaultPress, withDraft, type LineDraft } from './lineDraft';
import { PressLine, SELECTED, SELECTED_EDGE, type Grab } from './PressLine';
import type { LineGhost } from './useLineGhosts';
import type { Clicked, SelectionModifiers } from './useEventSelection';

/** Which end of an event was grabbed, and so which of its two times the drag is about. */
export type TimingAspect = 'onset' | 'duration';

/** What is being previewed: a shift of the selected events, or one press's line as drafted. */
export type TimingPreview = { aspect: TimingAspect; change: number } | LineDraft;

interface TimingRollProps {
    msm: Alignment;
    part: Scope;
    selected: ReadonlySet<string>;
    onSelect: (clicked: Clicked, modifiers: SelectionModifiers) => void;
    /** Milliseconds, reported continuously while an event is dragged. */
    onDrag: (aspect: TimingAspect, change: number) => void;
    /** A press's line, reported continuously while it is redrawn, once when a press is added or removed. */
    onDraw: (draft: LineDraft) => void;
    preview: TimingPreview | undefined;
    previewIds: ReadonlySet<string>;
    /** What the chain has already corrected, in milliseconds, keyed by event id. */
    onsetGhosts: ReadonlyMap<string, number>;
    durationGhosts: ReadonlyMap<string, number>;
    /** The line each press had before the chain redrew it, keyed by pedal id. */
    lineGhosts: ReadonlyMap<string, LineGhost>;
}

const PITCH_LOW = 21;
const PITCH_HIGH = 108;
const ROLL_HEIGHT = 300;
const MARGIN = 20;
/**
 * Taller than the band the choice desk compares readings in: a position is dragged here, and at
 * 64 px over two lanes one pixel would be a twentieth of the stroke.
 */
const CORRECTIONS_PEDAL_AREA = 160;
const CHART_HEIGHT = ROLL_HEIGHT + PEDAL_GUTTER + CORRECTIONS_PEDAL_AREA + MARGIN;
const NOTE_HEIGHT = ROLL_HEIGHT / (PITCH_HIGH - PITCH_LOW + 1);
/** How near the right edge counts as grabbing the release rather than the body, in pixels. */
const EDGE_PIXELS = 6;

const pitchY = (pitch: number) =>
    ((PITCH_HIGH - Math.min(PITCH_HIGH, Math.max(PITCH_LOW, pitch))) /
        (PITCH_HIGH - PITCH_LOW + 1)) *
    ROLL_HEIGHT;

/** The press a line gesture is on, and its line as the gesture found it. */
interface EditedPress {
    id: string;
    dateMs: number;
    lane: PedalLane;
    /** The line the recording holds, for the ghost; null for a press the roll lacks. */
    before: Travel | null;
    /** The call the press is drafted under, whose line each gesture replaces. */
    base: Omit<RedrawnPress, 'travel'> | Omit<AddedPress, 'travel'>;
    travel: Travel;
}

type Drag =
    | { kind: 'shift'; aspect: TimingAspect; startX: number }
    | { kind: 'vertex'; press: EditedPress; index: number }
    | { kind: 'plateau'; press: EditedPress; index: number; startY: number; from: number };

const redrawn = (press: EditedPress, travel: Travel): LineDraft => ({
    aspect: 'line',
    change: { ...press.base, travel },
    before: press.before,
});

const displaced = (pedal: AlignedPedal, ms: number): AlignedPedal => ({
    ...pedal,
    'milliseconds.date': pedal['milliseconds.date'] + ms,
    'milliseconds.date.end': pedal['milliseconds.date.end'] + ms,
});

const released = (pedal: AlignedPedal, ms: number): AlignedPedal => {
    const travel = releaseShifted(travelOf(pedal), ms);
    return {
        ...pedal,
        travel,
        'milliseconds.date.end': pedal['milliseconds.date'] + returnToRest(travel),
    };
};

/** The presses as the preview has them: the selected ones shifted, or one press redrawn, added or gone. */
const withPreview = (
    pedals: readonly AlignedPedal[],
    preview: TimingPreview | undefined,
    previewIds: ReadonlySet<string>,
): AlignedPedal[] => {
    if (!preview) return [...pedals];
    if (preview.aspect === 'line') return withDraft(pedals, preview);
    if (preview.change === 0) return [...pedals];
    return pedals.map((pedal) =>
        !previewIds.has(pedal['xml:id'])
            ? pedal
            : preview.aspect === 'onset'
              ? displaced(pedal, preview.change)
              : released(pedal, preview.change),
    );
};

/**
 * The recording as a roll: what sounded, when, and for how long.
 *
 * The plot `ChoiceDesk` draws, put to the other use the recording admits. There a rectangle is
 * evidence for choosing between two readings; here it is the thing being corrected, its body
 * moving the attack and its right edge the release.
 *
 * **Notes and pedals share the surface deliberately.** A pedal correction is almost always made
 * because of what it does to the notes under it, and both are drawn in the same seconds.
 *
 * A pedal is drawn as the line it recorded, held until the next vertex the way a controller
 * value is. Its body still moves the press and its right edge the release, as a note's do; once
 * it is selected, every vertex is a handle and every flat run can be raised or lowered, an
 * alt-press on the line adds a vertex, a shift-alt-press drops one, and a shift-alt-press on the
 * body drops the press. An alt-press on an empty stretch of a lane adds a press there.
 */
export const TimingRoll = ({
    msm,
    part,
    selected,
    onSelect,
    onDrag,
    onDraw,
    preview,
    previewIds,
    onsetGhosts,
    durationGhosts,
    lineGhosts,
}: TimingRollProps) => {
    const stretchX = usePhysicalZoom();
    const svgRef = useRef<SVGSVGElement>(null);
    const [drag, setDrag] = useState<Drag>();
    const [hovered, setHovered] = useState<string>();
    const scrollContainerRef = useScrollRegistration('corrections-roll', 'physical');

    const notes = useMemo(
        () =>
            msm.allNotes.filter(
                (note) => wasSounded(note) && (part === 'global' || note.part - 1 === part),
            ),
        [msm, part],
    );

    const lineDraft = preview?.aspect === 'line' ? preview : undefined;
    const presses = useMemo(
        () => withPreview(msm.pedals, preview, previewIds),
        [msm, preview, previewIds],
    );

    /** The lanes the recording has, with one for a press only the draft has; a roll with no soft pedal shows no soft lane. */
    const lanes = useMemo(
        () => pedalLanes([...msm.pedals, ...presses], ROLL_HEIGHT + PEDAL_GUTTER, CORRECTIONS_PEDAL_AREA),
        [msm, presses],
    );
    const laneOf = new Map(lanes.map((lane) => [lane.type, lane]));

    const width = useMemo(() => {
        const last = notes.reduce((acc, n) => Math.max(acc, onsetSeconds(n) + soundedSeconds(n)), 0);
        const lastPedal = presses.reduce((acc, p) => Math.max(acc, p['milliseconds.date.end'] / 1000), 0);
        return Math.max(last, lastPedal) * stretchX + MARGIN;
    }, [notes, presses, stretchX]);

    // Seconds on the axis, milliseconds in the call — the recording is stated in milliseconds
    // and so is every correction.
    const msAt = (x: number) => Math.round((x / stretchX) * 1000);

    const recorded = (id: string) => msm.pedals.find((pedal) => pedal['xml:id'] === id);

    /** A press as a line gesture finds it: under the standing draft, if that names it, else as recorded. */
    const editedPress = (drawn: AlignedPedal, lane: PedalLane): EditedPress => {
        const id = drawn['xml:id'];
        const standing = lineDraft?.change.pedal === id ? lineDraft : undefined;
        return {
            id,
            dateMs: drawn['milliseconds.date'],
            lane,
            before: standing ? standing.before : travelOf(drawn),
            base: standing && 'onsetMs' in standing.change ? standing.change : { pedal: id },
            travel: travelOf(drawn),
        };
    };

    const beginDrag = (
        e: React.MouseEvent<SVGRectElement>,
        clicked: Clicked,
        x: number,
        rectWidth: number,
    ) => {
        e.preventDefault();

        // Selecting comes first and is not conditional on the rest. The same press both says
        // what the correction is about and opens the drag that says how much, but only the
        // second half needs the element's screen matrix — so where there is no matrix the press
        // still selects rather than doing nothing at all.
        onSelect(clicked, { metaKey: e.metaKey, shiftKey: e.shiftKey });

        const svg = svgRef.current;
        if (!svg) return;
        const pt = svgPoint(svg, e.clientX, e.clientY);
        if (!pt) return;

        const edge = EDGE_PIXELS * svgUnitsPerPixel(svg);
        setDrag({
            kind: 'shift',
            startX: pt.x,
            aspect: x + rectWidth - pt.x <= edge ? 'duration' : 'onset',
        });
    };

    const grabPress = (
        grab: Grab,
        e: React.MouseEvent<SVGElement>,
        drawn: AlignedPedal,
        lane: PedalLane,
    ) => {
        const id = drawn['xml:id'];
        const x = (drawn['milliseconds.date'] / 1000) * stretchX;
        const held = (returnToRest(travelOf(drawn)) / 1000) * stretchX;
        if (grab.at === 'body' && !e.altKey) {
            beginDrag(e as React.MouseEvent<SVGRectElement>, { kind: 'pedal', id }, x, held);
            return;
        }

        e.preventDefault();
        // A line gesture is about this press alone.
        onSelect({ kind: 'pedal', id }, { metaKey: false, shiftKey: false });

        const svg = svgRef.current;
        if (!svg) return;
        const pt = svgPoint(svg, e.clientX, e.clientY);
        if (!pt) return;

        const press = editedPress(drawn, lane);
        if (grab.at === 'body') {
            if (e.shiftKey) {
                // A press only the draft has is dropped with the draft, on Escape.
                if (press.before === null) return;
                onDraw({ aspect: 'line', change: { pedal: id, remove: true }, before: press.before });
                return;
            }
            const ms = msAt(pt.x) - press.dateMs;
            const travel = withVertex(press.travel, { ms, position: positionAt(press.travel, ms) });
            const index = travel.findIndex((vertex) => vertex.ms === ms);
            if (index < 0) return;
            onDraw(redrawn(press, travel));
            setDrag({ kind: 'vertex', press: { ...press, travel }, index });
        } else if (grab.at === 'vertex') {
            if (e.shiftKey && e.altKey) {
                onDraw(redrawn(press, withoutVertex(press.travel, grab.index)));
                return;
            }
            setDrag({ kind: 'vertex', press, index: grab.index });
        } else {
            setDrag({
                kind: 'plateau',
                press,
                index: grab.index,
                startY: pt.y,
                from: press.travel[grab.index].position,
            });
        }
    };

    const addPress = (e: React.MouseEvent<SVGRectElement>, lane: PedalLane) => {
        if (!e.altKey) return;
        e.preventDefault();

        const svg = svgRef.current;
        if (!svg) return;
        const pt = svgPoint(svg, e.clientX, e.clientY);
        if (!pt) return;

        const pedal = newPressId();
        const source = msm.pedals.find((recordedPress) => recordedPress.type === lane.type)?.source;
        onSelect({ kind: 'pedal', id: pedal }, { metaKey: false, shiftKey: false });
        onDraw({
            aspect: 'line',
            change: {
                pedal,
                type: lane.type,
                ...(source !== undefined && { source }),
                onsetMs: msAt(pt.x),
                travel: defaultPress(),
            },
            before: null,
        });
    };

    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        if (!drag) return;
        const pt = svgPoint(e.currentTarget, e.clientX, e.clientY);
        if (!pt) return;

        if (drag.kind === 'shift') {
            onDrag(drag.aspect, msAt(pt.x - drag.startX));
        } else if (drag.kind === 'vertex') {
            const to = { ms: msAt(pt.x) - drag.press.dateMs, position: positionAtY(drag.press.lane, pt.y) };
            onDraw(redrawn(drag.press, movedVertex(drag.press.travel, drag.index, to)));
        } else {
            const { lane } = drag.press;
            const position = drag.from + (pt.y - drag.startY) / (lane.pressed - lane.rest);
            onDraw(redrawn(drag.press, movedPlateau(drag.press.travel, drag.index, position)));
        }
    };

    const endDrag = () => setDrag(undefined);

    const shift = preview && preview.aspect !== 'line' ? (preview.change / 1000) * stretchX : 0;
    const displacementOf = (id: string) => {
        if (!preview || preview.aspect === 'line' || !previewIds.has(id) || preview.change === 0)
            return { dx: 0, dw: 0 };
        return preview.aspect === 'onset' ? { dx: shift, dw: 0 } : { dx: 0, dw: shift };
    };

    const marks: JSX.Element[] = [];
    const bodies: JSX.Element[] = [];

    const ghostFor = (id: string, x: number, right: number, y: number) => {
        const onset = onsetGhosts.get(id);
        const held = durationGhosts.get(id);
        const drawn: JSX.Element[] = [];
        if (onset)
            drawn.push(
                <DeltaGhost
                    key={`onset_ghost_${id}`}
                    x1={x - (onset / 1000) * stretchX}
                    y1={y}
                    x2={x}
                    y2={y}
                    color={COMMITTED_GHOST}
                />,
            );
        if (held)
            drawn.push(
                <DeltaGhost
                    key={`duration_ghost_${id}`}
                    x1={right - (held / 1000) * stretchX}
                    y1={y}
                    x2={right}
                    y2={y}
                    color={COMMITTED_GHOST}
                />,
            );
        return drawn;
    };

    for (const [i, note] of notes.entries()) {
        const id = note['xml:id'];
        const { dx, dw } = displacementOf(id);
        const x = onsetSeconds(note) * stretchX + dx;
        const rectWidth = Math.max(1, soundedSeconds(note) * stretchX + dw);
        const y = pitchY(note['midi.pitch']);
        const isSelected = selected.has(id);

        marks.push(...ghostFor(id, x, x + rectWidth, y + NOTE_HEIGHT / 2));

        bodies.push(
            <rect
                key={`note_${id}_${String(i)}`}
                data-id={id}
                x={x}
                y={y}
                width={rectWidth}
                height={Math.max(2, NOTE_HEIGHT - 0.5)}
                fill={isSelected ? SELECTED : 'black'}
                fillOpacity={isSelected ? 0.75 : 0.45}
                stroke={isSelected ? SELECTED_EDGE : 'none'}
                strokeWidth={0.8}
                style={{ cursor: 'ew-resize' }}
                onMouseDown={(e) =>
                    beginDrag(e, { kind: 'note', id, date: note.date }, x, rectWidth)
                }
            />,
        );
    }

    /** The line the drafted press had, drawn blue under it while the draft or the sent call stands. */
    const draftGhost = (id: string) => {
        if (lineDraft?.change.pedal !== id || lineDraft.before === null) return undefined;
        const original = recorded(id);
        if (!original) return undefined;
        return { dateMs: original['milliseconds.date'], travel: lineDraft.before, color: PENDING_GHOST };
    };

    const committedGhost = (id: string) => {
        const ghost = lineGhosts.get(id);
        return ghost && { dateMs: ghost.dateMs, travel: ghost.travel, color: COMMITTED_GHOST };
    };

    for (const pedal of presses) {
        const id = pedal['xml:id'];
        const lane = laneOf.get(pedal.type);
        if (!lane) continue;
        const x = (pedal['milliseconds.date'] / 1000) * stretchX;
        const held = Math.max(1, (returnToRest(travelOf(pedal)) / 1000) * stretchX);

        // Between the two levels rather than on either: the leader would otherwise run along the
        // rail or along the floor of the press, where it reads as part of the line.
        marks.push(...ghostFor(id, x, x + held, (lane.rest + lane.pressed) / 2));

        bodies.push(
            <PressLine
                key={`pedal_${id}`}
                pedal={pedal}
                lane={lane}
                stretchX={stretchX}
                selected={selected.has(id)}
                editable={selected.has(id) || hovered === id}
                ghost={draftGhost(id) ?? committedGhost(id)}
                onGrab={(grab, e) => grabPress(grab, e, pedal, lane)}
                onHover={(over) => setHovered((current) => (over ? id : current === id ? undefined : current))}
            />,
        );
    }

    // A press the draft removes has no body left to hang its ghost on.
    const removed = lineDraft && 'remove' in lineDraft.change ? recorded(lineDraft.change.pedal) : undefined;
    const removedLane = removed && laneOf.get(removed.type);
    if (removed && removedLane && lineDraft?.before) {
        marks.push(
            <polyline
                key={`removed_${removed['xml:id']}`}
                data-ghost={removed['xml:id']}
                points={lineOf(lineDraft.before, removed['milliseconds.date'], removedLane, stretchX)}
                fill="none"
                stroke={PENDING_GHOST}
                strokeWidth={1}
                strokeDasharray="3 2"
                strokeOpacity={0.6}
                pointerEvents="none"
            />,
        );
    }

    return (
        // The lane names have a column of their own beside the scroller, as on `ChoiceDesk`, so
        // `sustain` still says which rail it belongs to once the roll has been scrolled on. Both
        // halves are `CHART_HEIGHT` tall over the same viewBox extent, so a name meets its line.
        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            <svg
                style={{ flex: '0 0 auto' }}
                width={PEDAL_LABEL_WIDTH}
                height={CHART_HEIGHT}
                viewBox={[-PEDAL_LABEL_WIDTH, 0, PEDAL_LABEL_WIDTH, CHART_HEIGHT].join(' ')}
            >
                <PedalLaneLabels lanes={lanes} />
            </svg>

            <div
                ref={scrollContainerRef}
                style={{
                    flex: 1,
                    minWidth: 0,
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    position: 'relative',
                }}
            >
                <svg
                    ref={svgRef}
                    width={width}
                    height={CHART_HEIGHT}
                    viewBox={[0, 0, width, CHART_HEIGHT].join(' ')}
                    onMouseMove={handleMouseMove}
                    onMouseUp={endDrag}
                    onMouseLeave={endDrag}
                >
                    <PedalRails lanes={lanes} width={width} />
                    {/* Under everything: the one thing an empty stretch of a lane takes is a new press. */}
                    {lanes.map((lane) => (
                        <rect
                            key={`lane_${lane.type}`}
                            data-lane={lane.type}
                            x={0}
                            y={lane.rest}
                            width={width}
                            height={lane.pressed - lane.rest}
                            fill="transparent"
                            onMouseDown={(e) => addPress(e, lane)}
                        />
                    ))}
                    {marks}
                    {bodies}
                </svg>
            </div>
        </div>
    );
};
