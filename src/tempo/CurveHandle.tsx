import { useState, useEffect, MouseEventHandler } from "react";

interface CurveHandleProps {
    x: number;
    y: number;
    onDrag: (newY: number) => void;
}

export const CurveHandle = ({ x, y, onDrag }: CurveHandleProps) => {
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
        // Calculate the difference between the mouse position and the current handle position
        setOffsetY(e.clientY - currentY);
        setDragging(true);
    };

    return (
        <circle
            cx={x}
            cy={currentY}
            r={5}
            fill="black"
            onMouseDown={handleMouseDown}
        />
    );
};