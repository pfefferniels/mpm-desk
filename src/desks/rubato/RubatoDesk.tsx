
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
import { ToolGroup } from "../../components/toolbar/ToolGroup"
import { ToolbarButton } from "../../components/toolbar/ToolbarButton"
import { Add, Clear, Merge } from "@mui/icons-material"
import { usePiano } from "../../performance/piano"

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
            if (!prev || prev.length !== undefined) return { date }
            // Either order of clicks marks the same stretch: the second one is an end, not a
            // direction, and a negative `@frameLength` is not a frame.
            return { date: Math.min(prev.date, date), length: Math.abs(date - prev.date) }
        })
    }

    const allRubatos = getInstructions(mpm, 'rubato', part)
    const chords = msm.in(part).chords()

    const rubatoElements = allRubatos.map(rubato => {
        const notes = msm.in(part).notes()
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

    // `needsChoice` holds this desk shut until a base text has been chosen, and choosing one is
    // what leaves a residual to plot: the type system catching up with that, not a case being
    // handled. Below the hooks, so the desk keeps calling the same ones either way.
    if (!residual) return null

    return (
        <div ref={scrollContainerRef} style={{ width: '100vw', overflow: 'scroll' }}>
            <DeskToolbar>
                <ToolGroup>
                    {/*
                        `disabled` is `handleInsertRubato`'s own `if (!frame || !frame.length)
                        return` made visible, which is the pattern this whole bar follows: where a
                        handler already knows it cannot run, the button says so before it is
                        pressed rather than swallowing the click.
                    */}
                    <ToolbarButton
                        primary
                        icon={<Add />}
                        label='Insert'
                        tooltip={!frame?.length
                            ? 'Mark a frame on the plot first — click a start date, then an end'
                            : 'Write a rubato over the marked frame'}
                        disabled={!frame?.length}
                        onClick={handleInsertRubato}
                    >
                        Insert
                    </ToolbarButton>
                    {/*
                        `handleInsertDelay` is an empty `// TODO`. Disabled rather than removed:
                        the button is the only record that an absolute delay is meant to live on
                        this desk, and deleting it would take the intention with it.
                    */}
                    <ToolbarButton
                        icon={<Add />}
                        label='Insert Absolute Delay'
                        tooltip='Not implemented yet'
                        disabled
                        onClick={handleInsertDelay}
                    >
                        Insert Absolute Delay
                    </ToolbarButton>
                    <ToolbarButton
                        icon={<Merge />}
                        label='Combine'
                        tooltip={allRubatos.length <= 1
                            ? 'Needs two or more rubatos to combine'
                            : 'Merge adjacent rubatos of similar intensity and compression'}
                        disabled={allRubatos.length <= 1}
                        onClick={handleCombine}
                    >
                        Combine
                    </ToolbarButton>
                    <ToolbarButton
                        icon={<Clear />}
                        label='Clear Frame'
                        tooltip={!frame
                            ? 'No frame marked'
                            : 'Discard the marked frame'}
                        disabled={!frame}
                        onClick={() => setFrame(undefined)}
                    >
                        Clear Frame
                    </ToolbarButton>
                </ToolGroup>
            </DeskToolbar>

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
                        onPickDate={addMarker}
                        instructions={rubatoElements}
                    />
                </g>
            </svg>
        </div>
    )
}
