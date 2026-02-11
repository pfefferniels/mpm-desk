
import { Button } from "@mui/material"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { useCallback, useState } from "react"
import { useScrollSync } from "../hooks/ScrollSyncProvider"
import { CombineAdjacentRubatos, InsertRubato, InsertRubatoOptions } from "mpmify/lib/transformers"
import { RubatoInstruction } from "./RubatoInstruction"
import { DatesRow, Frame } from "./DatesRow"
import { Rubato } from "../../../mpm-ts/lib"
import { useSymbolicZoom } from "../hooks/ZoomProvider"
import { useSelection } from "../hooks/SelectionProvider"
import { createPortal } from "react-dom"
import { Ribbon } from "../Ribbon"
import { Add } from "@mui/icons-material"
import { usePiano } from "react-pianosound"

export const RubatoDesk = ({ msm, mpm, addTransformer, part, appBarRef }: ScopedTransformerViewProps<InsertRubato | CombineAdjacentRubatos>) => {
    const { activeElements, setActiveElement } = useSelection();
    const { play, stop } = usePiano()
    const [frame, setFrame] = useState<Frame>()
    const stretchX = useSymbolicZoom()

    // Scroll sync - use callback ref to register when element mounts
    const { register, unregister } = useScrollSync();
    const scrollContainerRef = useCallback((element: HTMLDivElement | null) => {
        if (element) {
            register('rubato-desk', element, 'symbolic');
        } else {
            unregister('rubato-desk');
        }
    }, [register, unregister]);

    const svgWidth = 10000
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

    const allRubatos = mpm.getInstructions<Rubato>('rubato', part)
    const chords = msm.asChords(part)

    const rubatoElements = allRubatos.map(rubato => {
        const notes = msm.notesInPart(part)
        const affected = new Set(
            notes
                .filter(note => note.date >= rubato.date && note.date < rubato.date + rubato.frameLength)
                .map(note => note.date)
        )

        return (
            <RubatoInstruction
                active={activeElements.includes(rubato["xml:id"])}
                key={`rubatoInstruction_${rubato.date}`}
                rubato={rubato}
                onsetDates={Array.from(affected)}
                stretchX={stretchX}
                height={height * stretchY}
                chords={chords}
                play={play}
                stop={stop}
                onClick={() => {
                    setActiveElement(rubato["xml:id"])
                }}
            />
        )
    })

    return (
        <div ref={scrollContainerRef} style={{ width: '100vw', overflow: 'scroll' }}>
            {appBarRef && createPortal((
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
            ), appBarRef?.current ?? document.body)}

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
                        onClickTick={addMarker}
                        instructions={rubatoElements}
                    />
                </g>
            </svg>
        </div>
    )
}
