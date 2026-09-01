import { ToggleButton, ToggleButtonGroup } from "@mui/material"
import { computeMillisecondsAt } from "../../fitting/transformers/tempo/tempoCalculations"
import type { TempoWithEndDate } from "../../fitting/transformers/tempo/tempoCalculations"
import { InsertTempo } from "../../fitting/transformers/tempo/InsertTempo"
import { createMpm, getInstructions, requireMap } from "../../fitting/instructions/index"
import type { Mpm } from "../../fitting/instructions/index"
import { useCallback, useMemo, useState } from "react"
import { Skyline } from "./Skyline"
import type { SkylineMode } from "./Skyline"
import { TempoCluster, extractTempoSegments, extractOnsets, resolveOverlaps } from "./Tempo"
import type { DrawnLine, TempoSegment } from "./Tempo"
import { combineByMeter } from "./metricGrouping"
import { scopeData, withScopeData } from "./secondary"
import type { TempoScopeData } from "./secondary"
import { VerticalScale } from "./VerticalScale"
import { ZoomControls } from "../../components/ZoomControls"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import type { Scope } from "../TransformerViewProps"
import { Add, Merge } from "@mui/icons-material"
import { ToolCheckbox } from "../../components/toolbar/ToolCheckbox"
import { ToolGroup } from "../../components/toolbar/ToolGroup"
import { ToolbarButton } from "../../components/toolbar/ToolbarButton"
import { DeskToolbar } from "../../components/DeskToolbar"
import { usePhysicalZoom } from "../../hooks/ZoomProvider"
import { useCallSelection } from "../../hooks/CallSelection"
import { useScrollRegistration } from "../../hooks/useScrollRegistration"
import { useTimeMapping } from "../../hooks/useTimeMapping"
import { usePiano } from "../../performance/piano"
import { useNotes } from "../../hooks/NotesProvider"
import { asMIDI } from "../../utils/utils"
import { MidiFile } from "midifile-ts"

/** One array, so that a desk with no drawn curve keeps the same identity from render to render. */
const noDrawnLines: DrawnLine[] = []

