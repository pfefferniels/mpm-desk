import { useMemo, useState, useEffect, RefObject } from "react";
import { Popper, Paper } from "@mui/material";
import type { PerformanceReader } from "../utils/mpm";
import { TempoInstructionView } from "./TempoInstructionView";
import { DynamicsInstructionView } from "./DynamicsInstructionView";
import { GenericInstructionView } from "./GenericInstructionView";

interface InstructionPopoverProps {
    mpm: PerformanceReader;
    activeSpanIds: Set<string>;
    svgRef: RefObject<SVGSVGElement | null>;
}

export const InstructionPopover = ({
    mpm,
    activeSpanIds,
    svgRef,
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

    useEffect(() => {
        if (activeSpanIds.size !== 1) {
            setAnchorPos(null);
        }
    }, [activeSpanIds]);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (activeSpanIds.size === 1) {
                setAnchorPos({ x: e.clientX, y: e.clientY });
            }
        };
        svgRef.current?.addEventListener("click", handler);
        const svg = svgRef.current;
        return () => svg?.removeEventListener("click", handler);
    }, [activeSpanIds, svgRef]);

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
