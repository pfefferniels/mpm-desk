import type { ChordMap } from "../../fitting/alignment"
import type { InsertRubatoOptions } from "../../fitting/transformers/rubato/InsertRubato"
import type { Residual } from "../../fitting/residual"
import { asMIDI, PartialBy } from "../../utils/utils"
import { svgPoint } from "../../utils/svgPoint"
import { beatLengthInTicks } from "../../fitting/ppq"
import { usePiano } from "../../performance/piano"
import { useNotes } from "../../hooks/NotesProvider"
import { Fragment, type JSX, type MouseEvent, useState } from "react"
import { FrameBox, PendingFrame } from "./Frame"

export type Frame = PartialBy<Omit<InsertRubatoOptions, 'scope'>, 'length'>

/** The grid the row is ruled in, and the dates a click can land on where no note does. */
const GRID = beatLengthInTicks(1 / 8)

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
    onPickDate: (date: number) => void
    instructions: JSX.Element[]
}

export const DatesRow = ({ stretchX, height, width, chords, residual, frame, onPickDate, instructions }: DatesRowProps) => {
    const { play, stop } = usePiano()
    const { slice } = useNotes()

    const [cursor, setCursor] = useState<number>()

    const onsets = Array.from(chords, ([date, notes]) => {
        // `undefined` where the MPM cannot place the note yet — no `<tempo>` covers it. The
        // row draws the distance from the score date to the recorded one, and a note with no
        // recorded position on the grid has no such distance, so it gets no line at all.
        const firstNote = notes[0]
        const tickDate = firstNote === undefined ? undefined : residual.of(firstNote)?.tickDate
        return tickDate === undefined ? undefined : { date, tickDate }
    }).filter(onset => onset !== undefined)

    const gridDates = Array.from(
        { length: Math.floor(width / (GRID * stretchX)) + 1 },
        (_, i) => i * GRID
    )

    /**
     * The date a gesture at `svgX` means: the nearest of everything the row draws.
     *
     * Both sets of marks are candidates, so a date with nothing sounding on it is as easy to
     * hit as one with a note on it. Hitting a grid line by its own geometry meant landing on a
     * mark one pixel wide and five tall.
     */
    const nearestDate = (svgX: number) => {
        const target = svgX / stretchX
        return [...onsets.map(onset => onset.date), ...gridDates].reduce(
            (best, date) => Math.abs(date - target) < Math.abs(best - target) ? date : best
        )
    }

    const dateUnder = (event: MouseEvent<SVGGElement>) => {
        const svg = event.currentTarget.ownerSVGElement
        if (!svg) return undefined
        const point = svgPoint(svg, event.clientX, event.clientY)
        return point === null ? undefined : nearestDate(point.x)
    }

    const playFrame = (frame: Frame) => {
        if (!frame.length) return
        const notes = slice(frame.date, frame.date + frame.length)
        const midi = asMIDI(notes)
        if (!midi) return

        stop()
        play(midi)
    }

    const handleMouseMove = (event: MouseEvent<SVGGElement>) => {
        const date = dateUnder(event)
        if (date === undefined || date === cursor) return

        setCursor(date)
        stop()
        const midi = asMIDI(slice(date, date + 1))
        if (midi) play(midi)
    }

    const handleMouseLeave = () => {
        setCursor(undefined)
        stop()
    }

    const handleClick = (event: MouseEvent<SVGGElement>) => {
        const date = dateUnder(event)
        if (date !== undefined) onPickDate(date)
    }

    const dates = onsets.map(({ date, tickDate }) => (
        <Fragment key={`date_${date}`}>
            {(tickDate - date) !== 0 && (
                <text
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
                strokeWidth={cursor === date ? 3 : 2}
                stroke="gray"
                fill="none"
                d={`
                    M ${date * stretchX},0
                    L ${date * stretchX},${height * 0.7}
                    L ${tickDate * stretchX},${height * 0.8}
                    L ${tickDate * stretchX},${height}
                `}
            />
        </Fragment>
    ))

    const boxes = frame && (
        <FrameBox
            key={`frame_${frame.date}_${frame.length}`}
            frame={frame}
            stretchX={stretchX}
            height={height}
            onClick={() => {
                if (frame.length) playFrame(frame)
            }}
        />
    )

    // A frame with no length yet is one waiting for its second click, and that is the state the
    // preview belongs to.
    const anchor = frame && frame.length === undefined ? frame.date : undefined

    return (
        <>
            <g
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onClick={handleClick}
            >
                {/*
                    The row's whole area is the target. Where the click lands is answered by
                    `nearestDate` rather than by which mark happens to be under the pointer, so
                    the marks themselves need no hit geometry — but a <g> has none of its own,
                    and the space between them has to be hit for that to be true.
                */}
                <rect
                    className="pickSurface"
                    x={0}
                    y={0}
                    width={width}
                    height={height}
                    fill="transparent"
                />

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

                {gridDates.map(date => (
                    <g key={`tick_${date}`}>
                        <line
                            x1={date * stretchX}
                            x2={date * stretchX}
                            y1={0}
                            y2={5}
                            stroke="black"
                            strokeWidth={1}
                        />
                        <line
                            x1={date * stretchX}
                            x2={date * stretchX}
                            y1={height}
                            y2={height - 5}
                            stroke="black"
                            strokeWidth={1}
                        />
                    </g>
                ))}

                {boxes}
                {dates}

                {anchor !== undefined && (
                    <PendingFrame
                        date={anchor}
                        cursor={cursor}
                        stretchX={stretchX}
                        height={height}
                    />
                )}

                {cursor !== undefined && (
                    <g className="cursorDate" pointerEvents="none">
                        {anchor === undefined && (
                            <line
                                x1={cursor * stretchX}
                                x2={cursor * stretchX}
                                y1={0}
                                y2={height}
                                stroke="gray"
                                strokeWidth={1}
                                strokeDasharray="4 4"
                            />
                        )}
                        <text
                            x={cursor * stretchX}
                            y={-5}
                            fontSize={12}
                            textAnchor="middle"
                        >
                            {cursor}
                        </text>
                    </g>
                )}
            </g>
            <g transform={`translate(0, ${height + 30})`}>
                {instructions}
            </g>
        </>
    )
}
