import React, {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useRef,
    useState,
} from "react";

type Pt = { x: number; y: number };

export type DragItem = {
    id: string;
    type?: string; // optional kind for accept filtering
};

export type DropSpec = {
    id: string;
    accept?: string[]; // omit => accept all
    onDragEnter?: (item: DragItem) => void;
    onDragLeave?: (item: DragItem) => void;
    onDrop?: (item: DragItem) => void;
};

type DropEntry = {
    spec: DropSpec;
    el: SVGGeometryElement;
    isOver: boolean;
};

type SvgHandlers = Pick<
    React.SVGProps<SVGSVGElement>,
    "onPointerMove" | "onPointerUp" | "onPointerCancel"
>;

type DndContextValue = {
    svgRef: React.RefObject<SVGSVGElement>;
    svgHandlers: SvgHandlers;

    dragging: boolean;
    dragItem: DragItem | null;
    dragPoint: Pt | null;

    beginDrag: (item: DragItem, grabOffset: Pt) => void;

    registerDrop: (spec: DropSpec, el: SVGGeometryElement | null) => void;
    getIsOver: (dropId: string) => boolean;
};

const SvgDndContext = createContext<DndContextValue | null>(null);

export function useSvgDnd() {
    const ctx = useContext(SvgDndContext);
    if (!ctx) throw new Error("useSvgDnd must be used within <SvgDndProvider>");
    return ctx;
}

function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number): Pt {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;

    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };

    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
}

/**
 * Hit test a point in SVG root coords against a geometry element using fill/stroke.
 * We transform the point to the element’s local coords via screen CTM.
 */
function hitTestGeometry(svg: SVGSVGElement, el: SVGGeometryElement, pSvg: Pt) {
    const svgPoint = svg.createSVGPoint();
    svgPoint.x = pSvg.x;
    svgPoint.y = pSvg.y;

    const elToScreen = el.getScreenCTM();
    if (!elToScreen) return { inFill: false, inStroke: false };

    const pEl = svgPoint

    return {
        inFill: el.isPointInFill(pEl),
        inStroke: el.isPointInStroke(pEl),
    };
}

