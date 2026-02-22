import { InsertDynamicsGradient, MSM, MsmNote } from "mpmify"
import { Scope, ScopedTransformerViewProps } from "../TransformerViewProps"
import { Button, Checkbox, FormControlLabel } from "@mui/material"
import { useCallback, useEffect, useRef, useState } from "react"
import { usePhysicalZoom } from "../../hooks/ZoomProvider"
import { useScrollSync } from "../../hooks/ScrollSyncProvider"
import { createPortal } from "react-dom"
import { Ribbon } from "../../components/Ribbon"
import { Add, DeleteOutline } from "@mui/icons-material"
import { Ornament } from "../../../../mpm-ts/lib"
import { usePiano } from "react-pianosound"
import { useNotes } from "../../hooks/NotesProvider"
import { asMIDI } from "../../utils/utils"
import { useSelection } from "../../hooks/SelectionProvider"

const VelocityScale = ({ getY }: { getY: (velocity: number) => number }) => {
    return (
        <g>
            <rect
                x={0}
                y={getY(70)}
                width={30}
                height={getY(0)}
                fill="white"
            />
            <line
                x1={0}
                y1={getY(70)}
                x2={0}
                y2={getY(30)}
                stroke="black"
                strokeWidth={1.5}
            />
            {[30, 40, 50, 60, 70].map(v => {
                const y = getY(v);
                return (
                    <g key={`scale_${v}`}>
                        <line x1={0} y1={y} x2={10} y2={y} stroke="black" strokeWidth={1} />
                        <text x={15} y={y + 4} fontSize={10} fill="black">
                            {v}
                        </text>
                    </g>
                );
            })}
        </g>
    )
}

type RawGradientProps = {
    notes: MsmNote[]
    onClick: (gradient: { from: number; to: number }) => void
    getY: (velocity: number) => number
}

const RawGradient =({ notes, onClick, getY }: RawGradientProps) => {
    const { play, stop } = usePiano();
    const { slice } = useNotes()

    const [ratio, setRatio] = useState<number>()
    const stretchX = usePhysicalZoom()
    const rectRef = useRef<SVGRectElement | null>(null)

    const { softest, loudest } = getDynamicsExtremes(notes);

    if (notes.length === 0) return null;

    return (
        <g
            data-date={notes[0].date}
            onMouseEnter={() => {
                if (notes.length === 0) return;

                const sliced = slice(notes[0].date, notes[0].date + 1);
                const midi = asMIDI(sliced);
                if (midi) {
                    stop();
                    play(midi);
                }
            }}
            onMouseMove={(e) => {
                if (rectRef.current) {
                    const rect = rectRef.current.getBoundingClientRect()
                    const localY = e.clientY - rect.top
                    const ratio = 1 - localY / rect.height
                    setRatio(ratio)
                }
            }}
            onMouseLeave={() => {
                setRatio(undefined)
            }}
        >
            <rect
                ref={rectRef}
                x={(softest.onset * stretchX) - 10}
                y={Math.min(getY(softest.vel), getY(loudest.vel))}
                width={((loudest.onset - softest.onset) * stretchX) + 20}
                height={Math.abs(getY(loudest.vel) - getY(softest.vel))}
                fill='transparent'
            />
            <line
                x1={softest.onset * stretchX}
                x2={loudest.onset * stretchX}
                y1={getY(softest.vel)}
                y2={getY(loudest.vel)}
                stroke="black"
                strokeWidth={2}
                onClick={() => onClick({ from: softest.onset, to: loudest.onset })}
            />
            {ratio && (
                <circle
                    cx={softest.onset * stretchX}
                    cy={getY((loudest.vel - softest.vel) * ratio + softest.vel)}
                    r={6}
                    fill='red'
                    onClick={() => {
                        const lower = -ratio
                        const upper = 1 - ratio
                        onClick({
                            from: lower,
                            to: upper
                        })
                    }}
                />
            )}
        </g>
    )
}

