import { Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/types";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { pointerOutsideOfPreview } from "@atlaskit/pragmatic-drag-and-drop/element/pointer-outside-of-preview";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import { ErrorOutline, Warning, Delete } from "@mui/icons-material";
import { ListItem, ListItemIcon, ListItemButton, ListItemText, IconButton, Tooltip } from "@mui/material";
import { ValidationMessage } from "mpmify";
import { Transformer } from "mpmify/lib/transformers/Transformer";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import invariant from "tiny-invariant";
import DropIndicator from "./DropIndicator";
import { getTransformerData } from "./transformer-data";

interface TransformerListItemProps {
    transformer: Transformer;
    message?: ValidationMessage
    onRemove: () => void;
    onSelect: () => void;
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

export const TransformerListItem = ({ transformer, onRemove, onSelect, selected, message }: TransformerListItemProps) => {
    const [state, setState] = useState<TransformerState>(idle);
    const ref = useRef<HTMLLIElement | null>(null);

    const optionsString = JSON.stringify(transformer.options);
    const displayText =
        message
            ? <span>{message.message}</span>
            : (
                optionsString.length > 20
                    ? optionsString.slice(0, 20) + "..."
                    : optionsString);


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
                    setState({ type: 'is-dragging' });
                },
                onDrop() {
                    setState(idle);
                },
            }),
            //dropTargetForElements({
            //    element,
            //    canDrop({ source }) {
            //        // not allowing dropping on yourself
            //        if (source.element === element) {
            //            return false;
            //        }
            //        // only allowing transformers to be dropped on me
            //        return isTransformerData(source.data);
            //    },
            //    getData({ input }) {
            //        const data = getTransformerData(transformer);
            //        return attachClosestEdge(data, {
            //            element,
            //            input,
            //            allowedEdges: ['top', 'bottom'],
            //        });
            //    },
            //    getIsSticky() {
            //        return true;
            //    },
            //    onDragEnter({ self }) {
            //        const closestEdge = extractClosestEdge(self.data);
            //        setState({ type: 'is-dragging-over', closestEdge });
            //    },
            //    onDrag({ self }) {
            //        const closestEdge = extractClosestEdge(self.data);
//
            //        // Only need to update react state if nothing has changed.
            //        // Prevents re-rendering.
            //        setState((current) => {
            //            if (current.type === 'is-dragging-over' && current.closestEdge === closestEdge) {
            //                return current;
            //            }
            //            return { type: 'is-dragging-over', closestEdge };
            //        });
            //    },
            //    onDragLeave() {
            //        setState(idle);
            //    },
            //    onDrop({ self, location }) {
            //        console.log('self', self);
            //        console.log('location', location);
            //        setState(idle);
            //    },
            //}),
        );
    }, [transformer]);

    return (
        <ListItem
            ref={ref}
            data-transformer-id={transformer.id}
            divider
        >
            {message && (
                <ListItemIcon>
                    {message.type === 'error' && <ErrorOutline color="error" />}
                    {message.type === 'warning' && <Warning color="warning" />}
                </ListItemIcon>
            )}
            <Tooltip title={optionsString}>
                <ListItemButton
                    onClick={onSelect}
                    selected={selected}
                >
                    <ListItemText primary={transformer.name} secondary={displayText} title="test" />
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

            {state.type === 'is-dragging-over' && state.closestEdge ? (
                <DropIndicator edge={state.closestEdge} gap={'8px'} />
            ) : null}
            {state.type === 'preview' ? createPortal(<DragPreview transformer={transformer} />, state.container) : null}
        </ListItem>
    );
};


// A simplified version of our task for the user to drag around
function DragPreview({ transformer }: { transformer: Transformer }) {
    return <div className="border-solid rounded p-2 bg-white">{transformer.name}</div>;
}