export function SvgDndProvider({
    children,
}: {
    children: React.ReactNode;
}) {
    const svgRef = useRef<SVGSVGElement | null>(null);

    const dropMapRef = useRef<Map<string, DropEntry>>(new Map());
    const overIdRef = useRef<string | null>(null);

    const grabOffsetRef = useRef<Pt>({ x: 0, y: 0 });

    const [dragging, setDragging] = useState(false);
    const [dragItem, setDragItem] = useState<DragItem | null>(null);
    const [dragPoint, setDragPoint] = useState<Pt | null>(null);

    // used to refresh isOver states on targets
    const [, forceTick] = useState(0);

    const getIsOver = useCallback((dropId: string) => {
        return dropMapRef.current.get(dropId)?.isOver ?? false;
    }, []);

    const registerDrop = useCallback((spec: DropSpec, el: SVGGeometryElement | null) => {
        const map = dropMapRef.current;

        if (!el) {
            map.delete(spec.id);
            return;
        }

        const prev = map.get(spec.id);
        map.set(spec.id, {
            spec,
            el,
            isOver: prev?.isOver ?? false,
        });
    }, []);

    const beginDrag = useCallback((item: DragItem, grabOffset: Pt) => {
        setDragging(true);
        setDragItem(item);
        grabOffsetRef.current = grabOffset;
    }, []);

    const recomputeOver = useCallback((nextPoint: Pt, item: DragItem) => {
        const svg = svgRef.current;
        if (!svg) return;

        const entries = Array.from(dropMapRef.current.entries());

        let nextOverId: string | null = null;

        // top-most wins; iterate reverse of insertion order
        for (let i = entries.length - 1; i >= 0; i--) {
            const [id, entry] = entries[i];
            const { spec, el } = entry;

            // accept filtering
            if (spec.accept) {
                if (!item.type) continue;
                if (!spec.accept.includes(item.type)) continue;
            }

            const { inFill, inStroke } = hitTestGeometry(svg, el, nextPoint);
            if (inFill || inStroke) {
                nextOverId = id;
                break;
            }
        }

        const prevOverId = overIdRef.current;
        if (prevOverId === nextOverId) return;

        // update + fire enter/leave
        if (prevOverId) {
            const prev = dropMapRef.current.get(prevOverId);
            if (prev) {
                prev.isOver = false;
                prev.spec.onDragLeave?.(item);
            }
        }

        if (nextOverId) {
            const next = dropMapRef.current.get(nextOverId);
            if (next) {
                next.isOver = true;
                next.spec.onDragEnter?.(item);
            }
        }

        overIdRef.current = nextOverId;
        forceTick((t) => t + 1);
    }, []);

    const moveDrag = useCallback(
        (clientX: number, clientY: number) => {
            if (!dragging || !dragItem) return;
            const svg = svgRef.current;
            if (!svg) return;

            const p = clientToSvg(svg, clientX, clientY);
            const next = { x: p.x - grabOffsetRef.current.x, y: p.y - grabOffsetRef.current.y };

            setDragPoint(next);
            recomputeOver(next, dragItem);
        },
        [dragging, dragItem, recomputeOver]
    );

    const endDrag = useCallback(
        (clientX?: number, clientY?: number) => {
            if (!dragging || !dragItem) return;

            // Recompute "over" at the exact pointer-up position
            if (clientX != null && clientY != null) {
                const svg = svgRef.current;
                if (svg) {
                    const p = clientToSvg(svg, clientX, clientY);
                    const next = {
                        x: p.x - grabOffsetRef.current.x,
                        y: p.y - grabOffsetRef.current.y,
                    };
                    // update dragPoint for completeness (optional)
                    setDragPoint(next);
                    recomputeOver(next, dragItem);
                }
            }

            const overId = overIdRef.current;

            if (overId) {
                const entry = dropMapRef.current.get(overId);
                entry?.spec.onDrop?.(dragItem);

                // clear over state
                if (entry) entry.isOver = false;
                overIdRef.current = null;
                forceTick((t) => t + 1);
            }

            setDragging(false);
            setDragItem(null);
            setDragPoint(null);
        },
        [dragging, dragItem, recomputeOver]
    );

    const svgHandlers: SvgHandlers = useMemo(
        () => ({
            onPointerMove: (e) => moveDrag(e.clientX, e.clientY),
            onPointerUp: (e) => endDrag(e.clientX, e.clientY),
            onPointerCancel: (e) => endDrag(e.clientX, e.clientY),
        }),
        [moveDrag, endDrag]
    );

    const value: DndContextValue = useMemo(
        () => ({
            svgRef,
            svgHandlers,
            dragging,
            dragItem,
            dragPoint,
            beginDrag,
            registerDrop,
            getIsOver,
        }),
        [svgHandlers, dragging, dragItem, dragPoint, beginDrag, registerDrop, getIsOver]
    );

    return <SvgDndContext.Provider value={value}>{children}</SvgDndContext.Provider>;
}

/**
 * Draggable hook.
 * You provide the current "anchor point" (e.g. circle center) in onPointerDown.
 * During drag, dragPoint will be set (SVG coords).
 */
export function useDraggable(item: DragItem) {
    const { svgRef, beginDrag, dragging, dragItem, dragPoint } = useSvgDnd();

    const isDragging = dragging && dragItem?.id === item.id;

    const onPointerDown = useCallback(
        (e: React.PointerEvent<SVGGeometryElement>, anchor: Pt) => {
            const svg = svgRef.current;
            if (!svg) return;

            (e.currentTarget as SVGGeometryElement).setPointerCapture(e.pointerId);

            const p = clientToSvg(svg, e.clientX, e.clientY);
            const grabOffset = { x: p.x - anchor.x, y: p.y - anchor.y };
            beginDrag(item, grabOffset);
        },
        [svgRef, beginDrag, item]
    );

    const draggableProps = useMemo(
        () => ({
            style: { cursor: isDragging ? "grabbing" : undefined } as React.CSSProperties,
        }),
        [isDragging]
    );

    return {
        isDragging,
        dragPoint: isDragging ? dragPoint : null,
        onPointerDown,
        draggableProps,
    };
}

/**
 * Drop target hook.
 * Attach dropRef to any SVGGeometryElement.
 */
export function useDropTarget(spec: DropSpec) {
    const { registerDrop, getIsOver } = useSvgDnd();

    const dropRef = useCallback(
        (node: SVGGeometryElement | null) => registerDrop(spec, node),
        [registerDrop, spec]
    );

    const isOver = getIsOver(spec.id);

    return { dropRef, isOver };
}
