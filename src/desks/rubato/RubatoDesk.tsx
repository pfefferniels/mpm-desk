
import { Button } from "@mui/material"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { useState } from "react"
import { useScrollRegistration } from "../../hooks/useScrollRegistration"
import { CombineAdjacentRubatos } from "../../fitting/transformers/rubato/CombineAdjacentRubatos"
import { InsertRubato } from "../../fitting/transformers/rubato/InsertRubato"
import type { InsertRubatoOptions } from "../../fitting/transformers/rubato/InsertRubato"
import { getInstructions } from "../../fitting/instructions/index"
import { RubatoInstruction } from "./RubatoInstruction"
import { DatesRow, Frame } from "./DatesRow"
import { useSymbolicZoom } from "../../hooks/ZoomProvider"
import { useCallSelection } from "../../hooks/CallSelection"
import { DeskToolbar } from "../../components/DeskToolbar"
import { Ribbon } from "../../components/Ribbon"
import { Add } from "@mui/icons-material"
import { usePiano } from "react-pianosound"

export const RubatoDesk = ({ msm, mpm, residual, addTransformer, part }: ScopedTransformerViewProps<InsertRubato | CombineAdjacentRubatos>) => {
    const { activeElements, setActiveElement } = useCallSelection();
    const { play, stop } = usePiano()
    const [frame, setFrame] = useState<Frame>()
    const stretchX = useSymbolicZoom()

    const scrollContainerRef = useScrollRegistration('rubato-desk', 'symbolic')

    const svgWidth = msm.end * stretchX
    const svgHeight = 200
    const marginLeft = 200
    const stretchY = 5
    const height = 20

    const handleInsertRubato = () => {
        if (!frame || !frame.length) return

        addTransformer(new InsertRubato({
            scope: part,
            ...(frame as Omit<InsertRubatoOptions, 'scope'>)
        }))
    }

    const handleCombine = () => {
        addTransformer(new CombineAdjacentRubatos({
            intensityTolerance: 0.2,
            compressionTolerance: 0.2,
            scope: part
        }))
    }

    const handleInsertDelay = () => {
        // TODO
    }

    const addMarker = (date: number) => {
        setFrame(prev => {
            if (!prev || (prev.date && prev.length)) return { date }
            return { ...prev, length: date - prev.date }
        })
    }

    const allRubatos = getInstructions(mpm, 'rubato', part)
    const chords = msm.asChords(part)

    const rubatoElements = allRubatos.map(rubato => {
        const notes = msm.notesInPart(part)
        // `@frameLength` is optional on a `<rubato>`: an instruction that carries no frame
        // inherits one from the `rubatoDef` it names, and the fitting pipeline models no defs,
        // so nothing is warped under one. Reading absence as a zero-length frame is what that
        // amounts to on the desk — the instruction draws where it stands and covers no note.
        const frameLength = rubato.frameLength ?? 0
        const affected = new Set(
            notes
                .filter(note => note.date >= rubato.date && note.date < rubato.date + frameLength)
                .map(note => note.date)
        )

        // Without an `@xml:id` a rubato cannot be traced back to the call that wrote it, so it
        // draws but neither lights up nor selects.
        const id = rubato.id

        return (
            <RubatoInstruction
                active={id !== undefined && activeElements.includes(id)}
                key={`rubatoInstruction_${rubato.date}`}
                rubato={rubato}
                onsetDates={Array.from(affected)}
                stretchX={stretchX}
                height={height * stretchY}
                chords={chords}
                play={play}
                stop={stop}
                onClick={() => {
                    if (id !== undefined) setActiveElement(id)
                }}
            />
        )
    })

    return (
        <div ref={scrollContainerRef} style={{ width: '100vw', overflow: 'scroll' }}>
            <DeskToolbar>
                <Ribbon title='Rubato'>
                    <Button
                        size='small'
                        variant='outlined'
                        onClick={handleInsertRubato}
                        startIcon={<Add />}
                    >
                        Insert
                    </Button>
                    <Button
                        variant='outlined'
                        size='small'
                        onClick={handleInsertDelay}
                        startIcon={<Add />}
                    >
                        Insert Absolute Delay
                    </Button>

                    <Button
                        variant='outlined'
                        onClick={handleCombine}
                        disabled={allRubatos.length <= 1}
                    >
                        Combine
                    </Button>

                    <Button
                        variant='outlined'
                        onClick={() => setFrame(undefined)}
                    >
                        Clear Frame
                    </Button>
                </Ribbon>
            </DeskToolbar>

            <h3 style={{ position: 'sticky', left: 0 }}>
                Tick Dates
            </h3>
            <svg
                width={svgWidth + marginLeft}
                height={svgHeight * 2}
                viewBox={`${-marginLeft} 0 ${svgWidth + marginLeft} ${svgHeight}`}
            >
                <g transform={`translate(0, ${0 * stretchY})`}>
                    <DatesRow
                        frame={frame}
                        height={height * stretchY}
                        stretchX={stretchX}
                        width={svgWidth}
                        chords={chords}
                        residual={residual}
                        onClickTick={addMarker}
                        instructions={rubatoElements}
                    />
                </g>
            </svg>
        </div>
    )
}
