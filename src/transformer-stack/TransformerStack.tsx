import { Card } from "@mui/material";
import { Argumentation, getRange, Transformer } from "mpmify/lib/transformers/Transformer";
import { useCallback, useMemo, useState } from "react";
import { useSymbolicZoom } from "../hooks/ZoomProvider";
import { MSM } from "mpmify";
import { applyWedgeLevelGeometry, assignWedgeLevels, computeCurvePoints, computeWedgeModels } from "./WedgeModel";
import { Wedge } from "./Wedge";
import { useSvgDnd } from "./svg-dnd";
import { Ground } from "./Ground";
import { v4 } from "uuid";
import { asPathD, negotiateIntensityCurve } from "../utils/intensityCurve";
import { useSelection } from "../hooks/SelectionProvider";

interface TransformerStackProps {
    transformers: Transformer[];
    setTransformers: (transformers: Transformer[]) => void;
    msm: MSM;
    onRemove: (transformer: Transformer) => void;
    onPlay: (mpmIds: string[]) => void;
    onStop: () => void;
}

export const TransformerStack = ({
    transformers,
    setTransformers,
    msm,
    onPlay,
    onStop,
}: TransformerStackProps) => {
    const { svgRef, svgHandlers } = useSvgDnd();
    const [hoveredWedgeId, setHoveredWedgeId] = useState<string | null>(null);
    const { activeTransformer } = useSelection();

    const stretchX = useSymbolicZoom();
    const argumentations = Map.groupBy(transformers, t => t.argumentation);

    const maxDate = getRange(transformers, msm)?.to || 0;
    const maxX = maxDate * stretchX;

    const scaled = negotiateIntensityCurve(argumentations, maxDate, msm);

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
                        motivation: 'unknown',
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
            onStop();
            return;
        }

        const wedgeTransformers = transformers.filter(t => t.argumentation?.id === wedgeId);
        const mpmIds = wedgeTransformers.flatMap(t => t.created);
        if (mpmIds.length === 0) return;

        onPlay(mpmIds);
    }, [transformers, onPlay, onStop]);

    const totalHeight = 300;

    const scene = useMemo(() => {
        const curvePoints = computeCurvePoints({
            scaled,
            stretchX,
            totalHeight,
            padTop: 8,
            padBottom: 8
        });

        let wedges = computeWedgeModels({
            argumentations,
            msm,
            curvePoints,
            baseAmplitude: 30,
            minWidthPx: 32,
        });

        wedges = assignWedgeLevels(wedges, "above");
        wedges = assignWedgeLevels(wedges, "below");

        const gapInPixels = 40 * (stretchX + 1);

        wedges = applyWedgeLevelGeometry(wedges, curvePoints, {
            baseAmplitude: gapInPixels / 3,
            levelSpacing: gapInPixels,
            level0Gap: 1,
        });

        const width = maxX;
        const height = totalHeight;

        return { curvePoints, wedges, width, height };
    }, [scaled, stretchX, totalHeight, argumentations, msm, maxX]);

    const curvePathD = useMemo(() => {
        return asPathD(scaled, stretchX, totalHeight);
    }, [scaled, stretchX, totalHeight]);

    if (transformers.length === 0) return null;

    return (
        <Card
            style={{
                overflow: "scroll",
                position: "relative",
                height: "300px",
                width: "100vw",
                borderTop: "0.5px solid gray"
            }}
        >
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
                            ...w,
                            isHovered: hoveredWedgeId === w.argumentationId,
                            containsActive: w.transformers.some(t => t.id === activeTransformer?.id),
                        }))
                        .sort((a, b) => {
                            const aExpanded = a.isHovered || a.containsActive;
                            const bExpanded = b.isHovered || b.containsActive;
                            if (aExpanded === bExpanded) return 0;
                            return aExpanded ? 1 : -1; // expanded wedges render last (on top)
                        })
                        .map(w => (
                            <Wedge
                                key={`wedge_${w.argumentationId}`}
                                wedge={w}
                                mergeInto={mergeInto}
                                isHovered={w.isHovered}
                                onHoverChange={(hovered) => handleWedgeHover(hovered ? w.argumentationId : null)}
                            />
                        ))}
                </svg>
            </div>
        </Card>
    );
};
