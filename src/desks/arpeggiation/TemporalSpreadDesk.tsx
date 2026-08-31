import { useMemo, useState } from "react";
import type { ScopedTransformerViewProps } from "../TransformerViewProps";
import { type ArpeggioPlacement, InsertTemporalSpread } from "../../fitting/transformers/ornamentation/InsertTemporalSpread";
import { getDefinition, getInstructions, type Instruction } from "../../fitting/instructions/index";
import { FrameDomain, type TemporalSpread } from "espressivo";
import { onsetSeconds, releaseSeconds } from "../noteTiming";
import { ChordSpread } from "./ChordSpread";
import { TextField, Select, MenuItem, Button, FormControl, InputLabel, Dialog, DialogContent, DialogActions, DialogTitle, Stack } from "@mui/material";
import { DeskToolbar } from "../../components/DeskToolbar";
import { ToolGroup } from "../../components/toolbar/ToolGroup";
import { ToolbarButton } from "../../components/toolbar/ToolbarButton";
import { ToolField } from "../../components/toolbar/ToolField";
import { ToolStatus } from "../../components/toolbar/ToolStatus";
import { usePhysicalZoom } from "../../hooks/ZoomProvider";
import { useScrollRegistration } from "../../hooks/useScrollRegistration";
import { Add, DeleteOutline } from "@mui/icons-material";
import { TempoVariance } from "./TempoVariance";
import { TemporalSpreadInstruction } from "./TemporalSpreadInstruction";
import { useTimeMapping } from "../../hooks/useTimeMapping";
import { useCallSelection } from "../../hooks/CallSelection";
import { SilentOrnaments } from "../SilentOrnaments";

