import { TempoPoint } from "../TempoDesk"

interface SyntheticLineProps {
    points: TempoPoint[]
    stretchX: number 
    stretchY: number
}

export const SyntheticLine = ({ points, stretchX, stretchY }: SyntheticLineProps) => {
    return (
        <>
            {points.map(p => {
                return (
                    <circle
                        cx={p.date * stretchX}
                        cy={p.bpm * -stretchY}
                        r={1}
                        fill='gray' />
                )
            })}
        </>
    )
}