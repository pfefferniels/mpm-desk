import { Fragment, memo, useRef, useState, useMemo } from "react";
import { WedgeModel } from "./WedgeModel";
import { ArgumentationDialog } from "./ArgumentationDialog";
import { packCirclesInCircle } from "../utils/packInCircles";
import { zip } from "../utils/zip";
import { useDraggable, useDropTarget } from "./svg-dnd";
import { Argumentation, Transformer } from "mpmify";
import { useSymbolicZoom } from "../hooks/ZoomProvider";
import { useSelection } from "../hooks/SelectionProvider";

const TransformerCircle = ({ x, y, transformer }: { x: number, y: number, transformer: Transformer }) => {
    const { dragPoint, onPointerDown, draggableProps } = useDraggable({ id: transformer.id, type: "circle" });
    const { activeTransformer, setActiveTransformer } = useSelection();
    const [hovered, setHovered] = useState(false);
    const didDragRef = useRef(false);

    const text = transformer.name

    return (
        <>
            <circle
                cx={dragPoint?.x ?? x}
                cy={dragPoint?.y ?? y}
                r={10}
                fill="black"
                fillOpacity={(hovered || activeTransformer?.id === transformer.id) ? 0.8 : 0.5}
                onMouseOver={() => setHovered(true)}
                onMouseOut={() => setHovered(false)}
                {...draggableProps}
                onPointerDown={e => {
                    didDragRef.current = false;
                    onPointerDown(e, dragPoint ?? { x, y });
                }}
                onPointerMove={() => {
                    didDragRef.current = true;
                }}
                onClick={() => {
                    if (!didDragRef.current) {
                        setActiveTransformer(transformer);
                    }
                }}
            />

            {(hovered || activeTransformer?.id === transformer.id) && (
                <foreignObject
                    x={(dragPoint?.x ?? x) + 10}
                    y={(dragPoint?.y ?? y) + 10}
                    width={250}
                    height={24}
                >
                    <div
                        style={{
                            backgroundColor: 'white',
                            border: '1px solid gray',
                            borderRadius: '4px',
                            padding: '2px 4px',
                            fontSize: '12px',
                            boxShadow: '2px 2px 5px rgba(0,0,0,0.3)',
                            pointerEvents: 'none',
                            userSelect: 'none',
                            textAlign: 'center',
                            width: 'fit-content',
                        }}
                    >
                        {text}
                    </div>
                </foreignObject>
            )}
        </>
    )
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
    const { activeTransformer } = useSelection();

    const stretchX = useSymbolicZoom();
    const showWedges = stretchX > 0.05;

    const containsActiveTransformer = wedge.transformers.some(t => t.id === activeTransformer?.id);
    const expanded = isHovered || isDragOver || containsActiveTransformer;

    const { dropRef } = useDropTarget({
        id: wedge.argumentationId,
        onDragEnter: () => {
            setIsDragOver(true);
        },
        onDragLeave: () => {
            setIsDragOver(false);
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
    const strokeWidth = 2;

    let label = "";

    if (showWedges) {
        if (wedge.argumentation.conclusion.motivation === "intensification") {
            label = "+";
        }
        else if (wedge.argumentation.conclusion.motivation === "relaxation") {
            label = "–";
        }
    }

    const cx = wedge.tip.x;
    const cy = wedge.tip.y;

    // Memoize the circle packing computation - only recompute when transformers or position changes
    const packedTransformers = useMemo(() => {
        if (!expanded) return [];
        return zip(
            wedge.transformers,
            packCirclesInCircle(wedge.transformers.length, 30, { x: cx, y: cy })
        );
    }, [expanded, wedge.transformers, cx, cy]);

    return (
        <g>
            {showWedges && (
                <>
                    <line
                        x1={wedge.polygon[0].x}
                        y1={wedge.polygon[0].y}
                        x2={wedge.polygon[2].x}
                        y2={wedge.polygon[2].y}
                        stroke={stroke}
                        strokeWidth={strokeWidth}
                        strokeLinejoin="round"
                    />
                    <line
                        x1={wedge.polygon[1].x}
                        y1={wedge.polygon[1].y}
                        x2={wedge.polygon[2].x}
                        y2={wedge.polygon[2].y}
                        stroke={stroke}
                        strokeWidth={strokeWidth}
                        strokeLinejoin="round"
                    />
                </>
            )}

            <g
                onMouseOver={() => onHoverChange(wedge.argumentationId)}
                onMouseOut={() => onHoverChange(null)}
                {...svgProps}
            >
                <circle
                    cx={cx}
                    cy={cy}
                    r={expanded ? 30 : 8}
                    fill={expanded ? '#7bb555ff' : 'darkgray'}
                    fillOpacity={expanded ? 0.9 : 0.6}
                    onClick={() => setArgumentationDialogOpen(true)}
                    stroke='black'
                    strokeWidth={1}
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
