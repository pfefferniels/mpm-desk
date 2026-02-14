import { useRef } from "react";
import { svgElementToPngBlob } from "./utils/exportPng";
import { IconButton, Tooltip } from "@mui/material";
import { Download } from "@mui/icons-material";
import { BarLines } from "./transformer-stack/BarLines";

interface ExportPngProps {
    curvePathD: string;
    maxDate: number;
    stretchX: number;
}

export function ExportPNG({ curvePathD, maxDate, stretchX }: ExportPngProps) {
    const svgRef = useRef<SVGSVGElement | null>(null);

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
                        d={curvePathD}
                        fill="none"
                        stroke="#ac1e01ff"
                        strokeWidth={10}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                    />
                </svg>
            </div>

            <Tooltip title="Export as PNG">
                <IconButton onClick={exportPng} size="small">
                    <Download />
                </IconButton>
            </Tooltip>
        </>
    );
}