export const TemporalSpreadDesk = ({ msm, mpm, part, addTransformer }: ScopedTransformerViewProps<InsertTemporalSpread>) => {
    /**
     * Which insert the dialog is collecting options for. Held rather than derived from
     * `currentDate`, so that "Insert Default" means the default even while a chord is selected.
     */
    const [insert, setInsert] = useState<'chord' | 'default'>()

    // these are being defined in the drawer
    const [currentDate, setCurrentDate] = useState<number>()
    const [placement, setPlacement] = useState<ArpeggioPlacement>('estimate');
    const [durationThreshold, setDurationThreshold] = useState<number>()

    // this is used for drawing the preview of a tempo curve
    /**
     * The beat the tempo-curve preview is drawn against, as typed and as read.
     *
     * Two values rather than one, because a number field has a state no number represents: the
     * empty box you are halfway through retyping. Holding only the number meant rejecting `''` on
     * the way in, and a controlled input restores its DOM value from the state it was given — so
     * backspacing through `720` stopped dead at `7` and the box could never be cleared.
     *
     * So the text is what the field holds and the number is derived from it, falling back to the
     * last sensible beat while the box is empty or mid-edit. `averageBPM` divides by this, so a
     * zero would take the whole preview to infinity.
     */
    const [beatLengthText, setBeatLengthText] = useState('720');
    const parsedBeatLength = Number(beatLengthText);
    const beatLength =
        Number.isFinite(parsedBeatLength) && parsedBeatLength > 0 ? parsedBeatLength : 720;

    const stretchX = usePhysicalZoom()
    const { tickToSeconds } = useTimeMapping(msm)
    const { calls, activeElements, setActiveElement, removeCall } = useCallSelection()

    // Scoped, and it has to be: `InsertTemporalSpread` writes one default per part, so a lookup
    // by name alone reports part 1's default while part 2 is on screen. Under the old flip button
    // that showed up as "Remove Default" offered in a part that has none; under the split it would
    // be a permanently dead `Insert Default` in every part but the one holding the call.
    const defaultCall = calls.find(
        t => t.name === 'InsertTemporalSpread' && t.options.scope === part && !('date' in t.options)
    )

    const averageBPM = useMemo(() => {
        const notes = msm.allNotes
        if (notes.length < 2) return 120
        const firstNote = notes.reduce((a, b) => a.date < b.date ? a : b)
        const lastNote = notes.reduce((a, b) => a.date > b.date ? a : b)
        const totalTicks = lastNote.date - firstNote.date
        const totalSeconds = onsetSeconds(lastNote) - onsetSeconds(firstNote)
        if (totalSeconds <= 0 || totalTicks <= 0) return 120
        return (totalTicks / beatLength) / (totalSeconds / 60)
    }, [msm, beatLength])

    const scrollContainerRef = useScrollRegistration('temporal-spread-desk', 'physical');

    // Derived, not held in state behind an effect: these are a pure function of the MPM and the
    // scope, and stored they lagged a render behind — the first paint after a refit still drew
    // the previous fit's spreads.
    const temporalSpreads = useMemo(
        () => getInstructions(mpm, 'ornament', part)
            .map(ornament => {
                const def = getDefinition(mpm, 'ornamentDef', ornament.nameRef)
                return {
                    ...ornament,
                    // `getTemporalSpread` answers null for a def that has none; the filter below
                    // tests for absence, so null becomes undefined here.
                    def: def?.getTemporalSpread() ?? undefined
                }
            })
            .filter((spread): spread is (Instruction<'ornament'> & { def: TemporalSpread }) => spread.def !== undefined),
        [mpm, part]
    )

    const transform = () => {
        // What the user asked for, not what the selection happens to be: the dialog was opened by
        // one of two buttons and `insert` records which. Reading `currentDate` here — as this did
        // — meant "Insert Default" silently inserted a single spread whenever a chord was still
        // selected, and it was a truthiness test besides, so a chord at tick 0 was a default.
        if (insert === 'chord' && currentDate !== undefined) {
            // This is a single temporal spread
            addTransformer(new InsertTemporalSpread({
                scope: part,
                placement,
                noteOffShiftTolerance: 2,
                date: currentDate,
            }))
        }
        else {
            // This is a default temporal spread
            addTransformer(new InsertTemporalSpread({
                scope: part,
                placement,
                noteOffShiftTolerance: 2,
                durationThreshold: 35
            }))
        }
    }

    const height = 250;
    const instructionHeight = 40;

    const tickBasedSpreads = temporalSpreads.filter(s => s.def.frameDomain === FrameDomain.Ticks);

    const chordsByDate = useMemo(() => {
        const map = new Map<number, typeof msm.allNotes>();
        for (const notes of msm.asChords().values()) {
            if (!notes.length) continue;
            map.set(notes[0].date, notes);
        }
        return map;
    }, [msm]);

    const chords = []
    for (const notes of msm.asChords().values()) {
        const chordNotes = notes.slice().sort((a, b) => onsetSeconds(a) - onsetSeconds(b))
        if (!chordNotes.length) continue

        const date = chordNotes[0].date
        const existingSpread = temporalSpreads.find(s => s.date === date)

        chords.push((
            <ChordSpread
                key={`chordNotes_${chordNotes[0]["xml:id"]}`}
                notes={chordNotes}
                stretch={stretchX}
                height={height}
                spread={existingSpread?.def}
                onClick={() => setCurrentDate(date)}
                // `!== undefined`, not truthiness — tick 0 is a real chord, and the first
                // chord of the piece is exactly the one at it.
                placement={currentDate !== undefined && date === currentDate ? placement : undefined}
            />
        ))
    }

    return (
        <div>
            <DeskToolbar>
                {/*
                    Two buttons where there was one, and the reason generalises to every desk that
                    contributes to this bar.

                    What stood here was a single control that read `Insert`, `Insert Default` or
                    `Remove Default` depending on whether a chord was selected and whether a
                    default call already existed. Four things were wrong with that. The same pixel
                    performed opposite actions, so a double-click inserted and then deleted. Both
                    the label *and* the icon changed with the state, so the button changed width
                    under a cursor on its way to it. Which state you were in could not be read off
                    the bar at all — you had to work it out from the label and know the rule. And
                    here the flip was not even insert/remove but *three* actions on one button,
                    chosen by a selection the button never displayed.

                    Split, always mounted, and disabled rather than hidden: which state you are in
                    now shows in which button is live, and the readout beside them names the chord.
                */}
                <ToolGroup>
                    <ToolbarButton
                        primary
                        icon={<Add />}
                        label='Insert'
                        tooltip={currentDate === undefined
                            ? 'Select a chord in the plot below to spread it'
                            : 'Insert a temporal spread on the selected chord'}
                        disabled={currentDate === undefined}
                        onClick={() => setInsert('chord')}
                    >
                        Insert
                    </ToolbarButton>
                    <ToolStatus width={88}>
                        {currentDate === undefined ? 'no chord' : `tick ${currentDate}`}
                    </ToolStatus>
                </ToolGroup>
                <ToolGroup label='Default'>
                    <ToolbarButton
                        icon={<Add />}
                        label='Insert Default'
                        tooltip={defaultCall
                            ? 'This part already has a default temporal spread'
                            : 'Spread every chord in this part that is long enough'}
                        disabled={defaultCall !== undefined}
                        onClick={() => setInsert('default')}
                    >
                        Insert Default
                    </ToolbarButton>
                    <ToolbarButton
                        icon={<DeleteOutline />}
                        label='Remove Default'
                        tooltip={defaultCall
                            ? 'Remove the default temporal spread from this part'
                            : 'This part has no default temporal spread'}
                        disabled={!defaultCall}
                        onClick={() => { if (defaultCall) removeCall(defaultCall.id) }}
                    >
                        Remove Default
                    </ToolbarButton>
                </ToolGroup>
                {/*
                    `View` and not `Settings`: the beat length reaches `averageBPM` and
                    `<TempoVariance>`, both of which only draw the tempo-curve preview under the
                    chords. No transformer ever reads it, so changing it cannot alter the
                    performance — only how this desk plots it.
                */}
                <ToolGroup label='View'>
                    <ToolField
                        label='Beat Length'
                        type='number'
                        width={84}
                        value={beatLengthText}
                        onChange={setBeatLengthText}
                    />
                </ToolGroup>
                {/*
                    Last in the bar, because it is about the document rather than about anything
                    this desk does — a spread inserted here is inaudible until the Styles desk has
                    given it a definition, and this is where that is said.
                */}
                <ToolGroup>
                    <SilentOrnaments mpm={mpm} scope={part} />
                </ToolGroup>
            </DeskToolbar>

            <div style={{ position: 'relative', width: '80vw' }}>
                <svg style={{ position: 'absolute', left: 0, top: 0, width: 30, height: height, pointerEvents: 'none', zIndex: 1 }}>
                    {[20, 40, 60, 80, 100].map(bpm => (
                        <text key={`label_${bpm}`} x={4} y={height - bpm + 4} fill="black" fontSize={12}>{bpm}</text>
                    ))}
                </svg>
                <div ref={scrollContainerRef} style={{ overflow: 'scroll' }}>
                    <svg width={Math.max(...msm.allNotes.map(releaseSeconds)) * stretchX} height={height + instructionHeight + 30}>
                        <g>
                            {chords}
                        </g>
                        <TempoVariance
                            msm={msm}
                            part={part}
                            beatLength={beatLength}
                        />
                        {tickToSeconds && tickBasedSpreads.length > 0 && (
                            <g transform={`translate(0, ${height + 10})`}>
                                {tickBasedSpreads.map((ornament, index) => (
                                    <TemporalSpreadInstruction
                                        key={`spreadInstruction_${ornament.id ?? `${ornament.date}_${index}`}`}
                                        ornament={ornament}
                                        spread={ornament.def}
                                        notes={chordsByDate.get(ornament.date) ?? []}
                                        tickToSeconds={tickToSeconds}
                                        stretch={stretchX}
                                        height={instructionHeight}
                                        active={ornament.id !== undefined && activeElements.includes(ornament.id)}
                                        onClick={() => ornament.id && setActiveElement(ornament.id)}
                                        beatLength={beatLength}
                                        refBPM={averageBPM}
                                    />
                                ))}
                            </g>
                        )}
                    </svg>
                </div>
            </div>
            <Dialog
                open={insert !== undefined}
                // Closing no longer clears `currentDate`. Cancelling a dialog is a decision about
                // the dialog, and it was deselecting the chord underneath it — so backing out of
                // the options meant hunting the chord down again to try a different placement.
                onClose={() => setInsert(undefined)}
            >
                <DialogTitle>
                    {insert === 'chord' ? `Temporal Spread @${currentDate}` : 'Insert Default'}
                </DialogTitle>
                <DialogContent>
                    <Stack direction="row" spacing={2} alignItems="center" m={2}>
                        <FormControl fullWidth>
                            <InputLabel id="placement-select-label">Placement</InputLabel>
                            <Select
                                labelId="placement-select-label"
                                id="placement-select"
                                onChange={(e) => setPlacement(e.target.value as ArpeggioPlacement)}
                                defaultValue="none"
                                value={placement}
                            >
                                <MenuItem value="on-beat">On Beat</MenuItem>
                                <MenuItem value="before-beat">Before Beat</MenuItem>
                                <MenuItem value="estimate">Estimate</MenuItem>
                                <MenuItem value="none">None (fallback to default)</MenuItem>
                            </Select>
                        </FormControl>

                        {insert === 'default' && (
                            <FormControl>
                                <TextField
                                    label="Duration Threshold"
                                    type="number"
                                    value={durationThreshold}
                                    onChange={(e) => setDurationThreshold(Number(e.target.value))}
                                    InputLabelProps={{ shrink: true }}
                                    variant="outlined"
                                    fullWidth
                                />
                            </FormControl>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => {
                        transform();
                        setInsert(undefined)
                        // The chord is spent once its spread is written. Cancelling leaves it
                        // selected — that is a decision about the dialog — but confirming must
                        // not, or Insert stays live over a date that already has a call and a
                        // second click writes a duplicate onto it.
                        setCurrentDate(undefined)
                    }}>
                        Insert
                    </Button>
                </DialogActions>
            </Dialog>
        </div >
    )
}