const getDynamicsExtremes = (notes: MsmNote[]) => {
    const softestNote = notes.reduce(
        (prev, curr) => curr["midi.velocity"] < prev["midi.velocity"] ? curr : prev,
        notes[0]
    );
    const loudestNote = notes.reduce(
        (prev, curr) => curr["midi.velocity"] > prev["midi.velocity"] ? curr : prev,
        notes[0]
    );
    return {
        softest: { vel: softestNote["midi.velocity"], onset: softestNote["midi.onset"] },
        loudest: { vel: loudestNote["midi.velocity"], onset: loudestNote["midi.onset"] }
    };
};


const Hull =({ msm, part, getY }: { msm: MSM, part: Scope, getY: (velocity: number) => void }) => {
    const stretchX = usePhysicalZoom()

    return Array
        .from(msm.asChords(part))
        .map(([, notes], index, arr) => {
            const next = arr[index + 1]
            if (!next) return null

            const { loudest, softest } = getDynamicsExtremes(notes);
            const { loudest: nextLoudest, softest: nextSoftest } = getDynamicsExtremes(next[1]);

            return (
                <polygon
                    key={`polygon_${index}`}
                    points={[
                        [softest.onset * stretchX, getY(softest.vel)],
                        [loudest.onset * stretchX, getY(loudest.vel)],
                        [nextLoudest.onset * stretchX, getY(nextLoudest.vel)],
                        [nextSoftest.onset * stretchX, getY(nextSoftest.vel)],
                    ].map(p => p.join(',')).join(' ')}
                    fill="blue"
                    fillOpacity={0.2}
                    stroke="black"
                    strokeWidth={0.5}
                />
            )
        })
}

type GradientInstructionProps = {
    notes: MsmNote[]
    ornament: Ornament
    getY: (velocity: number) => number
    active: boolean
    onClick: () => void
}

const GradientInstruction = ({ notes, ornament, getY, active, onClick }: GradientInstructionProps) => {
    const [hovered, setHovered] = useState(false)
    const stretchX = usePhysicalZoom()

    const from = ornament["transition.from"]!
    const to = ornament["transition.to"]!
    const scale = ornament.scale || 1

    // Post-transformation, all notes share the same "standard" velocity
    const standard = notes[0]["midi.velocity"]
    const avgOnset = notes.reduce((sum, n) => sum + n["midi.onset"], 0) / notes.length

    const lowVel = standard + Math.min(from, to) * scale
    const highVel = standard + Math.max(from, to) * scale

    const x = avgOnset * stretchX

    return (
        <g
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={onClick}
            style={{ cursor: "pointer" }}
        >
            <line
                x1={x}
                x2={x}
                y1={getY(lowVel)}
                y2={getY(highVel)}
                stroke={active ? "blue" : "gray"}
                strokeWidth={4}
                strokeOpacity={hovered ? 1 : 0.6}
            />
            <circle
                cx={x}
                cy={getY(standard)}
                r={3}
                fill={active ? "blue" : "gray"}
            />
        </g>
    )
}

