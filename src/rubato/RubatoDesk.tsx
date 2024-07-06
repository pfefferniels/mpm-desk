
import { Button, Stack } from "@mui/material"
import { ScopedTransformerViewProps } from "../DeskSwitch"
import { Part } from "../../../mpm-ts/lib"

export const RubatoDesk = ({ msm, part }: ScopedTransformerViewProps) => {
    const stretchX = 0.06
    const stretchY = 5
    const centerLineY = 50
    const height = 10

    const dates = []

    for (const [date, notes] of msm.asChords(part as Part)) {
        dates.push((
            <line
                data-date={date}
                className='shouldTick'
                strokeWidth={1}
                stroke='black'
                x1={date * stretchX}
                x2={date * stretchX}
                y1={centerLineY * stretchY}
                y2={(centerLineY + height) * stretchY}
                key={`shouldTick_${date}`} />
        ))

        for (const note of notes) {
            if (note.tickDate === undefined) continue

            dates.push((
                <line
                    key={`tickShift_${note["xml:id"]}`}
                    data-date={date}
                    stroke='blue'
                    strokeWidth={1}
                    x1={note.tickDate * stretchX}
                    x2={note.tickDate * stretchX}
                    y1={centerLineY * stretchY}
                    y2={(centerLineY - height) * stretchY} />
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
            {dates}
        </svg>
    </div>
)
}
