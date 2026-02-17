import { Card } from "@mui/material";
import { Argumentation, getRange, Transformer } from "mpmify/lib/transformers/Transformer";
import { useCallback, useMemo, useState } from "react";
import { useSymbolicZoom } from "../hooks/ZoomProvider";
import { useScrollSync } from "../hooks/ScrollSyncProvider";
import { MPM, MSM } from "mpmify";
import { applyWedgeLevelGeometry, assignWedgeLevels, computeCurvePoints, computeWedgeModels } from "./WedgeModel";
import { Wedge } from "./Wedge";
import { useSvgDnd } from "./svg-dnd";
import { Ground } from "./Ground";
import { v4 } from "uuid";
import { asPathD, negotiateIntensityCurve } from "../utils/intensityCurve";
import { useSelection } from "../hooks/SelectionProvider";
import { usePlayback } from "../hooks/PlaybackProvider";
import { DragLayer } from "./DragLayer";
import { BarLines } from "./BarLines";
import { ExportPNG } from "../ExportPng";

interface TransformerStackProps {
    transformers: Transformer[];
    setTransformers: (transformers: Transformer[]) => void;
    msm: MSM;
    mpm: MPM;
}

export const TransformerStack = ({
    transformers,
    setTransformers,
    msm,
    mpm,
}: TransformerStackProps) => {
    const { play, stop } = usePlayback();
    const { svgRef, svgHandlers } = useSvgDnd();
    const { activeTransformerIds, setActiveTransformerIds, removeActiveTransformers } = useSelection();
    const stretchX = useSymbolicZoom();

    const [hoveredWedgeId, setHoveredWedgeId] = useState<string | null>(null);

    // Scroll sync - use callback ref to register when element mounts
    const { register, unregister } = useScrollSync();
    const scrollContainerRef = useCallback((element: HTMLDivElement | null) => {
        if (element) {
            register('transformer-stack', element, 'symbolic');
        } else {
            unregister('transformer-stack');
        }
    }, [register, unregister]);

    const argumentations = useMemo(() =>
        Map.groupBy(transformers, t => t.argumentation),
        [transformers]
    );

    const elementTypesByTransformer = useMemo(() => {
        const allInstructions = mpm.getInstructions();
        const idToType = new Map(allInstructions.map(i => [i['xml:id'], i.type]));
        return new Map(
            transformers.map(t => [
                t.id,
                [...new Set(t.created.map(id => idToType.get(id)).filter(Boolean))] as string[]
            ])
        );
    }, [mpm, transformers]);

    const maxDate = getRange(transformers, msm)?.to || 0;
    const maxX = maxDate * stretchX;

    const scaled = useMemo(() =>
        negotiateIntensityCurve(argumentations, maxDate, msm),
        [argumentations, maxDate, msm]
    );

    const mergeInto = useCallback(
        (transformerId: string, argumentation: Argumentation) => {
            const transformer = transformers.find(t => t.id === transformerId);
            if (!transformer) return;
            transformer.argumentation = argumentation;
            setTransformers([...transformers]);
        },
        [transformers, setTransformers]
    );

    const extractTransformer = useCallback(
        (transformerId: string) => {
            const transformer = transformers.find(t => t.id === transformerId);
            if (transformer) {
                transformer.argumentation = {
                    id: v4(),
                    conclusion: {
                        certainty: 'plausible',
                        motivation: 'calm',
                        id: v4()
                    },
                    type: 'simpleArgumentation'
                };
                setTransformers([...transformers]);
            }
        }, [transformers, setTransformers])

    const handleWedgeHover = useCallback((wedgeId: string | null) => {
        setHoveredWedgeId(wedgeId);

        if (!wedgeId) {
            stop();
            return;
        }

        const wedgeTransformers = transformers.filter(t => t.argumentation?.id === wedgeId);
        const mpmIds = wedgeTransformers.flatMap(t => t.created);
        if (mpmIds.length === 0) return;

        play({ mpmIds, isolate: true });
    }, [transformers, play, stop]);

    // Callback for when argumentation is changed in the dialog
    // Creates new array reference to trigger re-render and re-memoization
    const handleArgumentationChange = useCallback(() => {
        setTransformers([...transformers]);
    }, [transformers, setTransformers]);

    const totalHeight = 300;
    const basePadding = 8;

    const scene = useMemo(() => {
        // STEP 1: Compute preliminary curve just for X positions (Y doesn't matter yet)
        const prelimCurvePoints = computeCurvePoints({
            scaled,
            stretchX,
            totalHeight,
            padTop: basePadding,
            padBottom: basePadding
        });

        // STEP 2: Build wedges and assign levels (only uses X intervals)
        let wedges = computeWedgeModels({
            argumentations,
            msm,
            curvePoints: prelimCurvePoints,
            baseAmplitude: 30,
            minWidthPx: 32,
        });

        wedges = assignWedgeLevels(wedges, "above");
        wedges = assignWedgeLevels(wedges, "below");

        // STEP 3: Calculate required vertical space for wedges
        const maxLevelAbove = Math.max(0, ...wedges.filter(w => w.side === "above").map(w => w.level));
        const maxLevelBelow = Math.max(0, ...wedges.filter(w => w.side === "below").map(w => w.level));

        // Base gap calculation - scale with zoom but keep reasonable bounds
        const desiredGap = Math.min(40, 20 + 15 * stretchX);

        // Space needed for wedges on each side: (maxLevel + 1) * gap
        // +1 because level 0 also needs space
        const spaceAbove = (maxLevelAbove + 1) * desiredGap;
        const spaceBelow = (maxLevelBelow + 1) * desiredGap;

        // Calculate padding to reserve space for wedges
        // Ensure minimum padding for curve visibility
        const padTop = Math.max(basePadding, spaceAbove + basePadding);
        const padBottom = Math.max(basePadding, spaceBelow + basePadding);

        // Check if we have enough room - if not, scale down the gap
        const availableForCurve = totalHeight - padTop - padBottom;
        const minCurveHeight = 100; // Minimum height for the curve to remain visible

        let gapInPixels = desiredGap;
        if (availableForCurve < minCurveHeight) {
            // Scale down gap to fit everything
            const totalLevels = maxLevelAbove + maxLevelBelow + 2; // +2 for level 0 on each side
            const maxTotalSpace = totalHeight - minCurveHeight - 2 * basePadding;
            gapInPixels = Math.max(10, maxTotalSpace / totalLevels);
        }

        // Recalculate padding with final gap
        const finalSpaceAbove = (maxLevelAbove + 1) * gapInPixels;
        const finalSpaceBelow = (maxLevelBelow + 1) * gapInPixels;
        const finalPadTop = basePadding + finalSpaceAbove;
        const finalPadBottom = basePadding + finalSpaceBelow;

        // STEP 4: Recompute curve with proper padding
        const curvePoints = computeCurvePoints({
            scaled,
            stretchX,
            totalHeight,
            padTop: finalPadTop,
            padBottom: finalPadBottom
        });

        // STEP 5: Rebuild wedges with final curve positions and apply geometry
        wedges = computeWedgeModels({
            argumentations,
            msm,
            curvePoints,
            baseAmplitude: gapInPixels,
            minWidthPx: 32,
        });

        wedges = assignWedgeLevels(wedges, "above");
        wedges = assignWedgeLevels(wedges, "below");

        wedges = applyWedgeLevelGeometry(wedges, curvePoints, {
            baseAmplitude: gapInPixels,
            levelSpacing: gapInPixels,
        });

        const width = maxX;
        const height = totalHeight;

        return { curvePoints, wedges, width, height, padTop: finalPadTop, padBottom: finalPadBottom };
    }, [scaled, stretchX, totalHeight, argumentations, msm, maxX]);

    const curvePathD = useMemo(() => {
        // Use same padding as computeCurvePoints to ensure wedge bases align with rendered curve
        return asPathD(scaled, stretchX, totalHeight, scene.padTop, scene.padBottom);
    }, [scaled, stretchX, totalHeight, scene.padTop, scene.padBottom]);

    if (transformers.length === 0) return null;

    return (
        <Card
            ref={scrollContainerRef}
            tabIndex={-1}
            onMouseDown={(e) => e.currentTarget.focus()}
            onKeyDown={(e) => {
                if (e.key === 'Backspace' && activeTransformerIds.size > 0) {
                    removeActiveTransformers();
                }
            }}
            style={{
                overflow: "scroll",
                position: "relative",
                height: "300px",
                width: "100vw",
                borderTop: "0.5px solid gray",
                outline: "none",
            }}
        >
            <div style={{
                position: "sticky",
                left: 0,
                width: "100%",
                height: 0,
                zIndex: 1,
                pointerEvents: "none",
            }}>
                <div style={{
                    position: "absolute",
                    top: 4,
                    left: 4,
                    pointerEvents: "auto",
                }}>
                    <ExportPNG
                        curvePathD={curvePathD}
                        maxDate={maxDate}
                        stretchX={stretchX}
                    />
                </div>
            </div>
            <div style={{ position: "relative", width: maxX, height: totalHeight }}>
                <svg
                    width={maxX}
                    height={totalHeight}
                    ref={svgRef}
                    style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                    }}
                    viewBox={`0 0 ${maxX} ${totalHeight}`}
                    preserveAspectRatio="none"
                    {...svgHandlers}
                >
                    <Ground
                        width={scene.width}
                        height={scene.height}
                        extractTransformer={extractTransformer}
                        onClearSelection={() => {
                            setActiveTransformerIds(new Set());
                            // Clear URL hash
                            const currentHash = window.location.hash.slice(1);
                            if (currentHash) {
                                history.pushState(null, '', window.location.pathname + window.location.search);
                            }
                        }}
                    />

                    <BarLines
                        maxDate={maxDate}
                        stretchX={stretchX}
                        height={totalHeight}
                    />

                    <path
                        className="intensityCurve"
                        d={curvePathD}
                        fill="none"
                        stroke="#ac1e01ff"
                        strokeWidth={5}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                    />

                    {scene.wedges
                        .map(w => ({
                            wedge: w,
                            isHovered: hoveredWedgeId === w.argumentationId,
                            containsActive: w.transformers.some(t => activeTransformerIds.has(t.id)),
                        }))
                        .sort((a, b) => {
                            const aExpanded = a.isHovered || a.containsActive;
                            const bExpanded = b.isHovered || b.containsActive;
                            if (aExpanded === bExpanded) return 0;
                            return aExpanded ? 1 : -1; // expanded wedges render last (on top)
                        })
                        .map(({ wedge, isHovered }) => (
                            <Wedge
                                key={`wedge_${wedge.argumentationId}`}
                                wedge={wedge}
                                mergeInto={mergeInto}
                                isHovered={isHovered}
                                hoveredWedgeId={hoveredWedgeId}
                                onHoverChange={handleWedgeHover}
                                onArgumentationChange={handleArgumentationChange}
                                elementTypesByTransformer={elementTypesByTransformer}
                            />
                        ))}

                    <DragLayer transformers={transformers} />
                </svg>
            </div>
        </Card>
    );
};
