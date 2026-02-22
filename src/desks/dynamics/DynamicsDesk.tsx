import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScrollSync } from "../../hooks/ScrollSyncProvider";
import { Dynamics } from "../../../../mpm-ts/lib";
import { usePiano } from "react-pianosound";
import { useNotes } from "../../hooks/NotesProvider";
import { asMIDI } from "../../utils/utils";
import { Scope, ScopedTransformerViewProps } from "../TransformerViewProps";
import { MSM, MsmNote } from "mpmify/lib/msm";
import { Range } from "../tempo/Tempo";
import { DynamicsWithEndDate, InsertDynamicsInstructions, Modify, ModifyOptions } from "mpmify/lib/transformers";
import { Box, Button, Drawer, FormControl, FormLabel, Input, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { CurveSegment } from "./CurveSegment";
import { DynamicsCircle } from "./DynamicsCircle";
import { VerticalScale } from "./VerticalScale";
import { useSymbolicZoom } from "../../hooks/ZoomProvider";
import { useSelection } from "../../hooks/SelectionProvider";
import { createPortal } from "react-dom";
import { Ribbon } from "../../components/Ribbon";
import { Add, Clear } from "@mui/icons-material";
import { MarkedRegion } from "./MarkedRegion";

export interface DynamicsSegment {
    date: Range
    velocity: number
    active: boolean
    noteID?: string
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
                active: false,
                noteID: note['xml:id']
            })
        }
    })

    return segments
}

