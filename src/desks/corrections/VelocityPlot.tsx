import { useMemo, useRef, useState, type JSX } from 'react';
import { usePiano } from '../../performance/piano';
import type { Alignment, AlignedNote } from '../../fitting/alignment';
import type { Scope } from '../TransformerViewProps';
import { useNotes } from '../../hooks/NotesProvider';
import { useSymbolicZoom } from '../../hooks/ZoomProvider';
import { useScrollRegistration } from '../../hooks/useScrollRegistration';
import { asMIDI } from '../../utils/utils';
import { svgPoint } from '../../utils/svgPoint';
import { DynamicsCircle } from '../dynamics/DynamicsCircle';
import { VerticalScale } from '../dynamics/VerticalScale';
import { MarkedRegion } from '../dynamics/MarkedRegion';
import { extractDynamicsSegments } from '../dynamics/segments';
import { COMMITTED_GHOST, DeltaGhost, PENDING_GHOST } from './DeltaGhost';
import type { Clicked, SelectionModifiers } from './useEventSelection';

interface VelocityPlotProps {
    msm: Alignment;
    part: Scope;
    /** The ids the user is holding, resolved by the selection hook. */
    selected: ReadonlySet<string>;
    onSelect: (clicked: Clicked, modifiers: SelectionModifiers) => void;
    /** Velocity steps, reported continuously while a dot is dragged. */
    onDrag: (change: number) => void;
    /** How far the selected dots are displaced right now — a live drag, or a sent call. */
    preview: number;
    previewIds: ReadonlySet<string>;
    /** What the chain has already corrected, keyed by note id. */
    ghosts: ReadonlyMap<string, number>;
    /** The stretch a range selection covers, so the user can see what shift-click reached. */
    range?: { from: number; to?: number };
}

const STRETCH_Y = 3;
const MARGIN = 20;
const CHART_HEIGHT = 300 + MARGIN;
/** Wide enough for the tick, its gap and a three-digit velocity at font size 8. */
const SCALE_WIDTH = 34;
/**
 * The axis line sits on x = 0 and is 1.5 wide, so the gutter's viewBox has to reach a hair past
 * it — an outermost <svg> clips to its viewport, and half the stroke would go missing.
 */
const AXIS_BLEED = 1;

const screenY = (velocity: number) => (127 - velocity) * STRETCH_Y;

/**
 * The recording's velocities, one dot per chord, and nothing drawn over them.
 *
 * The same plot the dynamics desk draws, minus the curves — because here the dots *are* the
 * subject rather than the evidence a curve is fitted to. Dragging one up or down states that the
 * roll scan read it wrong.
 */
