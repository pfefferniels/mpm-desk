import { useMemo, useState, useEffect, RefObject } from "react";
import { Popper, Paper } from "@mui/material";
import { MPM } from "mpm-ts";
import type { TempoWithEndDate, DynamicsWithEndDate } from "mpmify";
import { TempoInstructionView } from "./TempoInstructionView";
import { DynamicsInstructionView } from "./DynamicsInstructionView";
import { GenericInstructionView } from "./GenericInstructionView";

interface InstructionPopoverProps {
    mpm: MPM;
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

    const allInstructions = useMemo(() => mpm.getInstructions(), [mpm]);

    const instruction = useMemo(() => {
        if (!activeId) return null;
        return allInstructions.find(i => i['xml:id'] === activeId) ?? null;
    }, [activeId, allInstructions]);

    // For tempo instructions, build the sorted list with endDates
    const tempoData = useMemo(() => {
        if (!instruction || instruction.type !== 'tempo') return null;

        const tempoInstructions = mpm.getInstructions<{ type: 'tempo'; date: number; 'xml:id': string; bpm: number; beatLength: number; 'transition.to'?: number; 'meanTempoAt'?: number }>('tempo')
            .slice()
            .sort((a, b) => a.date - b.date);

        const temposWithEndDate: TempoWithEndDate[] = tempoInstructions
            .map((tempo, i) => {
                const next = tempoInstructions[i + 1];
                // Last instruction gets a synthetic endDate (one quarter note)
                const endDate = next ? next.date : tempo.date + tempo.beatLength * 720;
                if (endDate <= tempo.date) return null;
                return { ...tempo, endDate } as TempoWithEndDate;
            })
            .filter((t): t is TempoWithEndDate => t !== null);

        const focusedIndex = temposWithEndDate.findIndex(t => t['xml:id'] === instruction['xml:id']);
        if (focusedIndex === -1) return null;

        return { tempos: temposWithEndDate, focusedIndex };
    }, [instruction, mpm]);

    // For dynamics instructions, build the sorted list with endDates
    const dynamicsData = useMemo(() => {
        if (!instruction || instruction.type !== 'dynamics') return null;

        const dynamicsInstructions = mpm.getInstructions<{
            type: 'dynamics'; date: number; 'xml:id': string;
            volume: number | string; 'transition.to'?: number;
            protraction?: number; curvature?: number; beatLength: number;
        }>('dynamics')
            .slice()
            .sort((a, b) => a.date - b.date);

        const dynamicsWithEndDate: DynamicsWithEndDate[] = dynamicsInstructions
            .map((dyn, i) => {
                const next = dynamicsInstructions[i + 1];
                const endDate = next ? next.date : dyn.date + dyn.beatLength * 720;
                if (endDate <= dyn.date) return null;
                return { ...dyn, endDate } as DynamicsWithEndDate;
            })
            .filter((d): d is DynamicsWithEndDate => d !== null);

        const focusedIndex = dynamicsWithEndDate.findIndex(d => d['xml:id'] === instruction['xml:id']);
        if (focusedIndex === -1) return null;

        return { dynamics: dynamicsWithEndDate, focusedIndex };
    }, [instruction, mpm]);

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
                {tempoData ? (
                    <TempoInstructionView
                        tempos={tempoData.tempos}
                        focusedIndex={tempoData.focusedIndex}
                    />
                ) : dynamicsData ? (
                    <DynamicsInstructionView
                        dynamics={dynamicsData.dynamics}
                        focusedIndex={dynamicsData.focusedIndex}
                    />
                ) : (
                    <GenericInstructionView
                        type={instruction.type}
                        date={(instruction as { date: number }).date}
                    />
                )}
            </Paper>
        </Popper>
    );
};
