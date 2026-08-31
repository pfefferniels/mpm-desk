import { useMemo, useRef, useState, type JSX } from 'react';
import type { Alignment } from '../../fitting/alignment';
import type { Scope } from '../TransformerViewProps';
import { usePhysicalZoom } from '../../hooks/ZoomProvider';
import { useScrollRegistration } from '../../hooks/useScrollRegistration';
import { svgPoint, svgUnitsPerPixel } from '../../utils/svgPoint';
import {
    onsetSeconds,
    pedalHeldSeconds,
    pedalOnsetSeconds,
    soundedSeconds,
    wasSounded,
} from '../noteTiming';
import { PedalLaneLabels, PedalRails } from '../PedalBand';
import {
    PEDAL_AREA,
    PEDAL_GUTTER,
    PEDAL_LABEL_WIDTH,
    pedalLanes,
    pressLine,
} from '../pedalGeometry';
import { COMMITTED_GHOST, DeltaGhost } from './DeltaGhost';
import type { Clicked, SelectionModifiers } from './useEventSelection';

/** Which end of an event was grabbed, and so which of its two times the drag is about. */
export type TimingAspect = 'onset' | 'duration';

interface TimingRollProps {
    msm: Alignment;
    part: Scope;
    selected: ReadonlySet<string>;
    onSelect: (clicked: Clicked, modifiers: SelectionModifiers) => void;
    /** Milliseconds, reported continuously while an event is dragged. */
    onDrag: (aspect: TimingAspect, change: number) => void;
    /** How far the selected events are displaced right now, and in which of their two times. */
    preview: { aspect: TimingAspect; change: number } | undefined;
    previewIds: ReadonlySet<string>;
    /** What the chain has already corrected, in milliseconds, keyed by event id. */
    onsetGhosts: ReadonlyMap<string, number>;
    durationGhosts: ReadonlyMap<string, number>;
}

const PITCH_LOW = 21;
const PITCH_HIGH = 108;
const ROLL_HEIGHT = 300;
const MARGIN = 20;
const CHART_HEIGHT = ROLL_HEIGHT + PEDAL_GUTTER + PEDAL_AREA + MARGIN;
const NOTE_HEIGHT = ROLL_HEIGHT / (PITCH_HIGH - PITCH_LOW + 1);
/** How near the right edge counts as grabbing the release rather than the body, in pixels. */
const EDGE_PIXELS = 6;
const PEDAL_LINE = '#4b5563';
const SELECTED = 'hsl(220, 60%, 50%)';
const SELECTED_EDGE = 'hsl(220, 60%, 35%)';

const pitchY = (pitch: number) =>
    ((PITCH_HIGH - Math.min(PITCH_HIGH, Math.max(PITCH_LOW, pitch))) /
        (PITCH_HIGH - PITCH_LOW + 1)) *
    ROLL_HEIGHT;

/**
 * The recording as a roll: what sounded, when, and for how long.
 *
 * The plot `ChoiceDesk` draws, put to the other use the recording admits. There a rectangle is
 * evidence for choosing between two readings of a passage; here it is the thing being corrected —
 * grab its body to move the attack, grab its right edge to move the release.
 *
 * **Notes and pedals share the surface deliberately.** A pedal correction is almost always made
 * because of what it does to the notes under it, and the two are drawn in the same seconds, so
 * the lanes belong beneath the keys rather than on a desk of their own.
 *
 * A pedal is drawn as the line `ChoiceDesk` draws — down while the foot is down — rather than as
 * a block. A block says only that the pedal was held somewhere across its width, so the two
 * things this desk corrects, the moment of the press and the moment of the lift, are its least
 * legible feature; on the line they are the two vertical edges, which is also where they are
 * grabbed.
 */
export const TimingRoll = ({
    msm,
    part,
    selected,
    onSelect,
    onDrag,
    preview,
    previewIds,
    onsetGhosts,
    durationGhosts,
}: TimingRollProps) => {
    const stretchX = usePhysicalZoom();
    const svgRef = useRef<SVGSVGElement>(null);
    const [drag, setDrag] = useState<{ startX: number; aspect: TimingAspect }>();
    const scrollContainerRef = useScrollRegistration('corrections-roll', 'physical');

    const notes = useMemo(
        () =>
            msm.allNotes.filter(
                (note) => wasSounded(note) && (part === 'global' || note.part - 1 === part),
            ),
        [msm, part],
    );

    /** The lanes the recording actually has, so a roll with no soft pedal shows no soft lane. */
    const lanes = useMemo(() => pedalLanes(msm.pedals, ROLL_HEIGHT + PEDAL_GUTTER), [msm]);
    const laneOf = new Map(lanes.map((lane) => [lane.type, lane]));

    const width = useMemo(() => {
        const last = notes.reduce((acc, n) => Math.max(acc, onsetSeconds(n) + soundedSeconds(n)), 0);
        const lastPedal = msm.pedals.reduce(
            (acc, p) => Math.max(acc, pedalOnsetSeconds(p) + pedalHeldSeconds(p)),
            0,
        );
        return Math.max(last, lastPedal) * stretchX + MARGIN;
    }, [notes, msm, stretchX]);

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
            startX: pt.x,
            aspect: x + rectWidth - pt.x <= edge ? 'duration' : 'onset',
        });
    };

    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        if (!drag) return;
        const pt = svgPoint(e.currentTarget, e.clientX, e.clientY);
        if (!pt) return;
        // Seconds on the axis, milliseconds in the call — the recording is stated in milliseconds
        // and so is `Modify.change`.
        onDrag(drag.aspect, Math.round(((pt.x - drag.startX) / stretchX) * 1000));
    };

    const endDrag = () => setDrag(undefined);

    const shift = preview ? (preview.change / 1000) * stretchX : 0;
    const displacementOf = (id: string) => {
        if (!preview || !previewIds.has(id) || preview.change === 0) return { dx: 0, dw: 0 };
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
                key={`note_${id}_${i}`}
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

    for (const pedal of msm.pedals) {
        const id = pedal['xml:id'];
        const lane = laneOf.get(pedal.type);
        if (!lane) continue;
        const { dx, dw } = displacementOf(id);
        const x = pedalOnsetSeconds(pedal) * stretchX + dx;
        const held = Math.max(1, pedalHeldSeconds(pedal) * stretchX + dw);
        const isSelected = selected.has(id);

        // Between the two levels rather than on either: the leader would otherwise run along the
        // rail or along the floor of the press, where it reads as part of the line.
        marks.push(...ghostFor(id, x, x + held, (lane.rest + lane.pressed) / 2));

        bodies.push(
            <g key={`pedal_${id}`}>
                <polyline
                    points={pressLine({ from: x, to: x + held }, lane.rest, lane.pressed)}
                    fill="none"
                    stroke={isSelected ? SELECTED : PEDAL_LINE}
                    strokeWidth={isSelected ? 2 : 1.5}
                    pointerEvents="none"
                />
                {/* The press is grabbed by the box it encloses, not by the stroke: a 1.5px line
                    is not a target, and the release edge needs the same six pixels of reach a
                    note's does. */}
                <rect
                    data-id={id}
                    data-type={pedal.type}
                    x={x}
                    y={lane.rest}
                    width={held}
                    height={lane.pressed - lane.rest}
                    fill="transparent"
                    style={{ cursor: 'ew-resize' }}
                    onMouseDown={(e) => beginDrag(e, { kind: 'pedal', id }, x, held)}
                />
            </g>,
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
                    {marks}
                    {bodies}
                </svg>
            </div>
        </div>
    );
};