export const TempoDesk = ({ msm, mpm, addTransformer, part, secondary, setSecondary }: ScopedTransformerViewProps<InsertTempo>) => {
    const { activeElements, setActiveElement } = useCallSelection()
    const tempoData = useMemo(() => scopeData(secondary.tempo, part), [secondary.tempo, part])

    /**
     * The boxes, the split onsets and the drawn curves live in the work file alone, under the
     * scope they were measured in.
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
        const stored = tempoData.tempoCluster
        if (stored && stored.length > 0) return new TempoCluster(stored)
        return new TempoCluster(extractTempoSegments(msm, part))
    }, [tempoData.tempoCluster, msm, part])

    const [groupByMetre, setGroupByMetre] = useState(true)

    /**
     * The boxes the metre implies over the measured ones: the beat, the bar, and every level
     * between that the boxes under it fill exactly.
     *
     * Derived, so they are handed to the skyline and kept out of {@link setTempoCluster}.
     *
     * The whole signature map, so that each stretch of the piece is grouped under the signature
     * governing it and the bar lines are counted from where that signature took effect. In
     * `latest/score.msm` the map opens 1/4 for the anacrusis and turns to 4/4 on the downbeat at
     * 720; grouped under the first entry alone, no level above the quarter would form at all.
     */
    const metricSegments = useMemo<TempoSegment[]>(() => {
        if (!groupByMetre) return []
        return combineByMeter(tempoCluster.segments.map(s => s.date), msm.timeSignatures)
            .map(date => ({ date, selected: false, silent: false, derived: true }))
    }, [groupByMetre, tempoCluster, msm.timeSignatures])

    /** What the skyline draws: what was measured, and what the metre makes of it. */
    const shownCluster = useMemo(
        () => new TempoCluster([...tempoCluster.segments, ...metricSegments]),
        [tempoCluster, metricSegments]
    )

    const silentOnsets = useMemo<Map<number, number>>(
        () => new Map((tempoData.silentOnsets ?? []).map(o => [o.date, o.onset])),
        [tempoData.silentOnsets]
    )

    const silentOnsetPairs = useMemo<[number, number][]>(
        () => [...silentOnsets],
        [silentOnsets]
    )
    // Anchored on this part's own onsets. The table deduplicates by tick, keeping the first pair
    // it is handed, so a chord the hands spread across two parts is timed by whichever part comes
    // first in the score — which is the wrong reading of every other part's tempo.
    const { tickToSeconds, secondsToTick } = useTimeMapping(msm, silentOnsetPairs, part)
    const drawnLines = tempoData.drawnLines ?? noDrawnLines
    const [mode, setMode] = useState<SkylineMode>(undefined)

    const stretchX = usePhysicalZoom()
    const [stretchY, setStretchY] = useState(1)

    const scrollContainerRef = useScrollRegistration('tempo-desk', 'physical')

    const updateScope = (update: TempoScopeData) => {
        setSecondary(prev => ({ ...prev, tempo: withScopeData(prev.tempo, part, update) }))
    }

    const setTempoCluster = (newCluster: TempoCluster) => {
        updateScope({ tempoCluster: newCluster.segments.filter(s => !s.derived) })
    }

    const setSilentOnset = (date: number, onset: number) => {
        setSecondary(prev => {
            const stored = scopeData(prev.tempo, part).silentOnsets ?? []
            const next = new Map(stored.map(o => [o.date, o.onset]))
            next.set(date, onset)
            return {
                ...prev,
                tempo: withScopeData(prev.tempo, part, {
                    silentOnsets: [...next].map(([date, onset]) => ({ date, onset }))
                })
            }
        })
    }

    const updateDrawnLines = (newLines: DrawnLine[]) => {
        updateScope({ drawnLines: newLines })
    }

    /**
     * The curves the Insert click has handed to the chain, and the document they were handed
     * against.
     *
     * The fold answers in seconds. In the work file the curves are gone at the click — they are
     * the chain's now — but on the skyline they stay until the fit carrying them lands, which is
     * the `mpm` arriving as a new object. Otherwise the desk would show neither the stroke nor
     * the tempo it becomes for as long as the fold runs.
     *
     * Held here rather than in the work file: a desk switch drops them, and dropping them is
     * right, because what is left behind is a document the fit will draw on its own.
     */
    const [inFlight, setInFlight] = useState<{ against: Mpm, scope: Scope, lines: DrawnLine[] }>()
    if (inFlight && (inFlight.against !== mpm || inFlight.scope !== part)) setInFlight(undefined)

    /** What the skyline draws: what is still to be inserted, and what is on its way in. */
    const shownLines = useMemo(
        () => (inFlight ? [...inFlight.lines, ...drawnLines] : drawnLines),
        [inFlight, drawnLines]
    )

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
    const chartHeight = tickToSeconds ? -stretchY * shownCluster.highestBPM(tickToSeconds) : 0

    const { play, stop } = usePiano()
    const { slice } = useNotes()

    // Local preview: run InsertTempo transformers for drawn lines to produce preview tempos
    const previewTempos = useMemo<TempoWithEndDate[]>(() => {
        if (shownLines.length === 0) return []

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
        for (const line of shownLines) {
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
    }, [shownLines, committedTempos, msm, part])

    /**
     * The curves the skyline draws.
     *
     * What the document says, always. A drawn curve is shown as the tempo it will become on top
     * of that — except under Draw, where the stroke itself is already on the skyline and the
     * preview would be a second reading of the same line.
     */
    const displayTempos = shownLines.length > 0 && mode !== 'draw' ? previewTempos : committedTempos

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
                // The click is on no staff and in no voice — it is not part of the score.
                staff: '',
                layer: '',
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
        setInFlight({ against: mpm, scope: part, lines: drawnLines })
        updateDrawnLines([])
    }

    const selectedSegments = tempoCluster.segments.filter(s => s.selected)

    /**
     * Two or more boxes become the one box that spans them all.
     *
     * The guard repeats what the button's `disabled` already says, and is kept: the button is one
     * way in, and nothing stops a later caller from being another.
     */
    const combineSegments = () => {
        if (selectedSegments.length < 2) return

        const fromDate = Math.min(...selectedSegments.map(s => s.date.start))
        const toDate = Math.max(...selectedSegments.map(s => s.date.end))
        const combined = {
            date: { start: fromDate, end: toDate },
            selected: false,
            silent: false
        }
        tempoCluster.unselectAll()
        setTempoCluster(new TempoCluster([...tempoCluster.segments, combined]))
    }

    return (
        <div>
            <DeskToolbar>
                {/*
                    Draw and Split are one state, so they are one group.

                    They were two — a "Mode" holding Draw and a "Segments" holding Split beside
                    Combine — which put two values of the same `SkylineMode` under different
                    captions with a rule between them, reading as two independent switches that
                    could both be on. An exclusive `ToggleButtonGroup` says what the state
                    actually is, and says it in one place.

                    The `?? undefined` keeps today's click-to-deselect: an exclusive group
                    answers a click on the pressed button with `null`, which is a third spelling
                    of "no mode" that `SkylineMode` does not have.
                */}
                <ToolGroup label='Mode'>
                    <ToggleButtonGroup
                        size='small'
                        exclusive
                        value={mode ?? null}
                        onChange={(_, next: SkylineMode | null) => setMode(next ?? undefined)}
                    >
                        <ToggleButton value='draw'>Draw</ToggleButton>
                        <ToggleButton value='split'>Split</ToggleButton>
                    </ToggleButtonGroup>
                </ToolGroup>

                <ToolGroup>
                    <ToolbarButton
                        primary
                        icon={<Add />}
                        label='Insert'
                        tooltip={drawnLines.length === 0
                            ? 'Draw a tempo curve first — there is nothing to insert'
                            : `Write ${drawnLines.length} drawn ${drawnLines.length === 1 ? 'curve' : 'curves'} into the document`}
                        disabled={drawnLines.length === 0}
                        onClick={insertTempoValues}
                    >
                        Insert
                    </ToolbarButton>
                    <ToolbarButton
                        icon={<Merge />}
                        label='Combine'
                        tooltip={selectedSegments.length < 2
                            ? 'Select two or more segments to combine them'
                            : `Combine the ${selectedSegments.length} selected segments into one`}
                        disabled={selectedSegments.length < 2}
                        onClick={combineSegments}
                    >
                        Combine
                    </ToolbarButton>
                    <ToolCheckbox
                        checked={groupByMetre}
                        onChange={setGroupByMetre}
                        label='Metre'
                        tooltip='Also draw the boxes the time signature implies: the beat, the bar, and the levels between'
                    />
                </ToolGroup>
            </DeskToolbar>

            <div style={{ position: 'relative' }}>
                <ZoomControls
                    stretchY={stretchY}
                    setStretchY={setStretchY}
                    rangeY={[1, 2]}
                />

                {tickToSeconds && (
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
                        <VerticalScale stretchY={stretchY} maxTempo={shownCluster.highestBPM(tickToSeconds)} />
                    </svg>
                )}

                <div ref={scrollContainerRef} style={{ width: '100vw', overflow: 'scroll' }}>
                    {tickToSeconds && secondsToTick && (
                        <Skyline
                            part={part}
                            tempos={shownCluster}
                            setTempos={setTempoCluster}
                            onsets={onsets}
                            tickToSeconds={tickToSeconds}
                            stretchX={stretchX}
                            stretchY={stretchY}
                            mode={mode}
                            committedTempos={displayTempos}
                            silentOnsets={silentOnsets}
                            msm={msm}
                            drawnLines={shownLines}
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
