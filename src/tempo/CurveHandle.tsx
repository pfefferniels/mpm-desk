import { useState, useEffect, MouseEventHandler } from "react";

interface CurveHandleProps {
    x: number;
    y: number;
    onDrag: (newY: number) => void;
}

export const CurveHandle = ({ x, y, onDrag }: CurveHandleProps) => {
    const [hovered, setHovered] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [currentY, setCurrentY] = useState(y);
    const [offsetY, setOffsetY] = useState(0);

    // Update currentY if y prop changes
    useEffect(() => {
        setCurrentY(y);
    }, [y]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            setCurrentY(e.clientY - offsetY);
        };

        const handleMouseUp = (e: MouseEvent) => {
            setDragging(false);
            onDrag(e.clientY - offsetY);
        };

        if (dragging) {
            window.addEventListener("mousemove", handleMouseMove);
            window.addEventListener("mouseup", handleMouseUp);
        }

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [dragging, offsetY, onDrag]);

    const handleMouseDown: MouseEventHandler<SVGCircleElement> = (e) => {
        setOffsetY(e.clientY - currentY);
        setDragging(true);
    };

    return (
        <circle
            cx={x}
            cy={currentY}
            r={4}
            fill='red'
            onMouseDown={handleMouseDown}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            fillOpacity={hovered ? 1 : 0.5}
        />
    );
};