export const DynamicsDesk = ({ part, msm, mpm, addTransformer, appBarRef }: ScopedTransformerViewProps<
    InsertDynamicsInstructions | Modify
>) => {
    const { activeElements, setActiveElement, transformers } = useSelection();
    const [datePlayed, setDatePlayed] = useState<number>()
    const [segments, setSegments] = useState<DynamicsSegment[]>([])
    const [currentPhantomDate, setCurrentPhantomDate] = useState<number>()
    const [mode, setMode] = useState<'insert' | 'modify' | 'phantom'>('insert')
    const [instructions, setInstructions] = useState<DynamicsWithEndDate[]>([])

    const [phantomVelocities, setPhantomVelocities] = useState<Map<number, number>>(new Map())
    const [dragFrom, setDragFrom] = useState<{ date: number, x: number, y: number }>()
    const [dragMouse, setDragMouse] = useState<{ x: number, y: number }>()
    const [dragSnapDate, setDragSnapDate] = useState<number>()
    const [pendingInsert, setPendingInsert] = useState<{ from: number, to: number }>()
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
        setPendingInsert(undefined)
    }, [mpm, part])

    const stretchY = 3
    const margin = 20

    const modifyDeltas = useMemo(() => {
        const deltas = new Map<string, number>()
        for (const t of transformers) {
            if (t.name !== 'Modify') continue
            const opts = t.options as ModifyOptions
            if (opts.aspect !== 'velocity') continue
            if (opts.scope !== undefined && opts.scope !== 'global' && opts.scope !== part) continue
            if ('noteIDs' in opts) {
                for (const nid of opts.noteIDs) {
                    deltas.set(nid, (deltas.get(nid) ?? 0) + opts.change)
                }
            } else if ('from' in opts && 'to' in opts) {
                for (const note of msm.notesInRange(opts.from, opts.to, part)) {
                    const nid = note['xml:id']
                    deltas.set(nid, (deltas.get(nid) ?? 0) + opts.change)
                }
            }
        }
        return deltas
    }, [transformers, msm, part])

    useEffect(() => setSegments(extractDynamicsSegments(msm, part)), [msm, part])

    const clientToSvg = (clientX: number, clientY: number, svg: SVGSVGElement) => {
        const point = svg.createSVGPoint()
        point.x = clientX
        point.y = clientY
        const ctm = svg.getScreenCTM()
        if (!ctm) return { x: 0, y: 0 }
        const p = point.matrixTransform(ctm.inverse())
        return { x: p.x, y: p.y }
    }

    const findNearestDate = (svgX: number, snapThreshold: number) => {
        let bestDate: number | undefined
        let bestDist = Infinity
        for (const seg of segments) {
            const edgeX = seg.date.start * stretchX
            const dist = Math.abs(svgX - edgeX)
            if (dist < bestDist) {
                bestDist = dist
                bestDate = seg.date.start
            }
        }
        return bestDist <= snapThreshold ? bestDate : undefined
    }

    const cancelDrag = () => {
        setDragFrom(undefined)
        setDragMouse(undefined)
        setDragSnapDate(undefined)
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
        const delta = segment.noteID ? modifyDeltas.get(segment.noteID) : undefined
        if (delta && delta !== 0) {
            const originalVelocity = segment.velocity - delta
            const curX = segment.date.start * stretchX
            const curY = (127 - segment.velocity) * stretchY
            const origY = (127 - originalVelocity) * stretchY
            circles.push(
                <line
                    key={`ghost_line_${segment.date}_${i}`}
                    x1={curX}
                    y1={origY}
                    x2={curX}
                    y2={curY}
                    stroke="#999"
                    strokeWidth={1}
                    strokeDasharray="3 2"
                    strokeOpacity={0.5}
                />
            )
            circles.push(
                <circle
                    key={`ghost_dot_${segment.date}_${i}`}
                    cx={curX}
                    cy={origY}
                    r={3}
                    fill="none"
                    stroke="#999"
                    strokeWidth={1.5}
                    strokeOpacity={0.6}
                />
            )
        }
        circles.push(
            <DynamicsCircle
                key={`velocity_segment_${segment.date}_${i}`}
                segment={segment}
                datePlayed={datePlayed}
                stretchX={stretchX}
                screenY={(velocity: number) => (127 - velocity) * stretchY}
                handlePlay={handlePlay}
                handleClick={handleClick}
                cursor={mode === 'insert' ? 'crosshair' : undefined}
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
        <div>
            <Box sx={{ m: 1 }}>{part !== 'global' && `Part ${part + 1}`}</Box>
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

            <div style={{ position: 'relative' }}>
                <svg style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: 40,
                    height: 300 + margin,
                    pointerEvents: 'none',
                    zIndex: 1,
                }}
                    viewBox={`-30 0 35 ${300 + margin}`}
                >
                    <VerticalScale min={10} max={80} step={5} stretchY={stretchY} />
                </svg>

                <div ref={scrollContainerRef} style={{ height: '400', overflow: 'scroll' }}>
                    <svg
                        ref={svgRef}
                        width={msm.end * stretchX + margin}
                        height={300 + margin}
                        viewBox={
                            [
                                -margin,
                                -0,
                                msm.end * stretchX + margin,
                                300 + margin
                            ].join(' ')
                        }
                        onMouseDown={mode === 'insert' ? (e) => {
                            const svg = e.currentTarget
                            const pt = clientToSvg(e.clientX, e.clientY, svg)
                            const ctm = svg.getScreenCTM()
                            const threshold = ctm ? 20 / ctm.a : 30
                            const snapDate = findNearestDate(pt.x, threshold)
                            if (snapDate !== undefined) {
                                setDragFrom({ date: snapDate, x: snapDate * stretchX, y: pt.y })
                            }
                        } : undefined}
                        onMouseMove={mode === 'insert' ? (e) => {
                            if (!dragFrom) return
                            const svg = e.currentTarget as SVGSVGElement
                            const pt = clientToSvg(e.clientX, e.clientY, svg)
                            setDragMouse(pt)
                            const ctm = svg.getScreenCTM()
                            const threshold = ctm ? 20 / ctm.a : 30
                            const snap = findNearestDate(pt.x, threshold)
                            setDragSnapDate(snap !== undefined && snap > dragFrom.date ? snap : undefined)
                        } : undefined}
                        onMouseUp={mode === 'insert' ? () => {
                            if (dragFrom && dragSnapDate) {
                                setPendingInsert({ from: dragFrom.date, to: dragSnapDate })
                                addTransformer(new InsertDynamicsInstructions({
                                    from: dragFrom.date,
                                    to: dragSnapDate,
                                    phantomVelocities,
                                    scope: part
                                }))
                            }
                            cancelDrag()
                        } : undefined}
                        onMouseLeave={mode === 'insert' ? () => cancelDrag() : undefined}
                    >
                        {curves}
                        {circles}

                        {/* Drag preview line */}
                        {dragFrom && dragMouse && (
                            <line
                                x1={dragFrom.x}
                                y1={dragFrom.y}
                                x2={dragSnapDate !== undefined ? dragSnapDate * stretchX : dragMouse.x}
                                y2={dragMouse.y}
                                stroke="gold"
                                strokeWidth={2}
                                strokeDasharray="6 4"
                                pointerEvents="none"
                            />
                        )}

                        {/* Snap indicator circles */}
                        {dragFrom && (
                            <circle
                                cx={dragFrom.x} cy={dragFrom.y} r={4}
                                fill="gold" stroke="gold" strokeWidth={1}
                                pointerEvents="none"
                            />
                        )}
                        {dragFrom && dragSnapDate !== undefined && dragMouse && (
                            <circle
                                cx={dragSnapDate * stretchX} cy={dragMouse.y} r={4}
                                fill="gold" stroke="gold" strokeWidth={1}
                                pointerEvents="none"
                            />
                        )}

                        {/* Optimistic preview while transformer processes */}
                        {pendingInsert && (() => {
                            const pts = segments
                                .filter(s => s.date.start >= pendingInsert.from && s.date.start <= pendingInsert.to)
                                .sort((a, b) => a.date.start - b.date.start)
                            if (pts.length === 0) return null
                            const baselineY = 127 * stretchY
                            let path = `M ${pts[0].date.start * stretchX} ${baselineY} `
                            for (const p of pts) {
                                path += `L ${p.date.start * stretchX} ${(127 - p.velocity) * stretchY} `
                            }
                            path += `L ${pts[pts.length - 1].date.start * stretchX} ${baselineY} Z`
                            return (
                                <path
                                    d={path}
                                    fill="gray"
                                    fillOpacity={0.2}
                                    stroke="gray"
                                    strokeWidth={1}
                                    pointerEvents="none"
                                >
                                    <animate attributeName="fill-opacity" values="0.2;0.08;0.2" dur="1s" repeatCount="indefinite" />
                                </path>
                            )
                        })()}

                        <MarkedRegion
                            from={(modifyOptions && ('from' in modifyOptions)) ? modifyOptions.from : undefined}
                            to={(modifyOptions && ('to' in modifyOptions)) ? modifyOptions.to : undefined}
                            svgRef={svgRef}
                        />
                    </svg>
                </div>
            </div>

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
