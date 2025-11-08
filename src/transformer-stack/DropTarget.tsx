import { CSSProperties, useEffect, useRef, useState } from "react";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";

interface DropTargetProps extends CSSProperties {
    onAdd: (transformerId: string) => void;
}

export const DropTarget = ({ onAdd, ...cssProperties }: DropTargetProps) => {
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
        <div
            className='dropTarget'
            ref={ref}
            style={{
                position: 'absolute',
                backgroundColor: dragTarget ? 'rgba(0, 255, 0, 0.1)' : 'transparent',
                ...cssProperties
            }} />
    )
}