export const DynamicsGradientDesk = ({ msm, mpm, part, addTransformer, appBarRef }: ScopedTransformerViewProps<InsertDynamicsGradient>) => {
    const [sortVelocities, setSortVelocities] = useState(true)
    const stretchX = usePhysicalZoom()
    const physicalEnd = Math.max(...msm.allNotes.map(n => n['midi.onset'] + n['midi.duration']))
    const { transformers, activeElements, setActiveElement, removeTransformer } = useSelection()

    const defaultTransformer = transformers.find(
        t => t.name === 'InsertDynamicsGradient' && !('date' in t.options)
    )

    const { register, unregister } = useScrollSync();
    const scrollContainerRef = useCallback((element: HTMLDivElement | null) => {
        if (element) {
            register('dynamics-gradient-desk', element, 'physical');
        } else {
            unregister('dynamics-gradient-desk');
        }
    }, [register, unregister]);

    const height = 400
    const [pendingDates, setPendingDates] = useState<Set<number>>(new Set())

    useEffect(() => {
        setPendingDates(new Set())
    }, [mpm])

    const transform = (date: number, gradient: { from: number, to: number }) => {
        setPendingDates(prev => new Set(prev).add(date))
        addTransformer(new InsertDynamicsGradient({
            scope: part,
            date,
            gradient,
            sortVelocities
        }))
    }

    const transformDefault = () => {
        addTransformer(new InsertDynamicsGradient({
            scope: part,
            crescendo: { from: -1, to: 0 },
            decrescendo: { from: 0, to: -1 },
            sortVelocities
        }))
    }

    const getY = (velocity: number): number => {
        return height - (velocity / 100) * height
    }

    const getMPMGradient = (date: number): Ornament | undefined => {
        const instruction = mpm.getInstructions('ornament', part)
            .find(i => i.date === date) as Ornament | undefined;
        if (!instruction) return

        if (instruction["transition.from"] !== undefined && instruction["transition.to"] !== undefined) {
            return instruction
        }
    }

    return (
        <div>
            {appBarRef && createPortal((
                <Ribbon title='Dynamics Gradient'>
                    <FormControlLabel
                        control={
                            <Checkbox
                                size='small'
                                checked={sortVelocities}
                                onChange={(e) => setSortVelocities(e.target.checked)}
                                color="primary"
                            />
                        }
                        label="Sort Velocities"
                    />
                    <Button
                        size='small'
                        onClick={() => {
                            if (defaultTransformer) {
                                removeTransformer(defaultTransformer)
                            } else {
                                transformDefault()
                            }
                        }}
                        startIcon={defaultTransformer ? <DeleteOutline /> : <Add />}
                        variant='outlined'
                    >
                        {defaultTransformer ? 'Remove Default' : 'Insert Default'}
                    </Button>
                </Ribbon>
            ), appBarRef?.current ?? document.body)}

            <div style={{ overflow: 'scroll', position: 'relative', paddingBottom: 320 }}>
                <svg height={height} width={100} style={{ position: 'absolute', top: 0, left: 0 }}>
                    <VelocityScale getY={getY} />
                </svg>
                <div ref={scrollContainerRef} style={{ overflow: 'scroll' }}>
                    <svg width={physicalEnd * stretchX} height={height}>
                        <Hull msm={msm} part={part} getY={getY} />
                        {Array
                            .from(msm.asChords())
                            .map(([date, notes]) => {
                                const mpmGradient = getMPMGradient(date);
                                if (mpmGradient) {
                                    return (
                                        <GradientInstruction
                                            key={`mpm_gradient_${date}`}
                                            notes={notes}
                                            ornament={mpmGradient}
                                            getY={getY}
                                            active={activeElements.includes(mpmGradient["xml:id"])}
                                            onClick={() => setActiveElement(mpmGradient["xml:id"])}
                                        />
                                    )
                                }
                                else if (pendingDates.has(date)) {
                                    const { softest, loudest } = getDynamicsExtremes(notes);
                                    const x = ((softest.onset + loudest.onset) / 2) * stretchX;
                                    return (
                                        <line
                                            key={`pending_${date}`}
                                            x1={x}
                                            x2={x}
                                            y1={getY(softest.vel)}
                                            y2={getY(loudest.vel)}
                                            stroke="orange"
                                            strokeWidth={4}
                                            strokeOpacity={0.6}
                                        />
                                    )
                                }
                                else {
                                    return (
                                        <RawGradient
                                            key={`gradient_${date}`}
                                            notes={notes}
                                            onClick={(gradient) => {
                                                transform(date, gradient)
                                            }}
                                            getY={getY}
                                        />
                                    )
                                }
                            })}
                    </svg>
                </div>
            </div>
        </div >
    )
}