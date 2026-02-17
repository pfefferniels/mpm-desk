import { useRef, useState } from "react";
import { Menu, MenuItem } from "@mui/material";
import { OptionsDialog } from "./OptionsDialog";
import { useDraggable } from "./svg-dnd";
import { Transformer } from "mpmify";
import { useSelection } from "../hooks/SelectionProvider";
import { useWedgeScale } from "../hooks/useWedgeScale";

export const TransformerCircle = ({ x, y, transformer, elementTypes }: { x: number, y: number, transformer: Transformer, elementTypes: string[] }) => {
    const { onPointerDown, draggableProps, isDragging } = useDraggable({ id: transformer.id, type: "circle" });
    const { activeTransformerIds, toggleActiveTransformer, removeTransformer, replaceTransformer, focusTransformer } = useSelection();
    const { transformerRadius } = useWedgeScale();
    const [hovered, setHovered] = useState(false);
    const didDragRef = useRef(false);
    const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
    const [editDialogOpen, setEditDialogOpen] = useState(false);

    const hasElements = elementTypes.length > 0;
    const primaryLabel = hasElements
        ? elementTypes.map(t => `<${t}>`).join(', ')
        : transformer.name;

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setMenuAnchor({ x: e.clientX, y: e.clientY });
    };

    const handleCloseMenu = () => {
        setMenuAnchor(null);
    };

    const handleEdit = () => {
        handleCloseMenu();
        setEditDialogOpen(true);
    };

    const handleRemove = () => {
        handleCloseMenu();
        removeTransformer(transformer);
    };

    // When dragging, DragLayer renders the visual; this circle just handles pointer capture
    return (
        <>
            <circle
                cx={x}
                cy={y}
                r={transformerRadius}
                fill="black"
                fillOpacity={isDragging ? 0 : (hovered || activeTransformerIds.has(transformer.id)) ? 0.8 : 0.5}
                onMouseOver={() => setHovered(true)}
                onMouseOut={() => setHovered(false)}
                onContextMenu={handleContextMenu}
                {...draggableProps}
                onPointerDown={e => {
                    didDragRef.current = false;
                    onPointerDown(e, { x, y });
                }}
                onPointerMove={() => {
                    didDragRef.current = true;
                }}
                onClick={(e) => {
                    if (!didDragRef.current) {
                        if (e.metaKey || e.ctrlKey) {
                            toggleActiveTransformer(transformer.id);
                        } else {
                            focusTransformer(transformer.id);
                        }
                    }
                }}
            />

            {!isDragging && (hovered || activeTransformerIds.has(transformer.id)) && (
                <foreignObject
                    x={x + 10}
                    y={y + 10}
                    width={250}
                    height={hasElements ? 40 : 24}
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
                        {primaryLabel}
                        {hasElements && (
                            <div style={{ fontSize: '10px', color: 'gray' }}>
                                {transformer.name}
                            </div>
                        )}
                    </div>
                </foreignObject>
            )}

            <Menu
                open={menuAnchor !== null}
                onClose={handleCloseMenu}
                anchorReference="anchorPosition"
                anchorPosition={menuAnchor !== null ? { top: menuAnchor.y, left: menuAnchor.x } : undefined}
            >
                <MenuItem onClick={handleEdit}>Edit...</MenuItem>
                <MenuItem onClick={handleRemove}>Remove</MenuItem>
            </Menu>

            <OptionsDialog
                open={editDialogOpen}
                onClose={() => setEditDialogOpen(false)}
                options={transformer.options}
                onDone={(newOptions) => {
                    const updated = { ...transformer, options: newOptions } as Transformer;
                    replaceTransformer(updated);
                    setEditDialogOpen(false);
                }}
            />
        </>
    )
}
