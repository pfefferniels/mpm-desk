import { Fragment, memo, useState, useMemo } from "react";
import { WedgeModel, Point, Side } from "./WedgeModel";
import { ArgumentationDialog } from "./ArgumentationDialog";
import { TransformerCircle } from "./TransformerCircle";
import { packCirclesInCircle } from "../utils/packInCircles";
import { zip } from "../utils/zip";
import { useDropTarget, useSvgDnd } from "./svg-dnd";
import { Argumentation } from "mpmify";
import { useSelection } from "../hooks/SelectionProvider";
import { useWedgeScale } from "../hooks/useWedgeScale";

/**
 * Generate an SVG path with quadratic Bezier curves for the wedge edges.
 * Creates elegant outward-bowing curves (bellows shape) from base points to tip.
 */
function generateCurvedWedgePath(p0: Point, p1: Point, tip: Point, side: Side, bowFactor = 0.2): string {
    const dir = side === "above" ? 1 : -1;

    // Left edge: p0 → tip
    const leftMidX = (p0.x + tip.x) / 2;
    const leftMidY = (p0.y + tip.y) / 2;
    const leftDx = tip.x - p0.x;
    const leftDy = tip.y - p0.y;
    const leftLen = Math.hypot(leftDx, leftDy);

    const leftPerpX = leftLen > 0 ? (leftDy / leftLen) * dir : 0;
    const leftPerpY = leftLen > 0 ? (-leftDx / leftLen) * dir : 0;

    const leftBow = leftLen * bowFactor;
    const ctrl1X = leftMidX + leftPerpX * leftBow;
    const ctrl1Y = leftMidY + leftPerpY * leftBow;

    // Right edge: tip → p1
    const rightMidX = (tip.x + p1.x) / 2;
    const rightMidY = (tip.y + p1.y) / 2;
    const rightDx = p1.x - tip.x;
    const rightDy = p1.y - tip.y;
    const rightLen = Math.hypot(rightDx, rightDy);

    const rightPerpX = rightLen > 0 ? (rightDy / rightLen) * dir : 0;
    const rightPerpY = rightLen > 0 ? (-rightDx / rightLen) * dir : 0;

    const rightBow = rightLen * bowFactor;
    const ctrl2X = rightMidX + rightPerpX * rightBow;
    const ctrl2Y = rightMidY + rightPerpY * rightBow;

    return `M ${p0.x},${p0.y} Q ${ctrl1X},${ctrl1Y} ${tip.x},${tip.y} Q ${ctrl2X},${ctrl2Y} ${p1.x},${p1.y}`;
}

type WedgeProps = {
    wedge: WedgeModel;
    mergeInto: (transformerId: string, argumentation: Argumentation) => void;
    isHovered: boolean;
    hoveredWedgeId: string | null;
    onHoverChange: (wedgeId: string | null) => void;
    onArgumentationChange: () => void;
} & React.SVGProps<SVGGElement>;

