import { Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/types";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { pointerOutsideOfPreview } from "@atlaskit/pragmatic-drag-and-drop/element/pointer-outside-of-preview";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import { Menu, MenuItem, Tooltip } from "@mui/material";
import { TransformationOptions, Transformer } from "mpmify/lib/transformers/Transformer";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import invariant from "tiny-invariant";
import { getTransformerData } from "./transformer-data";
import { OptionsDialog } from "./OptionsDialog";
import { Delete, Edit } from "@mui/icons-material";

interface TransformerListItemProps {
    transformer: Transformer;
    index: number;
    onRemove: () => void;
    onSelect: () => void;
    onEdit: (TransformationOptions: TransformationOptions) => void;
    onStateChange: (state: TransformerState) => void;
    selected: boolean;
}

type TransformerState =
    | {
        type: 'idle';
    }
    | {
        type: 'preview';
        container: HTMLElement;
    }
    | {
        type: 'is-dragging';
    }
    | {
        type: 'is-dragging-over';
        closestEdge: Edge | null;
    };

const idle: TransformerState = { type: 'idle' };

export const isRangeBased = (transformer: TransformationOptions): transformer is TransformationOptions & { from: number; to: number } => {
    return 'from' in transformer && 'to' in transformer;
}

export const isDateBased = (transformer: TransformationOptions): transformer is TransformationOptions & { date: number } => {
    return 'date' in transformer;
}

export const isNoteBased = (transformer: TransformationOptions): transformer is TransformationOptions & { noteid: string } => {
    return 'noteid' in transformer;
}

export const TransformerListItem = ({ transformer, index, onRemove, onSelect, onEdit, onStateChange, selected }: TransformerListItemProps) => {
    const [edit, setEdit] = useState(false)
    const [state, setState] = useState<TransformerState>(idle);
    const ref = useRef<HTMLDivElement | null>(null);

    const [contextMenu, setContextMenu] = useState<{
        mouseX: number;
        mouseY: number;
    } | null>(null);

    const handleContextMenu = (event: React.MouseEvent) => {
        event.preventDefault();

        setContextMenu(
            contextMenu === null
                ? {
                    mouseX: event.clientX + 2,
                    mouseY: event.clientY - 6,
                }
                : // repeated contextmenu when it is already open closes it with Chrome 84 on Ubuntu
                // Other native context menus might behave different.
                // With this behavior we prevent contextmenu from the backdrop to re-locale existing context menus.
                null,
        );
    }


    const displayText = (
        isRangeBased(transformer.options) ? `${transformer.options.from}-${transformer.options.to}`
            : isDateBased(transformer.options) ? `@${transformer.options.date}`
                : isNoteBased(transformer.options) ? `#${transformer.options.noteid}`
                    : ''
    )

    useEffect(() => {
        const element = ref.current;
        invariant(element);
        return combine(
            draggable({
                element,
                getInitialData() {
                    return getTransformerData(transformer);
                },
                onGenerateDragPreview({ nativeSetDragImage }) {
                    setCustomNativeDragPreview({
                        nativeSetDragImage,
                        getOffset: pointerOutsideOfPreview({
                            x: '16px',
                            y: '8px',
                        }),
                        render({ container }) {
                            setState({ type: 'preview', container });
                        },
                    });
                },
                onDragStart() {
                    console.log('onDragStart');
                    setState({ type: 'is-dragging' });
                    onStateChange({ type: 'is-dragging' });
                },
                onDrop() {
                    setState(idle);
                    onStateChange(idle);
                },
            }),
        );
    }, [transformer, onStateChange]);

    useEffect(() => {
        if (selected) {
            ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }, [selected])

    return (
        <div
            style={{ float: 'left' }}
            ref={ref}
            data-transformer-id={transformer.id}
            onContextMenu={(e) => {
                onSelect()
                handleContextMenu(e)
            }}
        >
            <Tooltip title={`${transformer.name} (${displayText})`}>
                <div
                    style={{
                        fontSize: 10,
                        backgroundColor: '#ff4516ff',
                        color: 'white',
                        padding: '0.2rem',
                        margin: '0.2rem', borderRadius: 4,
                        cursor: 'pointer',
                        border: selected ? '1px solid black' : 'inherit'
                    }}
                    onClick={onSelect}
                >
                    <span>{index}</span>
                </div>
            </Tooltip>

            <OptionsDialog
                open={edit}
                onClose={() => setEdit(false)}
                options={transformer.options}
                onDone={(options) => {
                    onEdit(options);
                    setEdit(false);
                }}
            />

            <Menu
                open={contextMenu !== null}
                onClose={() => setContextMenu(null)}
                anchorReference="anchorPosition"
                anchorPosition={
                    contextMenu !== null
                        ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
                        : undefined
                }
            >
                <MenuItem
                    onClick={() => {
                        onRemove();
                        setContextMenu(null);
                    }}
                >
                    <Delete /> Remove
                </MenuItem>
                <MenuItem
                    onClick={() => {
                        onEdit(transformer.options);
                        setContextMenu(null);
                    }}
                >
                    <Edit /> Details
                </MenuItem>
            </Menu>

            {state.type === 'preview' ? createPortal(<DragPreview transformer={transformer} />, state.container) : null}
        </div>
    )
};


// A simplified version of the transformer for the user to drag around
function DragPreview({ transformer }: { transformer: Transformer }) {
    return (
        <div style={{ backgroundColor: 'white', padding: '1rem' }}>
            {transformer.name}
        </div>
    )
}
