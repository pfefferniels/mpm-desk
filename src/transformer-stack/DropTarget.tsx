import { ListItemButton } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { AddCircle } from "@mui/icons-material";

interface DropTargetProps {
    onAdd: (transformerId: string) => void;
}

export const DropTarget = ({ onAdd }: DropTargetProps) => {
    const [dragTarget, setDragTarget] = useState(false)
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!ref.current) return

        dropTargetForElements({
            element: ref.current,
            canDrop({ source }) {
                return source.data.type === 'transformer'
            },
            onDrop(data) {
                const { source } = data;
                console.log('data=', data, source);
                // mergeInto(source.data.transformerId as string, argumentation)
                onAdd(source.data.transformerId as string)
                setDragTarget(false)
            },
            onDragEnter() {
                setDragTarget(true)
            },
            onDragLeave() {
                setDragTarget(false)
            },
        })
    })

    return (
        <>
            <ListItemButton ref={ref} style={{
                height: dragTarget ? '3rem' : '0.2rem',
                justifyContent: 'center',
                backgroundColor: dragTarget ? 'rgba(0, 255, 0, 0.1)' : 'transparent',
            }}>
                {dragTarget && (
                    <AddCircle color="success" />
                )}
            </ListItemButton>
        </>
    )
}
