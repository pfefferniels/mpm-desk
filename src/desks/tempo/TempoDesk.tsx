import { Button, Stack, ToggleButton } from "@mui/material"
import { computeMillisecondsAt } from "../../fitting/transformers/tempo/tempoCalculations"
import type { TempoWithEndDate } from "../../fitting/transformers/tempo/tempoCalculations"
import { TranslatePhysicalTimeToTicks } from "../../fitting/transformers/tempo/TranslatePhysicalTimeToTicks"
import { InsertTempo } from "../../fitting/transformers/tempo/InsertTempo"
import { createMpm, getInstructions, requireMap } from "../../fitting/instructions/index"
import { useCallback, useMemo, useState } from "react"
import { Skyline } from "./Skyline"
import type { SkylineMode } from "./Skyline"
import { TempoCluster, extractTempoSegments, extractOnsets, resolveOverlaps } from "./Tempo"
import type { TempoSegment as LocalTempoSegment, DrawnLine } from "./Tempo"
import { VerticalScale } from "./VerticalScale"
import { ZoomControls } from "../../components/ZoomControls"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { Add, Merge } from "@mui/icons-material"
import { Ribbon } from "../../components/Ribbon"
import { DeskToolbar } from "../../components/DeskToolbar"
import { usePhysicalZoom } from "../../hooks/ZoomProvider"
import { useCallSelection } from "../../hooks/CallSelection"
import { useScrollRegistration } from "../../hooks/useScrollRegistration"
import { useTimeMapping } from "../../hooks/useTimeMapping"
import { usePiano } from "react-pianosound"
import { useNotes } from "../../hooks/NotesProvider"
import { asMIDI } from "../../utils/utils"
import { MidiFile } from "midifile-ts"

/**
 * The onset of a date the recording does not sound — the second half of a segment the user
 * split, in seconds, as `work.json` stores it.
 *
 * Stated here rather than imported: it is this desk's own editorial input, it never reaches the
 * chain, and nothing else reads it.
 */
export type SilentOnset = {
    date: number
    onset: number
}

export type TempoSecondaryData = {
    tempoCluster?: LocalTempoSegment[]
    silentOnsets?: SilentOnset[]
    drawnLines?: DrawnLine[]
}

/** One array, so that a desk with no drawn curve keeps the same identity from render to render. */
const noDrawnLines: DrawnLine[] = []

