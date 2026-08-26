import { useCallback, useEffect, useMemo, useState } from "react";
import { ScopedTransformerViewProps } from "../TransformerViewProps";
import { type ArpeggioPlacement, InsertTemporalSpread } from "../../fitting/transformers/ornamentation/InsertTemporalSpread";
import { getDefinition, getInstructions, type Instruction } from "../../fitting/instructions/index";
import { FrameDomain, type TemporalSpread } from "espressivo";
import { onsetSeconds, releaseSeconds } from "../noteTiming";
import { ChordSpread } from "./ChordSpread";
import { TextField, Select, MenuItem, Button, FormControl, InputLabel, Dialog, DialogContent, DialogActions, DialogTitle, Stack } from "@mui/material";
import { createPortal } from "react-dom";
import { Ribbon } from "../../components/Ribbon";
import { usePhysicalZoom } from "../../hooks/ZoomProvider";
import { useScrollSync } from "../../hooks/ScrollSyncProvider";
import { Add, DeleteOutline } from "@mui/icons-material";
import { TempoVariance } from "./TempoVariance";
import { TemporalSpreadInstruction } from "./TemporalSpreadInstruction";
import { useTimeMapping } from "../../hooks/useTimeMapping";
import { useCallSelection } from "../../hooks/CallSelection";

export const TemporalSpreadDesk = ({ msm, mpm, part, addTransformer, appBarRef }: ScopedTransformerViewProps<InsertTemporalSpread>) => {
    const [temporalSpreads, setTemporalSpreads] = useState<(Instruction<'ornament'> & { def: TemporalSpread })[]>([])
    const [insert, setInsert] = useState(false);

    // these are being defined in the drawer
    const [currentDate, setCurrentDate] = useState<number>()
    const [placement, setPlacement] = useState<ArpeggioPlacement>('estimate');
    const [durationThreshold, setDurationThreshold] = useState<number>()

    // this is used for drawing the preview of a tempo curve
    const [beatLength, setBeatLength] = useState(720);

    const stretchX = usePhysicalZoom()
    const { tickToSeconds } = useTimeMapping(msm)
    const { calls, activeElements, setActiveElement, removeCall } = useCallSelection()

    const defaultCall = calls.find(
        t => t.name === 'InsertTemporalSpread' && !('date' in t.options)
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

    const { register, unregister } = useScrollSync();
    const scrollContainerRef = useCallback((element: HTMLDivElement | null) => {
        if (element) {
            register('temporal-spread-desk', element, 'physical');
        } else {
            unregister('temporal-spread-desk');
        }
    }, [register, unregister]);

    useEffect(() => {
        const spreads = getInstructions(mpm, 'ornament', part)
            .map(ornament => {
                const def = getDefinition(mpm, 'ornamentDef', ornament.nameRef)
                return {
                    ...ornament,
                    // `getTemporalSpread` answers null for a def that has none; the filter below
                    // tests for absence, so null becomes undefined here.
                    def: def?.getTemporalSpread() ?? undefined
                }
            })
            .filter((spread): spread is (Instruction<'ornament'> & { def: TemporalSpread }) => spread.def !== undefined);
        setTemporalSpreads(spreads);
    }, [mpm, part])

    const transform = () => {
        if (currentDate) {
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
                placement={(currentDate && (date === currentDate)) ? placement : undefined}
            />
        ))
    }

    return (
        <div>
            {appBarRef && (
                <>
                    {appBarRef && createPortal((
                        <>
                            <Ribbon title="Temporal Spread">
                                {!currentDate && defaultCall ? (
                                    <Button
                                        size='small'
                                        variant='outlined'
                                        onClick={() => removeCall(defaultCall.id)}
                                        startIcon={<DeleteOutline />}
                                    >
                                        Remove Default
                                    </Button>
                                ) : (
                                    <Button
                                        size='small'
                                        variant='outlined'
                                        onClick={() => setInsert(true)}
                                        startIcon={<Add />}
                                    >
                                        Insert {!currentDate && 'Default'}
                                    </Button>
                                )}
                            </Ribbon>
                            <Ribbon title='Tempo Curve'>
                                <TextField
                                    size='small'
                                    label="Beat Length"
                                    type="number"
                                    value={beatLength}
                                    onChange={(e) => setBeatLength(Number(e.target.value))}
                                    InputLabelProps={{ shrink: true }}
                                    variant="outlined"
                                    sx={{ width: '100px' }}
                                />
                            </Ribbon>
                        </>
                    ), appBarRef?.current ?? document.body)}
                </>
            )}

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
                open={insert}
                onClose={() => {
                    setCurrentDate(undefined)
                    setInsert(false)
                }}
            >
                <DialogTitle>
                    {currentDate ? `Temporal Spread @${currentDate}` : 'Insert Default'}
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

                        {!currentDate && (
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
                        setCurrentDate(undefined);
                        setInsert(false)
                    }}>
                        Insert
                    </Button>
                </DialogActions>
            </Dialog>
        </div >
    )
}
