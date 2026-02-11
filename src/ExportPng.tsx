import { useMemo, useRef } from "react";
import { svgElementToPngBlob } from "./utils/exportPng";
import { IconButton, Tooltip } from "@mui/material";
import { Transform } from "@mui/icons-material";
import { getRange, MSM, Transformer } from "mpmify";
import { asPathD, negotiateIntensityCurve } from "./utils/intensityCurve";
import { useSymbolicZoom } from "./hooks/ZoomProvider";
import { BarLines } from "./transformer-stack/BarLines";

interface ExportPngProps {
    transformers: Transformer[];
    msm: MSM;
}

export function ExportPNG({ transformers, msm }: ExportPngProps) {
    const svgRef = useRef<SVGSVGElement | null>(null);

    const stretchX = useSymbolicZoom();
    const argumentations = Map.groupBy(transformers, t => t.argumentation);

    const maxDate = getRange(transformers, msm)?.to || 0;

    const exportPng = async () => {
        if (!svgRef.current) return;

        const blob = await svgElementToPngBlob(svgRef.current, {
            scale: 2,
            background: "#fff",
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "intensity-curve.png";
        a.click();
        URL.revokeObjectURL(url);
    };

    const scaled = negotiateIntensityCurve(argumentations, maxDate, msm);
    const path = useMemo(() => {
        return asPathD(scaled, stretchX, 300);
    }, [scaled, stretchX]);

    return (
        <>
            <div style={{ display: 'none' }}>
                <svg ref={svgRef} width={maxDate * stretchX} height="300" viewBox={`0 0 ${maxDate * stretchX} 300`}>
                    <BarLines
                        maxDate={maxDate}
                        stretchX={stretchX}
                        height={300}
                    />

                    <path
                        className="intensityCurve"
                        d={path}
                        fill="none"
                        stroke="#ac1e01ff"
                        strokeWidth={10}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                    />
                </svg>
            </div>

            <Tooltip title="Export as PNG">
                <IconButton onClick={exportPng}>
                    <Transform />
                </IconButton>
            </Tooltip>
        </>
    );
}
