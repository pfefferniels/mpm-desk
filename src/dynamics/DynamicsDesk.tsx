import { useCallback, useEffect, useRef, useState } from "react";
import { useScrollSync } from "../hooks/ScrollSyncProvider";
import { Dynamics } from "../../../mpm-ts/lib";
import { usePiano } from "react-pianosound";
import { useNotes } from "../hooks/NotesProvider";
import { asMIDI } from "../utils/utils";
import { Scope, ScopedTransformerViewProps } from "../TransformerViewProps";
import { MSM, MsmNote } from "mpmify/lib/msm";
import { Range } from "../tempo/Tempo";
import { DynamicsWithEndDate, InsertDynamicsInstructions, InsertDynamicsInstructionsOptions, Modify, ModifyOptions } from "mpmify/lib/transformers";
import { Box, Button, Drawer, FormControl, FormLabel, Input, Stack, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { CurveSegment } from "./CurveSegment";
import { DynamicsCircle } from "./DynamicsCircle";
import { VerticalScale } from "./VerticalScale";
import { useSymbolicZoom } from "../hooks/ZoomProvider";
import { useSelection } from "../hooks/SelectionProvider";
import { createPortal } from "react-dom";
import { Ribbon } from "../Ribbon";
import { Add, Clear } from "@mui/icons-material";
import { MarkedRegion } from "./MarkedRegion";

export interface DynamicsSegment {
    date: Range
    velocity: number
    active: boolean
}

const extractDynamicsSegments = (msm: MSM, part: Scope) => {
    const segments: DynamicsSegment[] = []
    msm.asChords(part).forEach((notes, date) => {
        if (!notes.length) return

        for (const note of notes) {
            if (segments.findIndex(s => s.date.start === date && s.velocity === note['midi.velocity']) !== -1) continue
            segments.push({
                date: {
                    start: date,
                    end: date
                },
                velocity: note['midi.velocity'],
                active: false
            })
        }
    })

    return segments
}

export const DynamicsDesk = ({ part, msm, mpm, addTransformer, appBarRef }: ScopedTransformerViewProps<
    InsertDynamicsInstructions | Modify
>) => {
    const { activeElements, setActiveElement } = useSelection();
    const [datePlayed, setDatePlayed] = useState<number>()
    const [segments, setSegments] = useState<DynamicsSegment[]>([])
    const [currentPhantomDate, setCurrentPhantomDate] = useState<number>()
    const [mode, setMode] = useState<'insert' | 'modify' | 'phantom'>('insert')
    const [instructions, setInstructions] = useState<DynamicsWithEndDate[]>([])

    const [phantomVelocities, setPhantomVelocities] = useState<Map<number, number>>(new Map())
    const [insertOptions, setInsertOptions] = useState<InsertDynamicsInstructionsOptions>()
    const [modifyOptions, setModifyOptions] = useState<ModifyOptions>()

    const { play, stop } = usePiano()
    const { slice } = useNotes()
    const stretchX = useSymbolicZoom()
    const svgRef = useRef<SVGSVGElement>(null);

    // Scroll sync - use callback ref to register when element mounts
    const { register, unregister } = useScrollSync();
    const scrollContainerRef = useCallback((element: HTMLDivElement | null) => {
        if (element) {
            register('dynamics-desk', element, 'symbolic');
        } else {
            unregister('dynamics-desk');
        }
    }, [register, unregister]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return

            e.preventDefault()
            if (!currentPhantomDate || !mode) return

            setPhantomVelocities(prev => {
                const entry = prev.get(currentPhantomDate)
                if (entry === undefined) return prev

                prev.set(currentPhantomDate, entry + (e.key === 'ArrowUp' ? 1 : -1))
                return new Map(prev)
            })
        }

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [currentPhantomDate, mode]);

    useEffect(() => {
        setInsertOptions(undefined)

        const dynamics = mpm.getInstructions<Dynamics>('dynamics', part)
        const withEndDate = []
        for (let i = 0; i < dynamics.length; i++) {
            let endDate = dynamics[i + 1]?.date
            if ('endDate' in dynamics[i]) {
                endDate = (dynamics[i] as DynamicsWithEndDate).endDate
            }
            if (endDate === undefined) continue

            withEndDate.push({
                ...dynamics[i],
                endDate
            })
        }
        setInstructions(withEndDate)
    }, [mpm, part])

    const stretchY = 3
    const margin = 20

    useEffect(() => setSegments(extractDynamicsSegments(msm, part)), [msm, part])

    const handleInsert = () => {
        console.log('handleinsert', insertOptions)
        if (!insertOptions) return

        addTransformer(new InsertDynamicsInstructions({
            ...insertOptions,
            phantomVelocities,
            scope: part
        }))

        setInsertOptions(undefined)
    }

    const handlePlay = (from: number, to?: number) => {
        let notes =
            slice(from, to).map(n => {
                const partial: Partial<MsmNote> = { ...n }
                delete partial['midi.onset']
                delete partial['midi.duration']
                return partial as Omit<MsmNote, 'midi.onset' | 'midi.duration'>
            })

        if (typeof part === 'number') notes = notes.filter(n => n.part - 1 === part)
        const midi = asMIDI(notes)
        if (midi) {
            stop()
            play(midi, (e) => {
                if (e.type === 'meta' && e.subtype === 'text') {
                    setDatePlayed(+e.text)
                }
            })
        }
    }

    const insertMarker = (date: number) => {
        if (!insertOptions) {
            setInsertOptions({
                scope: part,
                phantomVelocities,
                from: date,
                to: date
            })
            return
        }

        if (insertOptions.from !== undefined) {
            setInsertOptions({
                ...insertOptions,
                to: date
            })
        }
        else if (insertOptions.to !== undefined) {
            setInsertOptions({
                ...insertOptions,
                from: date,
                to: date
            })
        }
    }

    // const removeMarker = (date: number) => {
    //     setMarkers(prev => {
    //         const index = prev.indexOf(date)
    //         if (index !== -1) {
    //             prev.splice(index, 1)
    //         }
    //         return [...prev]
    //     })
    // }

    const handleClick = (e: MouseEvent, segment: DynamicsSegment) => {
        if (mode === 'phantom') {
            phantomVelocities.set(segment.date.start, segment.velocity)
            setPhantomVelocities(new Map(phantomVelocities))
            setCurrentPhantomDate(segment.date.start)
            return
        }
        else if (mode === 'modify') {
            const noteid = msm.allNotes.find(n => n["midi.velocity"] === segment.velocity && n.date === segment.date.start)?.["xml:id"]
            if (!noteid) {
                console.log('No note found for segment', segment)
                return
            }

            if (!modifyOptions) {
                // Create a noteid choice if none exists.
                setModifyOptions({
                    scope: part,
                    aspect: 'velocity',
                    change: 0,
                    noteIDs: [noteid]
                })
            }
            else if ('noteIDs' in modifyOptions && e.metaKey) {
                // Cmd/Ctrl key adds a noteid to the existing choice.
                modifyOptions.noteIDs.push(noteid)
                setModifyOptions({ ...modifyOptions })
            }
            else if (e.shiftKey) {
                // Shift key always refers to a range choice. 
                // If the existing choice is a pure noteid choice,
                // we convert it to a range choice.
                if ('noteIDs' in modifyOptions) {
                    const existingNotes = msm.allNotes.filter(n => modifyOptions.noteIDs.includes(n["xml:id"]))
                    const fromDate = Math.min(...existingNotes.map(n => n.date))
                    setModifyOptions({
                        from: fromDate,
                        to: segment.date.start,
                        scope: part,
                        aspect: 'velocity',
                        change: 0
                    })
                }
                else {
                    modifyOptions.to = segment.date.start
                    setModifyOptions({ ...modifyOptions })
                }
            }
        }
        insertMarker(segment.date.start)
    }

    const circles: JSX.Element[] = []

    phantomVelocities.forEach((velocity, date) => {
        circles.push(
            <text
                key={`phantom_velocity_${date}`}
                x={date * stretchX}
                y={(127 - velocity) * stretchY}
                fill='darkred'
                textAnchor='middle'
                dominantBaseline='middle'
                onClick={(e) => {
                    if (e.altKey && e.shiftKey) {
                        phantomVelocities.delete(date)
                        setPhantomVelocities(new Map(phantomVelocities))
                    }
                }}
            >
                x
            </text>
        )
    })

    segments.forEach((segment, i) => {
        circles.push(
            <DynamicsCircle
                key={`velocity_segment_${segment.date}_${i}`}
                segment={segment}
                datePlayed={datePlayed}
                stretchX={stretchX}
                screenY={(velocity: number) => (127 - velocity) * stretchY}
                handlePlay={handlePlay}
                handleClick={handleClick}
            />
        )
    })

    const curves = instructions.map(i => {
        return (
            <CurveSegment
                active={activeElements.includes(i["xml:id"])}
                instruction={i}
                stretchX={stretchX}
                stretchY={stretchY}
                onClick={() => {
                    setActiveElement(i["xml:id"])
                }}
            />
        )
    })

    return (
        <div ref={scrollContainerRef} style={{ height: '400', overflow: 'scroll' }}>
            <Box sx={{ m: 1 }}>{part !== 'global' && `Part ${part + 1}`}</Box>
            <Stack direction='row' spacing={1} sx={{ position: 'sticky', left: 0 }}>
                {appBarRef && createPortal((
                    <>
                        <Ribbon title='Mode'>
                            <ToggleButtonGroup
                                value={mode}
                                exclusive
                                onChange={(_, newMode) => {
                                    if (newMode !== null) {
                                        setMode(newMode)
                                    }
                                }}
                                size='small'
                            >
                                <ToggleButton size='small' value='insert'>Insert</ToggleButton>
                                <ToggleButton size='small' value='modify'>Modify</ToggleButton>
                                <ToggleButton size='small' value='phantom'>Phantom</ToggleButton>
                            </ToggleButtonGroup>
                        </Ribbon>

                        {mode === 'modify' && (
                            <Ribbon title='Modification'>
                                <Button
                                    size='small'
                                    variant='contained'
                                    disabled={!modifyOptions}
                                    startIcon={<Add />}
                                    onClick={() => {
                                        if (!modifyOptions) return

                                        addTransformer(new Modify(modifyOptions))
                                        setModifyOptions(undefined)
                                    }}
                                >
                                    Modify
                                </Button>
                            </Ribbon>
                        )}
                        {mode === 'insert' && (
                            <>
                                <Ribbon title='Dynamics'>
                                    <Button
                                        startIcon={<Add />}
                                        size='small'
                                        variant='contained'
                                        onClick={handleInsert}
                                    >
                                        Insert
                                    </Button>
                                </Ribbon>
                            </>
                        )}

                        {mode === 'phantom' && (
                            <Ribbon title='Phantoms'>
                                <Button
                                    size='small'
                                    variant='outlined'
                                    onClick={() => setPhantomVelocities(new Map())}
                                    startIcon={<Clear />}
                                >
                                    Clear
                                </Button>
                            </Ribbon>
                        )}
                    </>
                ), appBarRef?.current ?? document.body)}
            </Stack>

            <svg
                ref={svgRef}
                width={8000 + margin}
                height={300 + margin}
                viewBox={
                    [
                        -margin,
                        -0,
                        8000 + margin,
                        300 + margin
                    ].join(' ')
                }
            >
                <VerticalScale min={10} max={80} step={5} stretchY={stretchY} />
                {curves}
                {circles}
                {<MarkedRegion
                    from={insertOptions?.from || ((modifyOptions && ('from' in modifyOptions)) ? modifyOptions.from : undefined)}
                    to={insertOptions?.to || ((modifyOptions && ('to' in modifyOptions)) ? modifyOptions.to : undefined)}
                    svgRef={svgRef}
                />}
            </svg>

            <Drawer
                open={modifyOptions !== undefined}
                onClose={() => setModifyOptions(undefined)}
                anchor='right'
                sx={{ width: 300 }}
                variant='persistent'
            >
                {modifyOptions && (
                    <>
                        <div>
                            Affects:
                            {'noteIDs' in modifyOptions && (
                                modifyOptions.noteIDs.map(id => <span key={id}>{id} </span>)
                            )}
                        </div>
                        <FormControl>
                            <FormLabel>Relative Change</FormLabel>
                            <Input
                                type='number'
                                value={modifyOptions?.change || 0}
                                onChange={(e) => {
                                    if (!modifyOptions) return
                                    setModifyOptions({
                                        ...modifyOptions,
                                        change: parseFloat(e.target.value)
                                    })
                                }}
                            />
                        </FormControl>

                    </>
                )}
            </Drawer>
        </div>
    )
}
