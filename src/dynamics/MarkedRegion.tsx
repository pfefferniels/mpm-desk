import { RefObject, useEffect, useState } from "react"
import { useSymbolicZoom } from "../hooks/ZoomProvider"

interface MarkedRegionProps {
    from?: number
    to?: number
    svgRef: RefObject<SVGElement>
}

export const MarkedRegion = ({ from, to, svgRef }: MarkedRegionProps) => {
    const [mouseX, setMouseX] = useState<number>(0)
    const stretchX = useSymbolicZoom()

    useEffect(() => {
        if (!svgRef.current) return 

        const svg = svgRef.current
        const handleMouseMove = (e: MouseEvent) => {
            const rect = svg.getBoundingClientRect()
            setMouseX((e.clientX - rect.left) / stretchX)
        }
        svg.addEventListener('mousemove', handleMouseMove)
        return () => {
            svg.removeEventListener('mousemove', handleMouseMove)
        }
    }, [svgRef, stretchX])

    const newTo = to || mouseX

    if (!from) return null
    if (newTo <= from) return null

    return (
        <rect
            x={from * stretchX}
            y={300}
            width={(newTo - from) * stretchX}
            height={600}
        />
    )
}
