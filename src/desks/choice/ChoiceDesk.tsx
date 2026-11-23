import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, MenuItem, Select, SelectChangeEvent, Stack } from "@mui/material"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { Fragment, MouseEvent, useCallback, useMemo, useState } from "react"
import { MakeChoice } from "../../fitting/transformers/choice/MakeChoice"
import type { NoteChoice, Preference, RangeChoice } from "../../fitting/transformers/choice/MakeChoice"
import { rowId, type AlignedNote } from "../../fitting/alignment"
import { onsetSeconds, pedalHeldSeconds, pedalOnsetSeconds, soundedSeconds } from "../noteTiming"
import { DeskToolbar } from "../../components/DeskToolbar"
import { ToolGroup } from "../../components/toolbar/ToolGroup"
import { ToolbarButton } from "../../components/toolbar/ToolbarButton"
import { ToolStatus } from "../../components/toolbar/ToolStatus"
import { Clear } from "@mui/icons-material"
import { usePhysicalZoom } from "../../hooks/ZoomProvider"
import { useScrollRegistration } from "../../hooks/useScrollRegistration"
import { PedalLanes } from "./PedalLanes"
import { PedalLaneLabels } from "../PedalBand"
import { PEDAL_AREA, PEDAL_GUTTER, PEDAL_LABEL_WIDTH, pedalLanes } from "../pedalGeometry"
import { rangeCovering, reachedTo } from "../dateRange"
import { useEditable } from "../../hooks/Editing"
import { useCallSelection } from "../../hooks/CallSelection"
import { EVIDENCE_COLOUR } from "../evidence"
import { useScoreDocument } from "../../hooks/ScoreDocument"
import { readingName, readingsOnFittedAxis, takenNotes, takenPedalling } from "./readings"
import { useFollowBack } from "../../hooks/FollowBack"
import { ReadingsLegend } from "./ReadingsLegend"

// Cf. https://gist.github.com/alexhornbake/6005176
// returns <path> attribute @d.
// a curly brace between x1,y1 and x2,y2, w pixels wide 
// and q factor, .5 is normal, higher q = more expressive bracket 
const makeCurlyBrace = (x1: number, y1: number, x2: number, y2: number, w: number, q: number = 0.5) => {
    //Calculate unit vector
    let dx = x1 - x2;
    let dy = y1 - y2;
    const len = Math.sqrt(dx * dx + dy * dy);
    dx = dx / len;
    dy = dy / len;

    //Calculate Control Points of path,
    const qx1 = x1 + q * w * dy;
    const qy1 = y1 - q * w * dx;
    const qx2 = (x1 - .25 * len * dx) + (1 - q) * w * dy;
    const qy2 = (y1 - .25 * len * dy) - (1 - q) * w * dx;
    const tx1 = (x1 - .5 * len * dx) + w * dy;
    const ty1 = (y1 - .5 * len * dy) - w * dx;
    const qx3 = x2 + q * w * dy;
    const qy3 = y2 - q * w * dx;
    const qx4 = (x1 - .75 * len * dx) + (1 - q) * w * dy;
    const qy4 = (y1 - .75 * len * dy) - (1 - q) * w * dx;

    return ("M " + x1 + " " + y1 +
        " Q " + qx1 + " " + qy1 + " " + qx2 + " " + qy2 +
        " T " + tx1 + " " + ty1 +
        " M " + x2 + " " + y2 +
        " Q " + qx3 + " " + qy3 + " " + qx4 + " " + qy4 +
        " T " + tx1 + " " + ty1);
}

/**
 * Behind the readings of a note followed here from another desk: a highlighter's amber, which no
 * reading is coloured in at this strength and which the evidence colour is not.
 */
const FOLLOWED_COLOUR = '#f59e0b'

const colors = [
    "#e6194B",
    "#3cb44b",
    "#ffe119",
    "#4363d8",
    "#f58231",
    "#911eb4"
]

interface SelectSourceProps {
    sources: readonly string[]
    value: string
    onChange: (event: SelectChangeEvent<string>) => void
    colorFor: (source: string) => string
}

