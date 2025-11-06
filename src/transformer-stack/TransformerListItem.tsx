import { Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/types";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { pointerOutsideOfPreview } from "@atlaskit/pragmatic-drag-and-drop/element/pointer-outside-of-preview";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import { Delete, Edit } from "@mui/icons-material";
import { ListItem, ListItemIcon, ListItemButton, ListItemText, IconButton, Tooltip } from "@mui/material";
import { TransformationOptions, Transformer } from "mpmify/lib/transformers/Transformer";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import invariant from "tiny-invariant";
import { getTransformerData } from "./transformer-data";
import { OptionsDialog } from "./OptionsDialog";

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

const isRangeBased = (transformer: TransformationOptions): transformer is TransformationOptions & { from: number; to: number } => {
    return 'from' in transformer && 'to' in transformer;
}

const isDateBased = (transformer: TransformationOptions): transformer is TransformationOptions & { date: number } => {
    return 'date' in transformer;
}

const isNoteBased = (transformer: TransformationOptions): transformer is TransformationOptions & { noteid: string } => {
    return 'noteid' in transformer;
}

export const TransformerListItem = ({ transformer, index, onRemove, onSelect, onEdit, onStateChange, selected }: TransformerListItemProps) => {
    const [edit, setEdit] = useState(false)
    const [state, setState] = useState<TransformerState>(idle);
    const ref = useRef<HTMLLIElement | null>(null);

    const optionsString = JSON.stringify(transformer.options);
    const displayText = (
        <span>
            {
                isRangeBased(transformer.options) ? `${transformer.options.from}-${transformer.options.to}`
                    : isDateBased(transformer.options) ? `@${transformer.options.date}`
                        : isNoteBased(transformer.options) ? `#${transformer.options.noteid}`
                            : ''}
        </span>
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
        <ListItem
            ref={ref}
            data-transformer-id={transformer.id}
            divider
        >
            <ListItemIcon>
                <span>{index}</span>
            </ListItemIcon>
            <Tooltip title={optionsString}>
                <ListItemButton
                    onClick={onSelect}
                    selected={selected}
                >
                    <ListItemText primary={<span>{transformer.name} {displayText}</span>} />

                    <IconButton
                        onClick={(e) => {
                            e.stopPropagation();
                            setEdit(true)
                        }}
                    >
                        <Edit />
                    </IconButton>

                    <IconButton
                        onClick={(e) => {
                            e.stopPropagation();
                            onRemove();
                        }}
                    >
                        <Delete />
                    </IconButton>
                </ListItemButton>
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

            {state.type === 'preview' ? createPortal(<DragPreview transformer={transformer} />, state.container) : null}
        </ListItem>
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
