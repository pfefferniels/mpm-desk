
import { Button, Stack } from "@mui/material"
import { ScopedTransformerViewProps } from "../DeskSwitch"
import { Part } from "../../../mpm-ts/lib"

export const AccentuationDesk = ({ msm, part }: ScopedTransformerViewProps) => {
    const stretchX = 0.03
    const stretchY = 5

    const centerLineY = 50

    const volumes = []
    for (const [date, notes] of msm.asChords(part as Part)) {
        for (const note of notes) {
            if (note.relativeVolume === undefined) continue 

            volumes.push((
                <circle
                    data-date={date}
                    r={2}
                    fill='blue'
                    cx={date * stretchX}
                    cy={(centerLineY - note.relativeVolume) * stretchY}
                    key={`accentuation_${note["xml:id"]}`} />
            ))
        }
    }
    return (
        <div style={{ width: '80vw', overflow: 'scroll' }}>
            <Stack spacing={1} direction='row'>
                <Button>Insert into MPM</Button>
            </Stack>

            <svg width={10000} height={600}>
                <line
                    stroke='black'
                    strokeWidth={1}
                    x1={0}
                    x2={10000}
                    y1={centerLineY * stretchY}
                    y2={centerLineY * stretchY} />
                {volumes}
            </svg>
        </div>
    )
}
