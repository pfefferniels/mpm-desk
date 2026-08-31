import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, MenuItem, Select, SelectChangeEvent, Stack } from "@mui/material"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { MouseEvent, useCallback, useState } from "react"
import { MakeChoice } from "../../fitting/transformers/choice/MakeChoice"
import type { NoteChoice, Preference, RangeChoice } from "../../fitting/transformers/choice/MakeChoice"
import type { AlignedNote } from "../../fitting/alignment"
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

const colors = [
    "#e6194B",
    "#3cb44b",
    "#ffe119",
    "#4363d8",
    "#f58231",
    "#911eb4"
]

interface SelectSourceProps {
    sources: Set<string>
    value: string
    onChange: (event: SelectChangeEvent<string>) => void
}

const SelectSource = ({ sources, value, onChange }: SelectSourceProps) => {
    return (
        <FormControl fullWidth>
            <Select
                value={value}
                onChange={onChange}
            >
                {Array.from(sources).map(source => (
                    <MenuItem key={`select_${source}`} value={source}>
                        {source}
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    )
}

interface ArticulatedNoteProps {
    notes: AlignedNote[]
    stretchX: number
    stretchY: number
    onClick: (e: MouseEvent<Element>, note: AlignedNote) => void
    colorFor: (source: string) => string
}

const ChoiceGroup = ({ notes, stretchX, stretchY, onClick, colorFor }: ArticulatedNoteProps) => {
    const [hovered, setHovered] = useState(false)

    if (!notes.length) return null

    const refOnset = onsetSeconds(notes[0])
    const refVel = notes[0].velocity
    const refPitch = notes[0]["midi.pitch"]

    const variationScore = notes.reduce((acc, note) => {
        const velDiff = Math.abs(note.velocity - refVel)
        const onsetDiff = Math.abs(onsetSeconds(note) - refOnset)
        return acc + (velDiff + onsetDiff * 1000)
    }, 0)

    return (
        <g
            opacity={hovered ? 1 : (variationScore / (notes.length * 4) || 1)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {notes.map((note, i) => {
                const velocity = note.velocity
                const duration = soundedSeconds(note)
                const onset = onsetSeconds(note)
                const yOffset = i - (notes.length / 2) + 0.5
                const source = note.source || 'unknown'
                const velDiff = Math.abs(velocity - refVel)
                const onsetDiff = Math.abs(onset - refOnset)
                if (i > 0 && ((velDiff <= 0 && onsetDiff <= 0.02))) return null

                const y = (100 - note["midi.pitch"] + yOffset) * stretchY

                const color = colorFor(source)

                return (
                    <>
                        <rect
                            data-source={source}
                            data-id={note['xml:id']}
                            x={onset * stretchX}
                            y={y - (stretchY - 0.4) / 2}
                            width={duration * stretchX}
                            height={stretchY * 0.5}
                            fill={color}
                            fillOpacity={(velocity + 40) / 127}
                            stroke='black'
                            strokeWidth={0.8}
                            strokeDasharray={hovered ? 'none' : '1 1'}
                            onClick={(e) => onClick(e, note)}
                            key={`noteRect_${note["xml:id"]}`}
                        />

                        <text
                            x={onset * stretchX + 3}
                            y={y - (stretchY - 0.4) / 2 + stretchY * 0.5 / 2}
                            fontSize={10}
                            fill="black"
                            dominantBaseline="middle"
                        >
                            {(velocity - refVel) !== 0 && `${(velocity - refVel).toFixed(0)}`}
                        </text>
                    </>
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
                stroke={'black'}
                strokeWidth={hovered ? 2 : 1.2}
                fill='none'
            />
        </g>
    )
}

export const ChoiceDesk = ({ msm, addTransformer }: ScopedTransformerViewProps<MakeChoice>) => {
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
    // still has a line to draw, and it has to be the colour its notes carry elsewhere.
    const sourceIDs = Array.from(msm.sources())
    const colorFor = (source: string) => {
        const index = sourceIDs.indexOf(source)
        // An event written outside any `<recording>` belongs to no reading, so it borrows no
        // reading's colour.
        return index < 0 ? '#9e9e9e' : colors[index % colors.length]
    }

    const groups = []

    // group notes with the same xml:id
    const grouped = Object.groupBy(msm.allNotes, note => note['xml:id'])
    for (const [xmlId, notes] of Object.entries(grouped)) {
        if (!notes || !notes.length) return

        groups.push((
            <ChoiceGroup
                key={`group_${xmlId}`}
                notes={notes}
                stretchX={stretchX}
                stretchY={stretchY}
                colorFor={colorFor}
                onClick={(e) => {
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
                        if ('noteIDs' in currentChoice) {
                            const existingNotes = msm.allNotes.filter(note => currentChoice.noteIDs.includes(note['xml:id']))
                            const from = Math.min(...existingNotes.map(note => note.date))
                            const to = notes[0].date
                            setCurrentChoice({
                                from,
                                to
                            })
                        }
                        else {
                            setCurrentChoice({ ...currentChoice, to: notes[0].date })
                        }
                    }
                }}
            />
        ))
    }

    const lanes = pedalLanes(msm.pedals, rollHeight + PEDAL_GUTTER)

    // Far enough for the last thing that sounds, which is not always a note: a pedal held over the
    // final chord ends after every release.
    const lastRelease = msm.allNotes.reduce(
        (acc, note) => Math.max(acc, onsetSeconds(note) + soundedSeconds(note)),
        0,
    )
    const lastLift = msm.pedals.reduce(
        (acc, pedal) => Math.max(acc, pedalOnsetSeconds(pedal) + pedalHeldSeconds(pedal)),
        0,
    )
    const width = Math.max(lastRelease, lastLift) * stretchX

    const sources = new Set(sourceIDs)

    // What the choice is about to cover, said beside the button rather than inside its label.
    //
    // This used to be spelled into the label itself — `Make Choice (12)`, `Make Choice
    // (1200-4800)`, `Make Choice (Default)` — and it is the worst case of that mistake in the app,
    // because the three states are not merely different widths but different *shapes*: a
    // meta-click grows a note count by a digit, and a shift-click replaces the whole count with a
    // pair of tick numbers. The button is the one the user is aiming for while clicking on the plot
    // beside it, so it was reflowing under the cursor on its way over.
    const choiceScope = currentChoice
        ? 'noteIDs' in currentChoice
            ? `${currentChoice.noteIDs.length} notes`
            : `ticks ${currentChoice.from}–${currentChoice.to}`
        : 'default'

    return (
        <>
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
                    <svg width={width} height={containerHeight}>
                        {groups}
                        <PedalLanes
                            pedals={msm.pedals}
                            lanes={lanes}
                            sources={sourceIDs}
                            stretchX={stretchX}
                            width={width}
                            colorFor={colorFor}
                        />
                    </svg>
                </div>
            </div>

            <Dialog
                open={insert}
                onClose={() => setInsert(false)}
            >
                <DialogTitle>Make Choice</DialogTitle>
                <DialogContent>
                    <Stack spacing={2}>
                        Select Preferred Source:
                        <SelectSource
                            sources={sources}
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
                            sources={sources}
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
                            sources={sources}
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
