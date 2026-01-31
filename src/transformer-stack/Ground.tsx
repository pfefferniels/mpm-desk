import { useDropTarget } from "./svg-dnd";

export const Ground = ({ width, height, extractTransformer, onClearSelection }: { width: number; height: number, extractTransformer: (transformerId: string) => void, onClearSelection: () => void }) => {
    const { isOver, dropRef } = useDropTarget({
        id: 'ground',
        onDrop: (item) => {
            extractTransformer(item.id);
        }
    });
    
    return (
        <rect
            x={0}
            y={0}
            width={width}
            height={height}
            fill={isOver ? '#e0ffe0' : '#f0f0f0'}
            ref={dropRef}
            onClick={onClearSelection}
        />
    );
}
