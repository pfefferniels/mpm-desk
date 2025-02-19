
import { Button, Stack } from "@mui/material"
import { ScopedTransformerViewProps } from "../DeskSwitch"
import { useState } from "react"
import { PartialBy } from "../utils"
import { Frame as FrameData, InsertRubato } from "mpmify/lib/transformers"
import { ZoomControls } from "../ZoomControls"
import { InstructionsRow } from "./InstructionsRow"
import { DatesRow } from "./DatesRow"


export const RubatoDesk = ({ msm, mpm, setMSM, setMPM, addTransformer, part }: ScopedTransformerViewProps) => {
    const [frames, setFrames] = useState<PartialBy<FrameData, 'length'>[]>([])
    const [stretchX, setStretchX] = useState(0.06)

    const svgWidth = 10000
    const svgHeight = 180
    const marginLeft = 200
    const stretchY = 5
    const height = 10

    const handleInsertRubato = () => {
        const insert = new InsertRubato({
            part,
            frames: frames.filter(f => f.length !== undefined) as FrameData[]
        })

        insert.transform(msm, mpm)
        insert.insertMetadata(mpm)

        setMSM(msm.clone())
        setMPM(mpm.clone())

        addTransformer(insert)
    }

    const handleInsertDelay = () => {
        // TODO
    }

    return (
        <div style={{ width: '80vw', overflow: 'scroll' }}>
            <ZoomControls
                stretchX={stretchX}
                setStretchX={setStretchX}
                rangeX={[0.01, 0.1]}
            />

            <Stack spacing={1} direction='row' sx={{ position: 'sticky', left: 0 }}>
                <Button variant='contained' onClick={handleInsertRubato}>Insert Rubatos</Button>
                <Button variant='contained' onClick={handleInsertDelay}>Insert Absolute Delay</Button>
                <Button variant='outlined' onClick={() => setFrames([])}>Clear frames</Button>
            </Stack>

            <h3 style={{ position: 'sticky', left: 0 }}>
                Tick Dates
            </h3>
            <svg
                width={svgWidth + marginLeft}
                height={svgHeight}
                viewBox={`${-marginLeft} 0 ${svgWidth + marginLeft} ${svgHeight}`}
            >
                <g transform={`translate(0, ${height * stretchY})`}>
                    <DatesRow
                        frames={frames}
                        setFrames={setFrames}
                        height={height * stretchY}
                        stretchX={stretchX}
                        width={svgWidth}
                        chords={msm.asChords(part)}
                    />
                </g>
            </svg>

            <h3 style={{ position: 'sticky', left: 0 }}>
                Instructions
            </h3>
            <svg
                width={svgWidth + marginLeft}
                height={svgHeight}
                viewBox={`${-marginLeft} 0 ${svgWidth + marginLeft} ${svgHeight}`}
            >
                <g transform={`translate(0, ${height * stretchY})`}>
                    <InstructionsRow
                        rubatos={mpm.getInstructions('rubato', part)}
                        notes={msm.notesInPart(part)}
                        stretchX={stretchX}
                        height={height * stretchY}
                    />
                </g>
            </svg>
        </div>
    )
}