/** A reading to prefer, named and coloured as the roll and its legend have it. */
const SelectSource = ({ sources, value, onChange, colorFor }: SelectSourceProps) => {
    return (
        <FormControl fullWidth>
            <Select
                value={value}
                onChange={onChange}
            >
                {sources.map(source => (
                    <MenuItem key={`select_${source}`} value={source} title={source}>
                        <Box component='span' sx={{ width: 12, height: 12, mr: 1, flexShrink: 0, borderRadius: '2px', bgcolor: colorFor(source) }} />
                        {readingName(source, sources)}
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    )
}

interface ArticulatedNoteProps {
    /** The note's rows, one per reading, in the order the readings are coloured. */
    notes: AlignedNote[]
    stretchX: number
    stretchY: number
    /** Scopes the choice to the note. Absent in the viewer, where a choice is not made. */
    onClick?: (e: MouseEvent<Element>, note: AlignedNote) => void
    colorFor: (source: string) => string
    nameFor: (source: string) => string
    /** One of the selected calls chose for this note — see `../evidence.ts`. */
    evidence: boolean
    /** The reader followed this note here from another desk — see `useFollowBack`. */
    followed: boolean
    /**
     * The reading the chain took this note from, `null` where it took none of them, and
     * undefined while the readings of it still stand side by side — see `takenNotes`.
     */
    taken: string | null | undefined
}

/**
 * One score note as each reading has it: a bar per reading, braced together.
 *
 * Every reading gets its bar, including one that agrees with another to the millisecond and the
 * step: a reading drawn only where it differs looks like a take with holes in it, and leaves the
 * one the chain took undrawn wherever it was the one that agreed.
 *
 * Once the chain has taken a reading of the note, that bar is drawn solid and the others are set
 * back, dashed and faint, and the differences written beside them are counted from the one taken.
 * The note is then at full strength however little its readings differ, since the bar taken is
 * what the performance plays and must not fade with them. Before then every bar is dashed until
 * the note is hovered.
 *
 * Where a selected call made its choice for this note, the brace is drawn in the evidence colour
 * and the group is shown at full strength, however little its readings differ.
 *
 * In the viewer a reading's bar is a link to the symbol of the roll that sounds it, opened beside
 * the reconstruction rather than in its place. In the editor a click scopes the choice instead.
 * A note followed here from another desk stands on an amber band, at full strength.
 */
const ChoiceGroup = ({ notes, stretchX, stretchY, onClick, colorFor, nameFor, evidence, followed, taken }: ArticulatedNoteProps) => {
    const [hovered, setHovered] = useState(false)

    if (!notes.length) return null

    const reference = notes.find(note => taken && note.source === taken) ?? notes[0]
    const refOnset = onsetSeconds(reference)
    const refVel = reference.velocity
    const refPitch = reference["midi.pitch"]

    const variationScore = notes.reduce((acc, note) => {
        const velDiff = Math.abs(note.velocity - refVel)
        const onsetDiff = Math.abs(onsetSeconds(note) - refOnset)
        return acc + (velDiff + onsetDiff * 1000)
    }, 0)

    // Where each reading's bar is drawn, as the loop below draws it, for the band to cover them all.
    const placed = notes.map((note, i) => {
        const yOffset = i - (notes.length / 2) + 0.5
        const top = (100 - note["midi.pitch"] + yOffset) * stretchY - (stretchY - 0.4) / 2
        const onset = onsetSeconds(note)
        return { left: onset * stretchX, right: (onset + soundedSeconds(note)) * stretchX, top, bottom: top + stretchY * 0.5 }
    })
    const pad = 3

    return (
        <g
            data-evidence={evidence || undefined}
            data-note={notes[0]['xml:id']}
            data-followed={followed || undefined}
            opacity={hovered || evidence || followed || taken !== undefined ? 1 : (variationScore / (notes.length * 4) || 1)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {followed && (
                <rect
                    x={Math.min(...placed.map(bar => bar.left)) - pad}
                    y={Math.min(...placed.map(bar => bar.top)) - pad}
                    width={Math.max(...placed.map(bar => bar.right)) - Math.min(...placed.map(bar => bar.left)) + 2 * pad}
                    height={Math.max(...placed.map(bar => bar.bottom)) - Math.min(...placed.map(bar => bar.top)) + 2 * pad}
                    rx={2}
                    fill={FOLLOWED_COLOUR}
                    fillOpacity={0.35}
                    stroke={FOLLOWED_COLOUR}
                    strokeWidth={1.5}
                    pointerEvents='none'
                />
            )}
            {notes.map((note, i) => {
                const velocity = note.velocity
                const duration = soundedSeconds(note)
                const onset = onsetSeconds(note)
                const yOffset = i - (notes.length / 2) + 0.5
                const source = note.source || 'unknown'
                const state = taken === undefined ? 'open' : note.source === taken ? 'taken' : 'set aside'

                const y = (100 - note["midi.pitch"] + yOffset) * stretchY

                const color = colorFor(source)
                // The symbol of the roll the reading performs, where its take names one, followed
                // by a click where a click scopes no choice: in the viewer.
                const symbol = onClick ? undefined : note.symbol

                const bar = (
                    <rect
                        data-source={source}
                        data-id={note['xml:id']}
                        data-taken={state === 'taken' || undefined}
                        x={onset * stretchX}
                        y={y - (stretchY - 0.4) / 2}
                        width={duration * stretchX}
                        height={stretchY * 0.5}
                        fill={color}
                        fillOpacity={(velocity + 40) / 127}
                        opacity={state === 'set aside' ? 0.35 : undefined}
                        stroke='black'
                        strokeWidth={0.8}
                        strokeDasharray={state === 'taken' || (state === 'open' && hovered) ? 'none' : '1 1'}
                        onClick={onClick && ((e) => onClick(e, note))}
                    >
                        <title>
                            {`${nameFor(source)}, velocity ${velocity}${state === 'open' ? '' : `, ${state}`}`}
                            {symbol && `\n${symbol}`}
                        </title>
                    </rect>
                )

                // Keyed by the row, not the note: every reading of a note shares its `xml:id`, so
                // the id alone is the same key once per reading.
                return (
                    <Fragment key={rowId(note)}>
                        {symbol
                            ? <a href={symbol} target='_blank' rel='noreferrer'>{bar}</a>
                            : bar}

                        {/* Through to the bars: a figure ten pixels high sits over the bar it labels
                            and the one stacked with it, which a click scoping the choice is aimed at. */}
                        <text
                            x={onset * stretchX + 3}
                            y={y - (stretchY - 0.4) / 2 + stretchY * 0.5 / 2}
                            fontSize={10}
                            fill="black"
                            dominantBaseline="middle"
                            pointerEvents="none"
                        >
                            {(velocity - refVel) !== 0 && `${(velocity - refVel).toFixed(0)}`}
                        </text>
                    </Fragment>
                )
            })}

            <path
                d={
                    makeCurlyBrace(
                        refOnset * stretchX,
                        (100 - refPitch - 1.5) * stretchY,
                        refOnset * stretchX,
                        (100 - refPitch + 1.5) * stretchY,
                        5,
                        0.55
                    )}
                stroke={evidence ? EVIDENCE_COLOUR : 'black'}
                strokeWidth={hovered || evidence || followed ? 2 : 1.2}
                fill='none'
            />
        </g>
    )
}

/**
 * The readings of the score side by side, note by note, and the choice of which to take.
 *
 * Every reading the document holds is drawn, whatever has been chosen: they come from the
 * alignment as loaded (`readingsOnFittedAxis`), since `msm` is the chain's output and keeps only
 * the rows a `MakeChoice` took. `msm` says which those were, so the roll can mark them and the
 * legend can say which reading each choice prefers and over what. The editor draws the same, so
 * a choice made over the whole piece leaves the other reading there to narrow it against.
 *
 * In the viewer the readings are only shown: nothing is chosen, so the bar is empty and a click
 * on a note scopes nothing. It opens the symbol of the roll the reading performs instead, where
 * the transcription names one. A choice is selected from the legend, and the notes a selected
 * `MakeChoice` chose for are marked. A note clicked on another desk of the viewer opens this one
 * scrolled to it and marked, so that it can be followed on to the roll from here.
 */
export const ChoiceDesk = ({ msm, addTransformer }: ScopedTransformerViewProps<MakeChoice>) => {
    const editable = useEditable()
    const { activeEvidence } = useCallSelection()
    const { pristine } = useScoreDocument()
    const { followed } = useFollowBack()
    const followedNotes = useMemo(() => new Set(followed?.notes), [followed])
    // `pristine` is in hand wherever a fit is, so the fallback is for a desk mounted on its own.
    const recorded = pristine ?? msm
    const readings = useMemo(() => readingsOnFittedAxis(recorded, msm), [recorded, msm])
    const taken = useMemo(() => takenNotes(recorded, msm), [recorded, msm])
    const pedalling = useMemo(() => takenPedalling(recorded, msm), [recorded, msm])
    const [currentChoice, setCurrentChoice] = useState<RangeChoice | NoteChoice>()
    const [prefer, setPrefer] = useState<Preference>()
    const [insert, setInsert] = useState(false)

    const stretchX = usePhysicalZoom()
    const [containerHeight, setContainerHeight] = useState(600)
    // The band comes out of the height before the keys are scaled, so the lanes sit under the
    // roll instead of across its bottom octave, which is where a fixed y put them.
    const rollHeight = Math.max(0, containerHeight - PEDAL_GUTTER - PEDAL_AREA)
    const stretchY = rollHeight / 100

    // This desk's vertical scale is whatever height the container ends up with, so the node is
    // measured on the way past — the scroll registration is the one moment it is in hand.
    const registerScroll = useScrollRegistration('choice-desk', 'physical');
    const scrollContainerRef = useCallback((element: HTMLDivElement | null) => {
        if (element) setContainerHeight(element.clientHeight)
        return registerScroll(element)
    }, [registerScroll]);

    // Pedals count towards the colouring as well: a reading that only differs in its pedalling
    // still has a line to draw, and it has to be the colour its notes carry elsewhere. Off the
    // alignment as loaded, as `Alignment.sources` asks, or a reading the chain set aside would
    // lose its colour and the ones after it would move up into its place.
    const sourceIDs = Array.from(recorded.sources())
    const colorFor = (source: string) => {
        const index = sourceIDs.indexOf(source)
        // An event written outside any `<recording>` belongs to no reading, so it borrows no
        // reading's colour.
        return index < 0 ? '#9e9e9e' : colors[index % colors.length]
    }
    const nameFor = (source: string) => readingName(source, sourceIDs)
    const order = (note: AlignedNote) => {
        const index = sourceIDs.indexOf(note.source ?? '')
        return index < 0 ? sourceIDs.length : index
    }

    const groups = []

    // group notes with the same xml:id
    const grouped = Object.groupBy(readings.notes, note => note['xml:id'])
    for (const [xmlId, notes] of Object.entries(grouped)) {
        // On to the next note rather than out of the component, where `return` handed React
        // `undefined` for the whole desk. `Object.groupBy` makes no empty group, so this is for
        // its type, but a guard that would blank the desk if it ever fired is no guard.
        if (!notes || !notes.length) continue

        groups.push((
            <ChoiceGroup
                key={`group_${xmlId}`}
                // A reading keeps its place within every note, so the eye can follow one take
                // along a line of the roll.
                notes={notes.toSorted((a, b) => order(a) - order(b))}
                stretchX={stretchX}
                stretchY={stretchY}
                colorFor={colorFor}
                nameFor={nameFor}
                evidence={notes.some(note => activeEvidence.has(note['xml:id']))}
                followed={followedNotes.has(xmlId)}
                taken={taken.get(xmlId)}
                onClick={editable ? (e) => {
                    if (!e.shiftKey && !e.metaKey) {
                        const newChoice: NoteChoice = {
                            noteIDs: [notes[0]['xml:id']],
                        }
                        setCurrentChoice(newChoice)
                    }
                    else if (currentChoice && e.metaKey && 'noteIDs' in currentChoice) {
                        const noteId = notes[0]['xml:id']
                        const noteIDs = currentChoice.noteIDs.includes(noteId)
                            ? currentChoice.noteIDs.filter(id => id !== noteId)
                            : [...currentChoice.noteIDs, noteId]
                        setCurrentChoice({ ...currentChoice, noteIDs })
                    }
                    else if (currentChoice && e.shiftKey) {
                        const date = notes[0].date
                        if ('noteIDs' in currentChoice) {
                            const picked = readings.notes
                                .filter(note => currentChoice.noteIDs.includes(note['xml:id']))
                                .map(note => note.date)
                            // A cmd-click can take the last id back out, leaving nothing to reach
                            // from — and `Math.min` over no dates is `Infinity`. The click stands
                            // on its own there.
                            setCurrentChoice(picked.length
                                ? rangeCovering(date, ...picked)
                                : { noteIDs: [notes[0]['xml:id']] })
                        }
                        else {
                            setCurrentChoice(reachedTo(currentChoice, date))
                        }
                    }
                } : undefined}
            />
        ))
    }

    const lanes = pedalLanes(readings.pedals, rollHeight + PEDAL_GUTTER)

    // Far enough for the last thing that sounds, which is not always a note: a pedal held over the
    // final chord ends after every release.
    const lastRelease = readings.notes.reduce(
        (acc, note) => Math.max(acc, onsetSeconds(note) + soundedSeconds(note)),
        0,
    )
    const lastLift = readings.pedals.reduce(
        (acc, pedal) => Math.max(acc, pedalOnsetSeconds(pedal) + pedalHeldSeconds(pedal)),
        0,
    )
    const width = Math.max(lastRelease, lastLift) * stretchX

    // How much of the piece each reading supplies, as the chain left it.
    const takenCounts = new Map<string, number>()
    for (const source of taken.values()) {
        if (source) takenCounts.set(source, (takenCounts.get(source) ?? 0) + 1)
    }

    // What the choice is about to cover, said beside the button rather than inside its label.
    //
    // In the label the three states are different *shapes*, not merely different widths: a
    // meta-click grows a note count by a digit, a shift-click replaces the count with a pair of
    // tick numbers. The user aims for this button while clicking the plot beside it, so a label
    // that reflows moves it under the cursor on the way over.
    const choiceScope = currentChoice
        ? 'noteIDs' in currentChoice
            ? `${currentChoice.noteIDs.length} notes`
            : `ticks ${currentChoice.from}–${currentChoice.to}`
        : 'default'

    return (
        <>
            {editable && (
                <DeskToolbar>
                    {/*
                        Unlabelled, because the group's caption is never the desk's own name and `Range
                        Choice` was exactly that. The desk name leads the toolbar row now.

                        `Make Choice` is the primary and is deliberately *not* disabled when nothing is
                        selected: a choice with no range is the documented way to state a preferred
                        source for the whole piece, so no selection is a legitimate scope rather than a
                        missing precondition. The readout beside it says which of the three scopes is in
                        force, which is the information the old label was carrying.
                    */}
                    <ToolGroup>
                        <ToolbarButton
                            primary
                            label='Make Choice'
                            tooltip={currentChoice
                                ? `Choose a preferred source for ${choiceScope}`
                                : 'Choose a preferred source for the whole piece — click notes to narrow it'}
                            onClick={() => setInsert(true)}
                        >
                            Make Choice
                        </ToolbarButton>
                        {/* 120px, measured for `ticks 12345–67890` at ten-point tabular figures —
                            104 was short of it, so the very case it was sized for was the one that
                            ellipsized. Anything longer still truncates, which is the point: the
                            button after it does not move. */}
                        <ToolStatus width={120}>{choiceScope}</ToolStatus>
                        <ToolbarButton
                            icon={<Clear fontSize='small' />}
                            label='Clear Choice'
                            tooltip={currentChoice
                                ? 'Forget the selected notes and go back to the default scope'
                                : 'Nothing selected to clear'}
                            disabled={!currentChoice}
                            onClick={() => setCurrentChoice(undefined)}
                        >
                            Clear Choice
                        </ToolbarButton>
                    </ToolGroup>
                </DeskToolbar>
            )}

            {/*
                The lane names have a column of their own beside the scroller, so `sustain` still
                says which rail it belongs to after the plot has been scrolled past the opening
                bars. Both halves are `containerHeight` tall with the same viewBox extent, so one
                pixel is one unit in both and a name meets its own line.
            */}
            <div style={{ display: 'flex', alignItems: 'flex-start', width: '80vw', height: 'calc(100vh - 370px)' }}>
                <svg
                    style={{ flex: '0 0 auto' }}
                    width={PEDAL_LABEL_WIDTH}
                    height={containerHeight}
                    viewBox={`${-PEDAL_LABEL_WIDTH} 0 ${PEDAL_LABEL_WIDTH} ${containerHeight}`}
                >
                    <PedalLaneLabels lanes={lanes} />
                </svg>

                <div ref={scrollContainerRef} style={{ flex: 1, minWidth: 0, height: '100%', overflowX: 'scroll', overflowY: 'hidden', position: 'relative' }}>
                    {/* Not selectable: a shift-click reaches the choice to a note, and the browser
                        took the same click to stretch a text selection over every figure between,
                        painting them in a blue that reads as the evidence colour. */}
                    <svg width={width} height={containerHeight} style={{ userSelect: 'none' }}>
                        {groups}
                        <PedalLanes
                            pedals={readings.pedals}
                            lanes={lanes}
                            sources={sourceIDs}
                            taken={pedalling}
                            stretchX={stretchX}
                            width={width}
                            colorFor={colorFor}
                            nameFor={nameFor}
                        />
                    </svg>
                </div>
            </div>

            <ReadingsLegend
                readings={sourceIDs}
                colorFor={colorFor}
                taken={takenCounts}
                notes={groups.length}
                indent={PEDAL_LABEL_WIDTH}
            />

            <Dialog
                open={insert}
                onClose={() => setInsert(false)}
            >
                <DialogTitle>Make Choice</DialogTitle>
                <DialogContent>
                    <Stack spacing={2}>
                        Select Preferred Source:
                        <SelectSource
                            sources={sourceIDs}
                            colorFor={colorFor}
                            value={prefer
                                ? 'prefer' in prefer
                                    ? prefer.prefer
                                    : prefer.velocity
                                : 'unknown'
                            }
                            onChange={(e) => {
                                setPrefer({
                                    prefer: e.target.value
                                })
                            }}
                        />
                        <Divider>
                            Or
                        </Divider>

                        Preferred Source for Loudness (Velocity):
                        <SelectSource
                            sources={sourceIDs}
                            colorFor={colorFor}
                            value={prefer
                                ? 'prefer' in prefer
                                    ? prefer.prefer
                                    : prefer.velocity
                                : 'unknown'
                            }
                            onChange={(e) => {
                                if (prefer && 'prefer' in prefer) {
                                    setPrefer({
                                        velocity: e.target.value,
                                        timing: prefer.prefer,
                                        pedalling: prefer.prefer, // TODO: just temporary
                                    })
                                }
                                else {
                                    setPrefer({
                                        velocity: e.target.value,
                                        timing: prefer?.timing || 'unknown',
                                        pedalling: prefer?.timing || 'unknown', // TODO: just temporary
                                    })
                                }
                            }}
                        />

                        Preferred Source for Timing:
                        <SelectSource
                            sources={sourceIDs}
                            colorFor={colorFor}
                            value={prefer
                                ? 'prefer' in prefer
                                    ? prefer.prefer
                                    : prefer.timing
                                : 'unknown'
                            }
                            onChange={(e) => {
                                if (prefer && 'prefer' in prefer) {
                                    setPrefer({
                                        timing: e.target.value,
                                        velocity: prefer.prefer,
                                        pedalling: prefer.prefer, // TODO: just temporary
                                    })
                                }
                                else {
                                    setPrefer({
                                        timing: e.target.value,
                                        velocity: prefer?.velocity || 'unknown',
                                        pedalling: prefer?.velocity || 'unknown', // TODO: just temporary
                                    })
                                }
                            }}
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => setInsert(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        color="primary"
                        onClick={() => {
                            if (prefer) {
                                addTransformer(new MakeChoice({
                                    ...currentChoice,
                                    ...prefer
                                }))
                            }
                            setInsert(false)
                            setCurrentChoice(undefined)
                            setPrefer(undefined)
                        }}
                    >
                        Make Choice
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    )
}