export const VelocityPlot = ({
    msm,
    part,
    selected,
    onSelect,
    onDrag,
    preview,
    previewIds,
    ghosts,
    range,
}: VelocityPlotProps) => {
    const stretchX = useSymbolicZoom();
    const svgRef = useRef<SVGSVGElement>(null);
    const [dragStartY, setDragStartY] = useState<number>();
    const [datePlayed, setDatePlayed] = useState<number>();

    const { play, stop } = usePiano();
    const { slice } = useNotes();
    const scrollContainerRef = useScrollRegistration('corrections-desk', 'symbolic');

    const segments = useMemo(() => extractDynamicsSegments(msm, part), [msm, part]);

    const handlePlay = (from: number, to?: number) => {
        let notes = slice(from, to).map((n) => {
            // Play off the score grid, not off the recording: the recording states itself in
            // `milliseconds.date` / `milliseconds.date.end`, so dropping those two leaves
            // `asMIDI` to fall back to the symbolic date.
            const partial: Partial<AlignedNote> = { ...n };
            delete partial['milliseconds.date'];
            delete partial['milliseconds.date.end'];
            return partial as Omit<AlignedNote, 'milliseconds.date' | 'milliseconds.date.end'>;
        });

        if (typeof part === 'number') notes = notes.filter((n) => n.part - 1 === part);
        const midi = asMIDI(notes);
        if (!midi) return;
        stop();
        play(midi, (e) => {
            if (e.type === 'meta' && e.subtype === 'text') setDatePlayed(+e.text);
        });
    };

    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        if (dragStartY === undefined) return;
        const pt = svgPoint(e.currentTarget, e.clientX, e.clientY);
        if (!pt) return;

        let delta = Math.round((dragStartY - pt.y) / STRETCH_Y);
        // No selected dot may leave the scale. Clamped over the whole selection rather than per
        // dot, so a group keeps its internal differences instead of flattening against the ends.
        for (const segment of segments) {
            if (!segment.noteID || !selected.has(segment.noteID)) continue;
            if (segment.velocity + delta > 127) delta = 127 - segment.velocity;
            if (segment.velocity + delta < 0) delta = -segment.velocity;
        }
        onDrag(delta);
    };

    const endDrag = () => setDragStartY(undefined);

    const marks: JSX.Element[] = [];
    const circles: JSX.Element[] = [];

    for (const [i, segment] of segments.entries()) {
        const x = segment.date.start * stretchX;
        const committed = segment.noteID ? ghosts.get(segment.noteID) : undefined;
        if (committed) {
            marks.push(
                <DeltaGhost
                    key={`committed_${segment.date.start}_${i}`}
                    x1={x}
                    y1={screenY(segment.velocity - committed)}
                    x2={x}
                    y2={screenY(segment.velocity)}
                    color={COMMITTED_GHOST}
                    opacity={0.6}
                />,
            );
        }

        const displaced = segment.noteID !== undefined && previewIds.has(segment.noteID) && preview !== 0;
        if (displaced) {
            marks.push(
                <DeltaGhost
                    key={`pending_${segment.date.start}_${i}`}
                    x1={x}
                    y1={screenY(segment.velocity)}
                    x2={x}
                    y2={screenY(segment.velocity) - preview * STRETCH_Y}
                    color={PENDING_GHOST}
                    opacity={0.7}
                />,
            );
        }

        circles.push(
            <DynamicsCircle
                key={`velocity_${segment.date.start}_${i}`}
                segment={{
                    ...segment,
                    active: segment.noteID !== undefined && selected.has(segment.noteID),
                }}
                datePlayed={datePlayed}
                stretchX={stretchX}
                screenY={screenY}
                handlePlay={handlePlay}
                cursor="ns-resize"
                onDragStart={(_, e) => {
                    if (!segment.noteID) return;
                    // Selecting comes first and is not conditional on the rest: the same press
                    // says what the correction is about and opens the drag that says how much,
                    // and only the second half needs the element's screen matrix.
                    onSelect(
                        { kind: 'note', id: segment.noteID, date: segment.date.start },
                        { metaKey: e.metaKey, shiftKey: e.shiftKey },
                    );

                    const svg = svgRef.current;
                    if (!svg) return;
                    // Where the drag starts is what every later delta is measured against, so
                    // without it there is no drag to begin.
                    const pt = svgPoint(svg, 0, e.clientY);
                    if (!pt) return;
                    setDragStartY(pt.y);
                }}
                yOffset={displaced ? -preview * STRETCH_Y : 0}
            />,
        );
    }

    return (
        // The scale in a column of its own beside the scroller, as on the dynamics desk: the
        // chart starts where the scale ends, so nothing can be drawn behind it and a dot scrolls
        // past the axis rather than under it. The two plots share `STRETCH_Y`, so a dot sits at
        // the same height whichever desk is showing it.
        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            <svg
                style={{ flex: '0 0 auto' }}
                width={SCALE_WIDTH}
                height={CHART_HEIGHT}
                viewBox={`${String(-SCALE_WIDTH + AXIS_BLEED)} 0 ${String(SCALE_WIDTH)} ${String(CHART_HEIGHT)}`}
            >
                <VerticalScale
                    min={10}
                    max={80}
                    step={5}
                    height={CHART_HEIGHT}
                    stretchY={STRETCH_Y}
                />
            </svg>

            <div
                ref={scrollContainerRef}
                style={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden' }}
            >
                <svg
                    ref={svgRef}
                    width={msm.end * stretchX + MARGIN}
                    height={CHART_HEIGHT}
                    viewBox={[-MARGIN, 0, msm.end * stretchX + MARGIN, CHART_HEIGHT].join(' ')}
                    onMouseMove={handleMouseMove}
                    onMouseUp={endDrag}
                    onMouseLeave={endDrag}
                >
                    {marks}
                    {circles}
                    <MarkedRegion from={range?.from} to={range?.to} svgRef={svgRef} />
                </svg>
            </div>
        </div>
    );
};
