import type { ChordMap } from "../../fitting/alignment"
import type { InsertRubatoOptions } from "../../fitting/transformers/rubato/InsertRubato"
import type { Residual } from "../../fitting/residual"
import { asMIDI, PartialBy } from "../../utils/utils"
import { usePiano } from "react-pianosound"
import { useNotes } from "../../hooks/NotesProvider"
import { type JSX, useState } from "react"
import { FrameBox } from "./Frame"

export type Frame = PartialBy<Omit<InsertRubatoOptions, 'scope'>, 'length'>

interface DatesRowProps {
    stretchX: number
    height: number
    width: number
    chords: ChordMap
    /**
     * Where the recording put each note on the score grid, with rubato held out — the row's
     * whole subject, derived per fit rather than carried on the note.
     */
    residual: Residual
    frame?: Frame
    onClickTick: (date: number) => void
    instructions: JSX.Element[]
}

export const DatesRow = ({ stretchX, height, width, chords, residual, frame, onClickTick, instructions }: DatesRowProps) => {
    const { play, stop } = usePiano()
    const { slice } = useNotes()

    const [hovered, setHovered] = useState<number>()

    const dates = []

    const playFrame = (frame: Frame) => {
        if (!frame.length) return
        const notes = slice(frame.date, frame.date + frame.length)
        const midi = asMIDI(notes)
        if (!midi) return

        stop()
        play(midi)
    }

    const handleMouseOver = (date: number) => {
        setHovered(date)
        const notes = slice(date, date + 1)
        const midi = asMIDI(notes)
        if (midi) {
            stop()
            play(midi)
        }
    }

    const handleMouseOut = () => {
        setHovered(undefined)
        stop()
    }

    for (const [date, notes] of chords) {
        // `undefined` where the MPM cannot place the note yet — no `<tempo>` covers it. The
        // row draws the distance from the score date to the recorded one, and a note with no
        // recorded position on the grid has no such distance, so it gets no line at all.
        const firstNote = notes[0]
        const tickDate = firstNote === undefined ? undefined : residual.of(firstNote)?.tickDate
        if (tickDate === undefined) continue


        dates.push((
            <>
                {(hovered === date) && (
                    <text
                        key={`dateLabel_${date}`}
                        x={date * stretchX}
                        y={-5}
                        fontSize={12}
                        textAnchor="middle"
                    >
                        {date}
                    </text>
                )}
                {(tickDate - date) !== 0 && (
                    <text
                        key={`diff_${date}`}
                        x={((date + tickDate) / 2) * stretchX}
                        y={height + 15}
                        fontSize={12}
                        textAnchor="middle"
                        fill="black"
                    >
                        {tickDate - date > 0 && '+'}{(tickDate - date).toFixed(0)}
                    </text>
                )}

                <path
                    data-date={date}
                    className="shouldTick"
                    strokeWidth={hovered === date ? 3 : 2}
                    stroke="gray"
                    fill="none"
                    d={`
                        M ${date * stretchX},0
                        L ${date * stretchX},${height * 0.7}
                        L ${tickDate * stretchX},${height * 0.8}
                        L ${tickDate * stretchX},${height}
                    `}
                    key={`shouldTick_${date}`}
                    onMouseOver={() => handleMouseOver(date)}
                    onMouseOut={handleMouseOut}
                    onClick={() => onClickTick(date)}
                />
            </>
        ))
    }

    const boxes = frame && (
        <FrameBox
            key={`frame_${frame.date}_${frame.length}`}
            frame={frame}
            stretchX={stretchX}
            height={height}
            onRemove={() => {}}
            onClick={() => {
                if (frame.length) playFrame(frame)
            }}
        />
    )

    return (
        <>
            <g>
                {/* top and bottom border lines */}
                <line
                    stroke="black"
                    strokeWidth={1}
                    x1={0}
                    x2={width}
                    y1={height * 0.7}
                    y2={height * 0.7}
                />
                <line
                    stroke="black"
                    strokeWidth={1}
                    x1={0}
                    x2={width}
                    y1={height * 0.8}
                    y2={height * 0.8}
                />
                <line
                    stroke="black"
                    strokeWidth={1}
                    x1={0}
                    x2={width}
                    y1={height}
                    y2={height}
                />

                {/* eighth‐note ticks every 360 ticks */}
                {Array.from({
                    length: Math.floor(width / (360 * stretchX)) + 1
                }).map((_, i) => {
                    const x = i * 360 * stretchX;
                    return (
                        <g
                            key={`tick-${i}`}
                            onClick={() => onClickTick(x / stretchX)}
                        >
                            <line
                                x1={x}
                                x2={x}
                                y1={0}
                                y2={5}
                                stroke="black"
                                strokeWidth={1}
                            />
                            <line
                                x1={x}
                                x2={x}
                                y1={height}
                                y2={height - 5}
                                stroke="black"
                                strokeWidth={1}
                            />
                        </g>
                    )
                })}

                {boxes}
                {dates}
            </g>
            <g transform={`translate(0, ${height + 30})`}>
                {instructions}
            </g>
        </>
    )
}
