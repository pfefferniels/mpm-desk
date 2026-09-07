import { travelOf, type AlignedPedal } from '../../fitting/alignment';
import { returnToRest, type Travel } from '../../performance/pedalTravel';
import { lineOf, placeTravel, stepLine, type PedalLane } from '../pedalGeometry';

/** Where on a press the pointer landed. */
export type Grab = { at: 'body' } | { at: 'vertex'; index: number } | { at: 'plateau'; index: number };

/** A line the press used to draw, and the colour that says whether the chain has run it. */
export interface GhostLine {
    dateMs: number;
    travel: Travel;
    color: string;
}

interface PressLineProps {
    pedal: AlignedPedal;
    lane: PedalLane;
    stretchX: number;
    selected: boolean;
    /** Handles and plateau grabs are offered only while selected or under the pointer. */
    editable: boolean;
    ghost?: GhostLine;
    onGrab: (grab: Grab, e: React.MouseEvent<SVGElement>) => void;
    onHover: (hovered: boolean) => void;
}

const PEDAL_LINE = '#4b5563';
export const SELECTED = 'hsl(220, 60%, 50%)';
export const SELECTED_EDGE = 'hsl(220, 60%, 35%)';
const HANDLE_RADIUS = 3.5;
/** How wide the flat run between two vertices is to grab, in plot units. */
const PLATEAU_REACH = 8;

/**
 * One press on the timing roll: its line, the box that grabs it, and, once it is being edited,
 * a handle on every vertex and a grab along every flat run.
 *
 * The line itself takes no pointer events: a 1.5 px stroke is not a target. The body is grabbed
 * by the box it encloses, a vertex by its handle, a run by an invisible thicker stroke over it.
 * Later elements win where they overlap, so a handle beats the run it ends and both beat the box.
 */
export const PressLine = ({
    pedal,
    lane,
    stretchX,
    selected,
    editable,
    ghost,
    onGrab,
    onHover,
}: PressLineProps) => {
    const id = pedal['xml:id'];
    const travel = travelOf(pedal);
    const dateMs = pedal['milliseconds.date'];
    const placed = placeTravel(travel, dateMs, lane, stretchX);
    const x = (dateMs / 1000) * stretchX;
    const held = Math.max(1, (returnToRest(travel) / 1000) * stretchX);

    return (
        <g data-press={id} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
            {ghost && (
                <polyline
                    data-ghost={id}
                    points={lineOf(ghost.travel, ghost.dateMs, lane, stretchX)}
                    fill="none"
                    stroke={ghost.color}
                    strokeWidth={1}
                    strokeDasharray="3 2"
                    strokeOpacity={0.6}
                    pointerEvents="none"
                />
            )}
            <polyline
                data-line={id}
                points={stepLine(placed, lane.rest)}
                fill="none"
                stroke={selected ? SELECTED : PEDAL_LINE}
                strokeWidth={selected ? 2 : 1.5}
                pointerEvents="none"
            />
            <rect
                data-id={id}
                data-type={pedal.type}
                x={x}
                y={lane.rest}
                width={held}
                height={lane.pressed - lane.rest}
                fill="transparent"
                style={{ cursor: 'ew-resize' }}
                onMouseDown={(e) => onGrab({ at: 'body' }, e)}
            />
            {editable &&
                placed.slice(0, -1).map((vertex, i) => (
                    <line
                        key={`run_${String(i)}`}
                        data-plateau={i}
                        x1={vertex.x}
                        y1={vertex.y}
                        x2={placed[i + 1].x}
                        y2={vertex.y}
                        stroke="transparent"
                        strokeWidth={PLATEAU_REACH}
                        pointerEvents="stroke"
                        style={{ cursor: 'ns-resize' }}
                        onMouseDown={(e) => onGrab({ at: 'plateau', index: i }, e)}
                    />
                ))}
            {editable &&
                placed.map((vertex, i) => (
                    <circle
                        key={`vertex_${String(i)}`}
                        data-vertex={i}
                        cx={vertex.x}
                        cy={vertex.y}
                        r={HANDLE_RADIUS}
                        fill="white"
                        stroke={SELECTED_EDGE}
                        strokeWidth={1.5}
                        style={{ cursor: 'move' }}
                        onMouseDown={(e) => onGrab({ at: 'vertex', index: i }, e)}
                    />
                ))}
        </g>
    );
};
