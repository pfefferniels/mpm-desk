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
const PEDAL_AREA = 56;
/** Between the lowest key and the first pedal lane, so the two do not read as one plot. */
const GUTTER = 10;
const MARGIN = 20;
const CHART_HEIGHT = ROLL_HEIGHT + GUTTER + PEDAL_AREA + MARGIN;
const NOTE_HEIGHT = ROLL_HEIGHT / (PITCH_HIGH - PITCH_LOW + 1);
/** How near the right edge counts as grabbing the release rather than the body, in pixels. */
const EDGE_PIXELS = 6;

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
    const pedalTypes = useMemo(
        () => [...new Set(msm.pedals.map((pedal) => pedal.type))].sort(),
        [msm],
    );
    const laneHeight = pedalTypes.length ? PEDAL_AREA / pedalTypes.length : PEDAL_AREA;

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
                fill={isSelected ? 'hsl(220, 60%, 50%)' : 'black'}
                fillOpacity={isSelected ? 0.75 : 0.45}
                stroke={isSelected ? 'hsl(220, 60%, 35%)' : 'none'}
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
        const lane = pedalTypes.indexOf(pedal.type);
        if (lane === -1) continue;
        const { dx, dw } = displacementOf(id);
        const x = pedalOnsetSeconds(pedal) * stretchX + dx;
        const rectWidth = Math.max(1, pedalHeldSeconds(pedal) * stretchX + dw);
        const y = ROLL_HEIGHT + GUTTER + lane * laneHeight;
        const isSelected = selected.has(id);

        marks.push(...ghostFor(id, x, x + rectWidth, y + laneHeight / 2));

        bodies.push(
            <rect
                key={`pedal_${id}`}
                data-id={id}
                data-type={pedal.type}
                x={x}
                y={y}
                width={rectWidth}
                height={Math.max(2, laneHeight - 2)}
                fill={isSelected ? 'hsl(220, 60%, 50%)' : '#6b7280'}
                fillOpacity={isSelected ? 0.75 : 0.5}
                stroke={isSelected ? 'hsl(220, 60%, 35%)' : '#4b5563'}
                strokeWidth={0.8}
                style={{ cursor: 'ew-resize' }}
                onMouseDown={(e) => beginDrag(e, { kind: 'pedal', id }, x, rectWidth)}
            />,
        );
    }

    return (
        <div
            ref={scrollContainerRef}
            style={{ overflowX: 'auto', overflowY: 'hidden', position: 'relative' }}
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
                {pedalTypes.map((type, lane) => (
                    <text
                        key={`lane_${type}`}
                        x={2}
                        y={ROLL_HEIGHT + GUTTER + lane * laneHeight - 1}
                        fontSize={8}
                        fill="#6b7280"
                    >
                        {type}
                    </text>
                ))}
                {marks}
                {bodies}
            </svg>
        </div>
    );
};
