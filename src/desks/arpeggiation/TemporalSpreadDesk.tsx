import { useMemo, useState } from "react";
import type { ScopedTransformerViewProps } from "../TransformerViewProps";
import { type ArpeggioPlacement, InsertTemporalSpread, spreadsGraces } from "../../fitting/transformers/ornamentation/InsertTemporalSpread";
import { getDefinition, performedInstructions, type Instruction } from "../../fitting/instructions/index";
import type { TemporalSpread } from "espressivo";
import { frameIn } from "./spreadFrame";
import { onsetSeconds, releaseSeconds } from "../noteTiming";
import { ChordSpread } from "./ChordSpread";
import { GraceSpread } from "./GraceSpread";
import { GRACE_COLOUR, graceFiguresOf, soundingNotesOf } from "./graceFigures";
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
import { isCallOf } from "../../fitting/calls";;
import { useNumberField } from "../../hooks/useNumberField";
import { SilentOrnaments } from "../SilentOrnaments";
import { useEditable } from "../../hooks/Editing";

/**
 * How each chord was rolled and each grace figure played, in the recording's own milliseconds,
 * with the spreads written for them.
 *
 * Both are ornaments that spread notes over a frame, fitted here, put into ticks by the chain and
 * given a definition on the Styles desk, so both are on this desk: a chord's roll in red, a grace
 * figure in `GRACE_COLOUR`, from its first grace note to the strike of its principal. Insert
 * writes whichever is selected, as an `InsertTemporalSpread` either way: over a date for a chord,
 * over a group for a figure. The strip below draws what has been written for either. Each has a
 * default of its own: every roll long enough, every grace figure.
 *
 * In the viewer the plot is only read: a chord or a figure sounds as the pointer passes and says
 * how long it took, a written spread selects the call that wrote it, and what that call was fitted
 * to is marked. What inserts or removes a spread, and the count of spreads still waiting for a
 * style, is the editor's.
 */
