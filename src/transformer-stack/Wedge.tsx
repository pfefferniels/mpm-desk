import { Fragment, useRef, useState } from "react";
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
    const { setActiveTransformer } = useSelection();
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
                fillOpacity={hovered ? 0.8 : 0.5}
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

            {hovered && (
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
};

export function Wedge({ wedge, mergeInto }: WedgeProps) {
    const [argumentationDialogOpen, setArgumentationDialogOpen] = useState(false);
    const [hovered, setHovered] = useState(false);

    const stretchX = useSymbolicZoom();
    const showWedges = stretchX > 0.05;

    const { dropRef } = useDropTarget({
        id: wedge.argumentationId,
        onDragEnter: () => {
            setHovered(true);
        },
        onDragLeave: () => {
            setHovered(false);
        },
        onDrop: (item) => {
            mergeInto(item.id, wedge.argumentation)
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
                        strokeDasharray="5 2"
                        strokeLinejoin="round"
                    />
                    <line
                        x1={wedge.polygon[1].x}
                        y1={wedge.polygon[1].y}
                        x2={wedge.polygon[2].x}
                        y2={wedge.polygon[2].y}
                        stroke={stroke}
                        strokeWidth={strokeWidth}
                        strokeDasharray="5 2"
                        strokeLinejoin="round"
                    />
                </>
            )}

            <g
                onMouseOver={() => setHovered(true)}
                onMouseOut={() => setHovered(false)}
            >
                <circle
                    cx={cx}
                    cy={cy}
                    r={hovered ? 30 : 8}
                    fill={hovered ? '#7bb555ff' : 'darkgray'}
                    fillOpacity={hovered ? 0.7 : 0.1}
                    onClick={() => setArgumentationDialogOpen(true)}
                    stroke='black'
                    strokeWidth={1}
                    ref={dropRef}
                />
                {hovered
                    ? (
                        zip(wedge.transformers,
                            packCirclesInCircle(wedge.transformers.length, 30, { x: cx, y: cy })
                        )
                            .map(({ x, y, ...transformer }) => {
                                return (
                                    <Fragment key={`wedge_${wedge.argumentationId}_transformer_${transformer.id}`}>
                                        <TransformerCircle x={x} y={y} transformer={transformer} />
                                    </Fragment>
                                )
                            })
                    )
                    : (
                        <text
                            x={cx}
                            y={cy}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize={12}
                            fill="rgba(0,0,0,0.6)"
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
                    onChange={() => { }}
                />
            </foreignObject>
        </g>
    );
}
