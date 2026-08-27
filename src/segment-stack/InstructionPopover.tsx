import { useMemo, useState, useEffect } from "react";
import { Popper, Paper } from "@mui/material";
import type { PerformanceReader } from "../utils/mpm";
import { TempoInstructionView } from "./TempoInstructionView";
import { DynamicsInstructionView } from "./DynamicsInstructionView";
import { GenericInstructionView } from "./GenericInstructionView";

interface InstructionPopoverProps {
    mpm: PerformanceReader;
    activeSpanIds: Set<string>;
    /** The drawing a click in it opens this popover — the node, so the listener follows it. */
    svg: SVGSVGElement | null;
}

export const InstructionPopover = ({
    mpm,
    activeSpanIds,
    svg,
}: InstructionPopoverProps) => {
    // A span's id is the MPM element it leads with, so the selection names the
    // instruction to show outright.
    const activeId = useMemo(() => {
        if (activeSpanIds.size !== 1) return null;
        return activeSpanIds.values().next().value ?? null;
    }, [activeSpanIds]);

    const instruction = useMemo(
        () => (activeId ? mpm.byId(activeId) ?? null : null),
        [activeId, mpm],
    );

    // Both charts show the focused instruction against its neighbours. espressivo resolves
    // the span ends, the style-relative names and (for dynamics) the Bézier control points,
    // so there is nothing left here to derive — a null means the renderer skips it, which
    // is a document with no curve to draw rather than a curve of zero.
    const tempi = useMemo(
        () => (instruction?.type === 'tempo' ? mpm.tempoAround(instruction) : null),
        [instruction, mpm],
    );
    const dynamics = useMemo(
        () => (instruction?.type === 'dynamics' ? mpm.dynamicsAround(instruction) : null),
        [instruction, mpm],
    );

    // Anchor at the click position
    const [anchorPos, setAnchorPos] = useState<{ x: number; y: number } | null>(null);

    /**
     * A click position belongs to the selection it was made for: once the selection is no
     * longer a single span there is nothing left for it to point at, and keeping it would
     * open the next popover where the last click happened rather than where this one did.
     *
     * Dropped while rendering the selection that invalidates it, not in an effect after it:
     * the stale position then never reaches the screen at all.
     */
    const [selectionAnchoredFor, setSelectionAnchoredFor] = useState(activeSpanIds);
    if (selectionAnchoredFor !== activeSpanIds) {
        setSelectionAnchoredFor(activeSpanIds);
        if (activeSpanIds.size !== 1) setAnchorPos(null);
    }

    useEffect(() => {
        if (!svg || activeSpanIds.size !== 1) return;
        const handler = (e: MouseEvent) => setAnchorPos({ x: e.clientX, y: e.clientY });
        svg.addEventListener("click", handler);
        return () => svg.removeEventListener("click", handler);
    }, [activeSpanIds, svg]);

    const virtualElement = useMemo(() => {
        if (!anchorPos) return null;
        return {
            getBoundingClientRect: () => new DOMRect(anchorPos.x, anchorPos.y, 0, 0),
        };
    }, [anchorPos]);

    if (!instruction || !virtualElement) return null;

    return (
        <Popper
            open
            anchorEl={virtualElement}
            placement="top"
            modifiers={[
                { name: "offset", options: { offset: [0, 16] } },
                { name: "preventOverflow", options: { padding: 8 } },
            ]}
            style={{ zIndex: 10 }}
        >
            <Paper
                elevation={4}
                sx={{
                    borderRadius: 2,
                    overflow: "hidden",
                }}
            >
                {tempi ? (
                    <TempoInstructionView tempi={tempi} meter={mpm.meter} />
                ) : dynamics ? (
                    <DynamicsInstructionView dynamics={dynamics} meter={mpm.meter} />
                ) : (
                    <GenericInstructionView type={instruction.type} date={instruction.date} />
                )}
            </Paper>
        </Popper>
    );
};