export const TemporalSpreadDesk = ({ msm, mpm, part, addTransformer }: ScopedTransformerViewProps<InsertTemporalSpread>) => {
    const editable = useEditable()

    /**
     * Which insert the dialog is collecting options for. Held rather than derived from
     * `currentDate`, so that "Insert Default" means the default even while a chord is selected.
     */
    const [insert, setInsert] = useState<'chord' | 'default'>()

    // these are being defined in the drawer
    const [currentDate, setCurrentDate] = useState<number>()

    /**
     * The grace figure Insert would write, by its group. One selection between the two: choosing
     * a figure lets go of the chord and the other way round, so that the bar's one Insert never
     * has to say which of them it means.
     */
    const [currentGroup, setCurrentGroup] = useState<string>()
    const [placement, setPlacement] = useState<ArpeggioPlacement>('estimate');

    /**
     * How long a chord's roll has to be, in ms, before the default insert writes a spread for it.
     *
     * Zero is a real setting — spread every chord whose onsets are not exactly simultaneous — so
     * the floor is inclusive, and only a box that is empty or holds nonsense falls back to 35.
     */
    const durationThreshold = useNumberField(35, value => value >= 0);

    // Only ever the tempo-curve preview under the chords: no transformer reads this.
    // `averageBPM` divides by it, so a zero would take the whole preview to infinity.
    const beatLength = useNumberField(720, value => value > 0);

    const stretchX = usePhysicalZoom()
    const { tickToSeconds } = useTimeMapping(msm)
    const { calls, activeElements, activeEvidence, setActiveElement, removeCall } = useCallSelection()

    // Scoped, and it has to be: `InsertTemporalSpread` writes one default per part, so a lookup
    // by name alone reports part 1's default while part 2 is on screen. Under the old flip button
    // that showed up as "Remove Default" offered in a part that has none; under the split it would
    // be a permanently dead `Insert Default` in every part but the one holding the call.
    //
    // Among the spreads over chords: a spread over grace figures names no date either, and is
    // no default of the rolls.
    const spreadCalls = calls.filter(isCallOf('InsertTemporalSpread'))
    const defaultCall = spreadCalls
        .find(t => t.options.scope === part && !spreadsGraces(t.options) && !('date' in t.options))

    // The call that writes every grace figure of the scope at once, which names no group.
    const defaultFiguresCall = spreadCalls
        .find(t => t.options.scope === part && 'graces' in t.options)

    const averageBPM = useMemo(() => {
        const notes = msm.allNotes
        if (notes.length < 2) return 120
        const firstNote = notes.reduce((a, b) => a.date < b.date ? a : b)
        const lastNote = notes.reduce((a, b) => a.date > b.date ? a : b)
        const totalTicks = lastNote.date - firstNote.date
        const totalSeconds = onsetSeconds(lastNote) - onsetSeconds(firstNote)
        if (totalSeconds <= 0 || totalTicks <= 0) return 120
        return (totalTicks / beatLength.value) / (totalSeconds / 60)
    }, [msm, beatLength.value])

    const scrollContainerRef = useScrollRegistration('temporal-spread-desk', 'physical');

    // Derived, not held in state behind an effect: these are a pure function of the MPM and the
    // scope, and stored they lagged a render behind — the first paint after a refit still drew
    // the previous fit's spreads.
    //
    // Rolls and grace figures alike: every ornament whose definition spreads notes over a frame.
    // What tells them apart is the principal a figure names (`@noteid`), which is how each is
    // matched to what it was fitted to below, a roll to the chord at its date and a figure to
    // the group that leads to its principal.
    const temporalSpreads = useMemo(
        () => performedInstructions(mpm, 'ornament', part)
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
                durationThreshold: durationThreshold.value
            }))
        }
    }

    const height = 250;
    const instructionHeight = 40;

    // Longest first, so that where two frames overlap the shorter is drawn on top and both stay
    // within reach of the pointer: a figure's lead and the roll of the chord it leads into.
    const tickBasedSpreads = temporalSpreads
        .flatMap(s => {
            const frame = frameIn(s.def, 'ticks');
            return frame ? [{ ...s, frame }] : [];
        })
        .sort((a, b) => b.frame.length - a.frame.length);

    // The grace groups of the scope, with the notes each sounded: scoped as the chords are, and
    // for their reason.
    const figures = useMemo(
        () => graceFiguresOf(msm, part)
            // One reading, or there is nothing single to draw yet. A figure without a strike to
            // measure to is kept: it has no frame, and `GraceSpread` draws it as one that has not.
            .filter(figure => figure.readings === 1)
            .map(figure => ({
                ...figure,
                notes: soundingNotesOf(
                    figure,
                    msm.allNotes.find(note => note['xml:id'] === figure.principal),
                ),
            })),
        [msm, part],
    );
    const figureOf = (noteid: string | undefined) =>
        noteid === undefined ? undefined : figures.find(figure => `#${figure.principal}` === noteid);
    const writtenFigure = (principal: string) =>
        temporalSpreads.find(s => s.noteid === `#${principal}`)
    const selectedFigure = figures.find(figure => figure.group === currentGroup && figure.strike !== undefined)
    const hasFigures = figures.some(figure => figure.strike !== undefined)

    // Scoped, and it has to be: this is both what the plot draws and what a written spread is
    // measured over below, and `InsertTemporalSpread` frames the chord as `in(scope).chords()`. Left
    // global, an instruction covering one hand would be drawn against the union of both.
    const chordsByDate = useMemo(() => msm.in(part).chords(), [msm, part]);

    const chords = []
    for (const notes of chordsByDate.values()) {
        const chordNotes = notes.slice().sort((a, b) => onsetSeconds(a) - onsetSeconds(b))
        if (!chordNotes.length) continue

        const date = chordNotes[0].date
        // The roll written for the chord, and not a figure on one of its notes.
        const existingSpread = temporalSpreads.find(s => s.date === date && s.noteid === undefined)

        chords.push((
            <ChordSpread
                key={`chordNotes_${chordNotes[0]["xml:id"]}`}
                notes={chordNotes}
                stretch={stretchX}
                height={height}
                spread={existingSpread?.def}
                onClick={editable ? () => { setCurrentDate(date); setCurrentGroup(undefined) } : undefined}
                evidence={chordNotes.some(note => activeEvidence.has(note['xml:id']))}
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
                    Two buttons rather than one that changes what it does, which is the rule for
                    every desk contributing to this bar.

                    One control reading `Insert`, `Insert Default` or `Remove Default` by state
                    would put opposite actions on the same pixel, so a double-click inserts and
                    then deletes; would change label *and* icon with the state, so the button
                    changes width under a cursor on its way to it; and would leave the state
                    unreadable from the bar. Here it would be three actions on one button, chosen
                    by a selection the button never displays.

                    Split, always mounted, disabled rather than hidden: the state shows in which
                    button is live, and the readout beside them names the chord. In the viewer
                    neither group is there at all, which is not a state but a different desk.
                */}
                {editable && (
                    <>
                        <ToolGroup>
                            <ToolbarButton
                                primary
                                icon={<Add />}
                                label='Insert'
                                tooltip={selectedFigure !== undefined
                                    ? writtenFigure(selectedFigure.principal)
                                        ? 'The selected grace figure is already written'
                                        : 'Write the selected grace figure as an ornament on its principal'
                                    : currentDate === undefined
                                        ? 'Select a chord or a grace figure in the plot below to spread it'
                                        : 'Insert a temporal spread on the selected chord'}
                                disabled={selectedFigure !== undefined
                                    ? writtenFigure(selectedFigure.principal) !== undefined
                                    : currentDate === undefined}
                                onClick={() => {
                                    // A figure has nothing to ask: it is placed by its principal
                                    // and written as it was played, so there is no dialog for it.
                                    if (selectedFigure !== undefined) {
                                        addTransformer(new InsertTemporalSpread({ scope: part, group: selectedFigure.group }))
                                        setCurrentGroup(undefined)
                                    }
                                    else setInsert('chord')
                                }}
                            >
                                Insert
                            </ToolbarButton>
                            <ToolStatus width={120}>
                                {selectedFigure !== undefined
                                    ? selectedFigure.group
                                    : currentDate === undefined ? 'no chord' : `tick ${currentDate}`}
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
                            A group of their own, beside the rolls' default and not folded into
                            it: that one asks how long a roll has to be before it is written, and
                            a grace figure has no such threshold. Every figure is written as it
                            was played, so there is nothing to ask and no dialog.
                        */}
                        <ToolGroup label='Grace Notes'>
                            <ToolbarButton
                                icon={<Add />}
                                label='Insert All'
                                tooltip={defaultFiguresCall
                                    ? 'This scope already writes all of its grace figures'
                                    : hasFigures
                                        ? 'Write every grace figure in this scope as an ornament on its principal'
                                        : 'The recording times no grace figure in this scope'}
                                disabled={defaultFiguresCall !== undefined || !hasFigures}
                                onClick={() => addTransformer(new InsertTemporalSpread({ scope: part, graces: 'all' }))}
                            >
                                Insert All
                            </ToolbarButton>
                            <ToolbarButton
                                icon={<DeleteOutline />}
                                label='Remove All'
                                tooltip={defaultFiguresCall
                                    ? 'Remove the call that writes every grace figure in this scope'
                                    : 'This scope has no call that writes all of its grace figures'}
                                disabled={!defaultFiguresCall}
                                onClick={() => { if (defaultFiguresCall) removeCall(defaultFiguresCall.id) }}
                            >
                                Remove All
                            </ToolbarButton>
                        </ToolGroup>
                    </>
                )}
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
                        value={beatLength.text}
                        onChange={beatLength.setText}
                    />
                </ToolGroup>
                {/*
                    Last in the bar, because it is about the document rather than about anything
                    this desk does — a spread inserted here is inaudible until the Styles desk has
                    given it a definition, and this is where that is said.
                */}
                {editable && (
                    <ToolGroup>
                        <SilentOrnaments mpm={mpm} scope={part} />
                    </ToolGroup>
                )}
            </DeskToolbar>

            <div style={{ position: 'relative', width: '80vw' }}>
                <svg style={{ position: 'absolute', left: 0, top: 0, width: 30, height: height, pointerEvents: 'none', zIndex: 1 }}>
                    {[20, 40, 60, 80, 100].map(bpm => (
                        <text key={`label_${bpm}`} x={4} y={height - bpm + 4} fill="black" fontSize={12}>{bpm}</text>
                    ))}
                </svg>
                <div ref={scrollContainerRef} style={{ overflow: 'scroll' }}>
                    <svg width={Math.max(...msm.allNotes.map(releaseSeconds)) * stretchX} height={height + instructionHeight + 30}>
                        {/* Under the chords, which have to stay within reach inside a figure's lead. */}
                        <g>
                            {figures.map(figure => {
                                // What a click on the figure does, which is the same two things
                                // a click on a chord and on its written spread do between them:
                                // it chooses the figure for Insert, in the editor, and selects
                                // the call that wrote it, where one has.
                                const written = writtenFigure(figure.principal)?.id
                                return (
                                    <GraceSpread
                                        key={`graceFigure_${figure.group}`}
                                        figure={figure}
                                        notes={figure.notes}
                                        stretch={stretchX}
                                        height={height}
                                        selected={figure.group === currentGroup}
                                        onClick={editable || written !== undefined
                                            ? () => {
                                                if (editable) {
                                                    setCurrentGroup(figure.group)
                                                    setCurrentDate(undefined)
                                                }
                                                if (written !== undefined) setActiveElement(written)
                                            }
                                            : undefined}
                                        evidence={figure.ids.some(id => activeEvidence.has(id))}
                                    />
                                )
                            })}
                        </g>
                        <g>
                            {chords}
                        </g>
                        <TempoVariance
                            msm={msm}
                            part={part}
                            beatLength={beatLength.value}
                        />
                        {tickToSeconds && tickBasedSpreads.length > 0 && (
                            <g transform={`translate(0, ${height + 10})`}>
                                {tickBasedSpreads.map((ornament, index) => (
                                    <TemporalSpreadInstruction
                                        key={`spreadInstruction_${ornament.id ?? `${ornament.date}_${index}`}`}
                                        ornament={ornament}
                                        spread={ornament.def}
                                        frame={ornament.frame}
                                        // What the ornament orders: the chord at its date, or
                                        // the figure that leads to the principal it names.
                                        notes={ornament.noteid === undefined
                                            ? chordsByDate.get(ornament.date) ?? []
                                            : figureOf(ornament.noteid)?.notes ?? []}
                                        colour={ornament.noteid === undefined ? undefined : GRACE_COLOUR}
                                        tickToSeconds={tickToSeconds}
                                        stretch={stretchX}
                                        height={instructionHeight}
                                        active={ornament.id !== undefined && activeElements.includes(ornament.id)}
                                        onClick={() => ornament.id && setActiveElement(ornament.id)}
                                        beatLength={beatLength.value}
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
                                    label="Duration Threshold (ms)"
                                    helperText="Chords rolled faster than this are left alone"
                                    type="number"
                                    value={durationThreshold.text}
                                    onChange={(e) => durationThreshold.setText(e.target.value)}
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
