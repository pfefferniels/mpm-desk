import { Transformer } from "mpmify";
import { useSvgDnd } from "./svg-dnd";
import { useWedgeScale } from "../hooks/useWedgeScale";

interface DragLayerProps {
    transformers: Transformer[];
}

/**
 * Renders the currently-dragged transformer at the drag position.
 * This is rendered outside of wedges so it stays visible even when
 * the origin wedge collapses.
 */
export function DragLayer({ transformers }: DragLayerProps) {
    const { dragItem, dragPoint } = useSvgDnd();
    const { transformerRadius } = useWedgeScale();

    if (!dragItem || !dragPoint) return null;

    const transformer = transformers.find(t => t.id === dragItem.id);
    if (!transformer) return null;

    return (
        <g style={{ pointerEvents: 'none' }}>
            <circle
                cx={dragPoint.x}
                cy={dragPoint.y}
                r={transformerRadius}
                fill="black"
                fillOpacity={0.8}
            />
            <foreignObject
                x={dragPoint.x + 10}
                y={dragPoint.y + 10}
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
                    {transformer.name}
                </div>
            </foreignObject>
        </g>
    );
}