export const Wedge = memo(function Wedge({ wedge, mergeInto, isHovered, onHoverChange, onArgumentationChange, ...svgProps }: WedgeProps) {
    const [argumentationDialogOpen, setArgumentationDialogOpen] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [originLeftDuringDrag, setOriginLeftDuringDrag] = useState(false);
    const { activeTransformer } = useSelection();
    const { dragItem } = useSvgDnd();
    const { bellowsStroke, tipRadius, tipRadiusExpanded, tipStroke } = useWedgeScale();

    // Reset originLeftDuringDrag when drag ends
    const isDragging = dragItem !== null;
    if (!isDragging && originLeftDuringDrag) {
        setOriginLeftDuringDrag(false);
    }

    const containsActiveTransformer = wedge.transformers.some(t => t.id === activeTransformer?.id);
    // Origin wedge collapses once left during drag
    const expanded = isDragOver || (!originLeftDuringDrag && (isHovered || containsActiveTransformer));

    const { dropRef } = useDropTarget({
        id: wedge.argumentationId,
        onDragEnter: (item) => {
            const isOrigin = wedge.transformers.some(t => t.id === item.id);
            if (isOrigin) {
                // Re-entering origin: allow it to expand again (abort scenario)
                setOriginLeftDuringDrag(false);
            }
            setIsDragOver(true);
        },
        onDragLeave: (item) => {
            setIsDragOver(false);
            // If this is the origin wedge, collapse it once left
            const isOrigin = wedge.transformers.some(t => t.id === item.id);
            if (isOrigin) {
                setOriginLeftDuringDrag(true);
            }
        },
        onDrop: (item) => {
            setIsDragOver(false);
            const alreadyInWedge = wedge.transformers.some(t => t.id === item.id);
            if (!alreadyInWedge) {
                mergeInto(item.id, wedge.argumentation)
            }
        }
    });


    const stroke = "rgba(0,0,0,0.35)";

    let label = "";
    if (wedge.argumentation.conclusion.motivation === "intensification") {
        label = "+";
    }
    else if (wedge.argumentation.conclusion.motivation === "relaxation") {
        label = "–";
    }

    const cx = wedge.tip.x;
    const cy = wedge.tip.y;

    // Memoize the circle packing computation - only recompute when transformers or position changes
    const packedTransformers = useMemo(() => {
        if (!expanded) return [];
        return zip(
            wedge.transformers,
            packCirclesInCircle(wedge.transformers.length, tipRadiusExpanded, { x: cx, y: cy })
        );
    }, [expanded, wedge.transformers, cx, cy, tipRadiusExpanded]);

    return (
        <g>
            <path
                d={generateCurvedWedgePath(wedge.polygon[0], wedge.polygon[1], wedge.polygon[2], wedge.side, 0.05)}
                stroke={stroke}
                strokeWidth={bellowsStroke}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
            />

            <g
                onMouseEnter={() => onHoverChange(wedge.argumentationId)}
                onMouseLeave={() => onHoverChange(null)}
                {...svgProps}
            >
                <circle
                    cx={cx}
                    cy={cy}
                    r={expanded ? tipRadiusExpanded : tipRadius}
                    fill={expanded ? '#7bb555ff' : 'darkgray'}
                    fillOpacity={expanded ? 0.9 : 0.6}
                    onClick={() => setArgumentationDialogOpen(true)}
                    stroke='black'
                    strokeWidth={tipStroke}
                    ref={dropRef}
                />
                {expanded
                    ? packedTransformers.map(({ x, y, ...transformer }) => (
                        <Fragment key={`wedge_${wedge.argumentationId}_transformer_${transformer.id}`}>
                            <TransformerCircle x={x} y={y} transformer={transformer} />
                        </Fragment>
                    ))
                    : (
                        <text
                            x={cx}
                            y={cy}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize={12}
                            fontWeight='bold'
                            fill="black"
                        >
                            {label}
                        </text>
                    )}
            </g>

            <foreignObject>
                <ArgumentationDialog
                    open={argumentationDialogOpen}
                    onClose={() => setArgumentationDialogOpen(false)}
                    argumentation={wedge.argumentation}
                    onChange={onArgumentationChange}
                />
            </foreignObject>
        </g>
    );
}, (prevProps, nextProps) => {
    // Custom comparison to prevent unnecessary re-renders
    // Only re-render if these specific things changed:
    return (
        prevProps.wedge.argumentationId === nextProps.wedge.argumentationId &&
        prevProps.isHovered === nextProps.isHovered &&
        prevProps.wedge.tip.x === nextProps.wedge.tip.x &&
        prevProps.wedge.tip.y === nextProps.wedge.tip.y &&
        prevProps.wedge.polygon[0].x === nextProps.wedge.polygon[0].x &&
        prevProps.wedge.polygon[0].y === nextProps.wedge.polygon[0].y &&
        prevProps.wedge.polygon[1].x === nextProps.wedge.polygon[1].x &&
        prevProps.wedge.polygon[1].y === nextProps.wedge.polygon[1].y &&
        prevProps.wedge.polygon[2].x === nextProps.wedge.polygon[2].x &&
        prevProps.wedge.polygon[2].y === nextProps.wedge.polygon[2].y &&
        prevProps.wedge.transformers.length === nextProps.wedge.transformers.length
    );
});