export const TempoDesk = ({ msm, mpm, addTransformer, part, secondary, setSecondary }: ScopedTransformerViewProps<TranslatePhysicalTimeToTicks | InsertTempo>) => {
    const { activeElements, setActiveElement } = useCallSelection()
    const tempoData = secondary?.tempo

    /**
     * The boxes, the split onsets and the drawn curves live in the work file alone.
     *
     * They were never two values to begin with: a `TempoCluster` wraps the very array it is
     * handed, so the copy mirrored into `secondary` was the same array under another name — three
     * hand-written mirrors of one thing, each free to drift. The setters below write only to
     * `secondary`, and everything the desk draws is read back out of it.
     *
     * With nothing stored, the segments the recording itself implies stand in. That seed is not
     * written back: opening a file would otherwise dirty it before the editor had touched
     * anything, so it is the first real edit that puts boxes in the work file.
     */
    const tempoCluster = useMemo(() => {
        const stored = tempoData?.tempoCluster
        if (stored && stored.length > 0) return new TempoCluster(stored)
        return new TempoCluster(extractTempoSegments(msm, part))
    }, [tempoData?.tempoCluster, msm, part])

    const silentOnsets = useMemo<Map<number, number>>(
        () => new Map((tempoData?.silentOnsets ?? []).map(o => [o.date, o.onset])),
        [tempoData?.silentOnsets]
    )

    const silentOnsetPairs = useMemo<[number, number][]>(
        () => [...silentOnsets],
        [silentOnsets]
    )
    const { tickToSeconds, secondsToTick } = useTimeMapping(msm, silentOnsetPairs)
    const drawnLines = tempoData?.drawnLines ?? noDrawnLines
    const [mode, setMode] = useState<SkylineMode>(undefined)

    const stretchX = usePhysicalZoom()
    const [stretchY, setStretchY] = useState(1)

    const scrollContainerRef = useScrollRegistration('tempo-desk', 'physical')

    const setTempoCluster = (newCluster: TempoCluster) => {
        setSecondary(prev => ({
            ...prev,
            tempo: {
                ...prev.tempo,
                tempoCluster: newCluster.segments
            }
        }))
    }

    const setSilentOnset = (date: number, onset: number) => {
        setSecondary(prev => {
            const next = new Map((prev.tempo?.silentOnsets ?? []).map(o => [o.date, o.onset]))
            next.set(date, onset)
            return {
                ...prev,
                tempo: {
                    ...prev.tempo,
                    silentOnsets: [...next].map(([date, onset]) => ({ date, onset }))
                }
            }
        })
    }

    const updateDrawnLines = (newLines: DrawnLine[]) => {
        setSecondary(prev => ({
            ...prev,
            tempo: {
                ...prev.tempo,
                drawnLines: newLines
            }
        }))
    }

    // A <tempo> has no end in MPM: it is in force until the next one, and the last
    // one until the piece ends. (The fitting chain reads the same span through
    // `resolveSpan`. There is no `endDate` attribute in the format to read instead.)
    const committedTempos = useMemo<TempoWithEndDate[]>(() => {
        const tempos = getInstructions(mpm, 'tempo', part)
            .slice()
            .sort((a, b) => a.date - b.date)
        return tempos
            .map((tempo, i) => {
                const endDate = tempos[i + 1]?.date ?? msm.end
                if (!endDate || endDate <= tempo.date) return null
                return { ...tempo, endDate }
            })
            .filter((t): t is NonNullable<typeof t> => t !== null)
    }, [mpm, msm, part])

    const onsets = useMemo(() => {
        const base = extractOnsets(msm, part)
        const existing = new Set(base.map(o => o.date))
        for (const [date] of silentOnsets) {
            if (!existing.has(date)) {
                base.push({ date })
            }
        }
        return base.sort((a, b) => a.date - b.date)
    }, [msm, part, silentOnsets])
    const chartHeight = tempoCluster && tickToSeconds ? -stretchY * tempoCluster.highestBPM(tickToSeconds) : 0

    const { play, stop } = usePiano()
    const { slice } = useNotes()

    // Local preview: run InsertTempo transformers for drawn lines to produce preview tempos
    const previewTempos = useMemo<TempoWithEndDate[]>(() => {
        if (drawnLines.length === 0) return []

        const scratchMPM = createMpm()

        // First, apply all existing committed tempos to the scratch MPM, through the
        // espressivo map. The scratch document is empty and the committed tempos are
        // unique by date, so a plain add per tempo can overwrite nothing.
        const scratchTempoMap = requireMap(scratchMPM, 'tempo', part)
        for (const ct of committedTempos) {
            scratchTempoMap.addTempo({
                id: ct.id,
                date: ct.date,
                bpm: ct.bpm,
                beatLength: ct.beatLength,
                ...(ct.transitionTo !== undefined ? {
                    transitionTo: ct.transitionTo,
                    meanTempoAt: ct.meanTempoAt
                } : {})
            })
        }

        // Then apply drawn lines as InsertTempo transformers
        for (const line of drawnLines) {
            if (line.startTick === undefined || line.endTick === undefined) continue
            const isTransition = Math.abs(line.from.bpm - line.to.bpm) > 0.01
            const transformer = new InsertTempo({
                from: line.startTick,
                to: line.endTick,
                bpm: line.from.bpm,
                beatLength: line.beatLength,
                scope: part,
                ...(isTransition ? {
                    transitionTo: line.to.bpm,
                    meanTempoAt: line.meanTempoAt
                } : {})
            })
            transformer.run(msm, scratchMPM)
        }

        const tempos = getInstructions(scratchMPM, 'tempo', part)
            .slice()
            .sort((a, b) => a.date - b.date)

        return tempos
            .map((tempo, i) => {
                const endDate = tempos[i + 1]?.date ?? msm.end
                if (!endDate || endDate <= tempo.date) return null
                return { ...tempo, endDate }
            })
            .filter((t): t is NonNullable<typeof t> => t !== null)
    }, [drawnLines, committedTempos, msm, part])

    // Use preview tempos if there are drawn lines, otherwise committed tempos
    const displayTempos = drawnLines.length > 0 ? previewTempos : committedTempos

    const buildTempoMidi = useCallback((tempo: TempoWithEndDate): MidiFile | undefined => {
        const notes = structuredClone(slice(tempo.date, tempo.endDate))

        // The preview restates the passage under this one <tempo>, so each note is re-timed
        // from the start of its span. `computeMillisecondsAt` already answers in milliseconds,
        // which is what the alignment holds, so nothing is divided here; and the second
        // attribute is an absolute release rather than a length, so it is a second
        // `computeMillisecondsAt` call rather than the difference of two.
        for (const note of notes) {
            if (note.date >= tempo.date && note.date < tempo.endDate) {
                note['milliseconds.date'] = computeMillisecondsAt(note.date, tempo)
                const noteEnd = Math.min(note.date + note.duration, tempo.endDate)
                note['milliseconds.date.end'] = computeMillisecondsAt(noteEnd, tempo)
            }
        }

        const CLICK_MS = 10

        for (let i = tempo.date; i <= tempo.endDate; i += (tempo.beatLength * 4 * 720) / 2) {
            const onset = computeMillisecondsAt(i, tempo)
            notes.push({
                date: i,
                duration: 5,
                'midi.pitch': i === tempo.endDate ? 120 : 127,
                'xml:id': `metronome-${i}`,
                part: 0,
                pitchname: 'C',
                accidentals: 0,
                octave: 4,
                'milliseconds.date': onset,
                'milliseconds.date.end': onset + CLICK_MS,
                velocity: 80
            })
        }

        notes.sort((a, b) => a['milliseconds.date'] - b['milliseconds.date'])
        return asMIDI(notes)
    }, [slice])

    const committedTempoMidis = useMemo(
        () => displayTempos.map(buildTempoMidi),
        [displayTempos, buildTempoMidi]
    )

    const handleTempoPlay = useCallback((midi: MidiFile | undefined) => {
        stop()
        if (midi) play(midi)
    }, [play, stop])

    const handleSegmentPlay = useCallback((from: number, to: number) => {
        const notes = slice(from, to)
        const midi = asMIDI(notes)
        if (midi) {
            stop()
            play(midi)
        }
    }, [slice, play, stop])

    const insertTempoValues = () => {
        if (!tempoCluster || drawnLines.length === 0) return

        for (const line of drawnLines) {
            if (line.startTick === undefined || line.endTick === undefined) continue
            const isTransition = Math.abs(line.from.bpm - line.to.bpm) > 0.01
            addTransformer(new InsertTempo({
                from: line.startTick,
                to: line.endTick,
                bpm: line.from.bpm,
                beatLength: line.beatLength,
                scope: part,
                ...(isTransition ? {
                    transitionTo: line.to.bpm,
                    meanTempoAt: line.meanTempoAt
                } : {})
            }))
        }
        updateDrawnLines([])
    }

    const translate = () => {
        addTransformer(new TranslatePhysicalTimeToTicks({
            translatePhysicalModifiers: true
        }))
    }

    return (
        <div>
            <Stack direction='row' spacing={1}>
                <DeskToolbar>
                    <Ribbon title='Tempo'>
                        <Button
                            size='small'
                            startIcon={<Add />}
                            variant='contained'
                            onClick={insertTempoValues}
                            disabled={drawnLines.length === 0}
                        >
                            Insert
                        </Button>
                    </Ribbon>
                    <Ribbon title='Tick Time'>
                        <Button
                            variant='contained'
                            onClick={translate}
                            size='small'
                        >
                            Translate To Ticks
                        </Button>
                    </Ribbon>
                    <Ribbon title='Mode'>
                        <ToggleButton
                            value='draw'
                            size='small'
                            selected={mode === 'draw'}
                            onChange={() => setMode(prev => prev === 'draw' ? undefined : 'draw')}
                        >
                            Draw
                        </ToggleButton>
                    </Ribbon>
                    <Ribbon title='Segments'>
                        <ToggleButton
                            value='check'
                            size='small'
                            selected={mode === 'split'}
                            onChange={() => mode === 'split' ? setMode(undefined) : setMode('split')}
                        >
                            Split
                        </ToggleButton>

                        <Button
                            size='small'
                            variant='outlined'
                            startIcon={<Merge />}
                            disabled={tempoCluster.segments.filter(s => s.selected).length < 2}
                            onClick={() => {
                                const selected = tempoCluster.segments.filter(s => s.selected)
                                if (selected.length < 2) return
                                const fromDate = Math.min(...selected.map(s => s.date.start))
                                const toDate = Math.max(...selected.map(s => s.date.end))
                                const combined = {
                                    date: { start: fromDate, end: toDate },
                                    selected: false,
                                    silent: false
                                }
                                tempoCluster.unselectAll()
                                setTempoCluster(new TempoCluster([...tempoCluster.segments, combined]))
                            }}
                        >
                            Combine
                        </Button>

                    </Ribbon>
                </DeskToolbar>
            </Stack>

            <div style={{ position: 'relative' }}>
                <ZoomControls
                    stretchY={stretchY}
                    setStretchY={setStretchY}
                    rangeY={[1, 2]}
                />

                {tempoCluster && tickToSeconds && (
                    <svg style={{
                        position: 'absolute',
                        left: 0,
                        top: '3rem',
                        width: 40,
                        height: -chartHeight + 100,
                        pointerEvents: 'none',
                        zIndex: 1,
                    }}
                        viewBox={`-30 ${chartHeight - 50} 30 ${-chartHeight + 100}`}
                    >
                        <VerticalScale stretchY={stretchY} maxTempo={tempoCluster.highestBPM(tickToSeconds)} />
                    </svg>
                )}

                <div ref={scrollContainerRef} style={{ width: '100vw', overflow: 'scroll' }}>
                    {tempoCluster && tickToSeconds && secondsToTick && (
                        <Skyline
                            part={part}
                            tempos={tempoCluster}
                            setTempos={setTempoCluster}
                            onsets={onsets}
                            tickToSeconds={tickToSeconds}
                            stretchX={stretchX}
                            stretchY={stretchY}
                            mode={mode}
                            committedTempos={mode !== 'draw' ? displayTempos : []}
                            silentOnsets={silentOnsets}
                            msm={msm}
                            drawnLines={drawnLines}
                            onDrawLine={(line) => updateDrawnLines([...resolveOverlaps(drawnLines, line), line])}
                            onToggleSplitMode={() => setMode(prev => prev === 'split' ? undefined : 'split')}
                            onSplit={(first, second, onset) => {
                                setSilentOnset(second.date.start, onset)
                                setTempoCluster(new TempoCluster([...tempoCluster.segments, first, second]))
                            }}
                            onPlaySegment={handleSegmentPlay}
                            onStopSegment={stop}
                            activeElements={activeElements}
                            onActivateElement={setActiveElement}
                            onPlayTempo={handleTempoPlay}
                            onStopTempo={stop}
                            committedTempoMidis={committedTempoMidis}
                        />
                    )}
                </div>
            </div>
        </div>
    )
}
