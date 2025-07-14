import { DatedDynamicsGradient, DynamicsGradient, InsertDynamicsGradient } from "mpmify"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { Button, Checkbox, FormControlLabel } from "@mui/material"
import { useEffect, useState } from "react"
import { ChordGradient } from "./ChordGradient"
import GradientDetails from "./GradientDetails"
import { Ornament, OrnamentDef } from "../../../mpm-ts/lib"
import { usePhysicalZoom } from "../hooks/ZoomProvider"
import { createPortal } from "react-dom"
import { Ribbon } from "../Ribbon"
import { Add } from "@mui/icons-material"

export const DynamicsGradientDesk = ({ msm, mpm, addTransformer, part, appBarRef }: ScopedTransformerViewProps<InsertDynamicsGradient>) => {
    const [currentDate, setCurrentDate] = useState<number>()
    const [gradients, setGradients] = useState<DatedDynamicsGradient>(new Map())
    const [defaultCrescendo,] = useState<DynamicsGradient>({ from: -1, to: 0 })
    const [defaultDecrescendo,] = useState<DynamicsGradient>({ from: 0, to: -1 })
    const [newGradient, setNewGradient] = useState<DynamicsGradient>()
    const [sortVelocities, setSortVelocities] = useState(true)
    const stretchX = usePhysicalZoom()

    useEffect(() => {
        setGradients(
            new Map(
                mpm
                    .getInstructions<Ornament>('ornament', part)
                    .map(ornament => {
                        const def = mpm.getDefinition('ornamentDef', ornament['name.ref']) as OrnamentDef | undefined
                        if (!def) return
                        return [
                            ornament.date,
                            {
                                from: def.dynamicsGradient?.["transition.from"],
                                to: def.dynamicsGradient?.["transition.to"]
                            }
                        ] as [number, DynamicsGradient]
                    })
                    .filter(record => record !== undefined)
            )
        )
    }, [mpm, part])

    const transform = () => {
        if (!currentDate) {
            addTransformer(new InsertDynamicsGradient({
                scope: part,
                crescendo: defaultCrescendo,
                decrescendo: defaultDecrescendo,
                sortVelocities
            }))
        }
        else if (currentDate && newGradient) {
            addTransformer(new InsertDynamicsGradient({
                scope: part,
                date: currentDate,
                gradient: newGradient,
                sortVelocities
            }))
        }
    }

    const height = 250

    const chordsGradients = []
    for (const notes of msm.asChords().values()) {
        const chordNotes = notes.slice().sort((a, b) => a["midi.onset"] - b["midi.onset"])
        if (!chordNotes.length) continue

        const date = chordNotes[0].date
        chordsGradients.push((
            <ChordGradient
                key={`chordNotes_${chordNotes[0]["xml:id"]}`}
                notes={chordNotes}
                onClick={() => setCurrentDate(date)}
                gradient={gradients.get(date)}
                stretch={stretchX}
                height={height}
            />
        ))
    }

    const points: { onset: number, velocity: number }[] = []
    for (const notes of msm.asChords().values()) {
        const chordNotes = notes.slice().sort((a, b) => a["midi.onset"] - b["midi.onset"])
        if (!chordNotes.length) continue

        if (chordNotes.length === 1) {
            points.push({ onset: chordNotes[0]["midi.onset"], velocity: chordNotes[0]["midi.velocity"] })
        }
        else {
            let gradient = gradients.get(chordNotes[0].date)
            if (!gradient) {
                if (chordNotes[0]["midi.velocity"] < chordNotes[chordNotes.length - 1]["midi.velocity"]) {
                    gradient = defaultCrescendo
                }
                else {
                    gradient = defaultDecrescendo
                }
            }

            const normalized = (value: number, start: number, end: number): number => {
                return (value - start) / (end - start);
            }

            const zeroGradient = normalized(0, gradient.from, gradient.to)
            const translated = zeroGradient * (chordNotes[chordNotes.length - 1]["midi.velocity"] - chordNotes[0]["midi.velocity"])
            const velocity = chordNotes[0]["midi.velocity"] + translated
            const onset = chordNotes[0]['midi.onset'] + zeroGradient * (chordNotes[chordNotes.length - 1]["midi.onset"] - chordNotes[0]["midi.onset"]);
            points.push({ onset, velocity })
        }
    }

    return (
        <div>
            {createPortal((
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
                        onClick={transform}
                        startIcon={<Add />}
                    >
                        Insert {!currentDate && 'Default'}
                    </Button>
                </Ribbon>
            ), appBarRef.current || document.body)}

            <div style={{ width: '80vw', overflow: 'scroll' }}>
                <svg width={8000} height={200}>
                    {chordsGradients}

                    {points.length > 1 && points.slice(1).map((point, index) => {
                        const prevPoint = points[index]
                        const x1 = prevPoint.onset * stretchX
                        const y1 = height - (prevPoint.velocity / 127) * height
                        const x2 = point.onset * stretchX
                        const y2 = height - (point.velocity / 127) * height

                        return (
                            <line
                                key={index}
                                x1={x1}
                                y1={y1}
                                x2={x2}
                                y2={y2}
                                stroke="gray"
                                strokeWidth={1}
                            />
                        )
                    })}
                </svg>

                <div>{currentDate}</div>

                {currentDate && (
                    <GradientDetails
                        gradient={newGradient}
                        onChange={gradient => {
                            setNewGradient(gradient)
                        }}
                        open={currentDate !== undefined}
                        onClose={() => setCurrentDate(undefined)}
                        onDone={() => {
                            transform()
                            setCurrentDate(undefined)
                        }}
                    />
                )}

            </div>
        </div >
    )
}