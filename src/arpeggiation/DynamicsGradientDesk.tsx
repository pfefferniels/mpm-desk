import { DatedDynamicsGradient, InsertDynamicsGradient } from "mpmify"
import { ScopedTransformerViewProps } from "../DeskSwitch"
import { Button, Checkbox, FormControlLabel } from "@mui/material"
import { useEffect, useState } from "react"
import { ChordGradient } from "./ChordGradient"
import GradientDetails from "./GradientDetails"
import { ZoomControls } from "../ZoomControls"

export const DynamicsGradientDesk = ({ msm, addTransformer, part, activeTransformer }: ScopedTransformerViewProps<InsertDynamicsGradient>) => {
    const [currentDate, setCurrentDate] = useState<number>()
    const [gradients, setGradients] = useState<DatedDynamicsGradient>(new Map())
    const [sortVelocities, setSortVelocities] = useState(true)
    const [stretchX, setStretchX] = useState(20)

    useEffect(() => {
        if (!activeTransformer) return

        setGradients(activeTransformer.options.gradients)
        setSortVelocities(activeTransformer.options.sortVelocities)
    }, [activeTransformer])

    const transform = () => {
        addTransformer(activeTransformer || new InsertDynamicsGradient(), {
            part,
            gradients,
            sortVelocities
        })
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
                    gradient = { from: -1, to: 0 }
                }
                else {
                    gradient = { from: 0, to: -1 }
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
            <FormControlLabel
                control={
                    <Checkbox
                        checked={sortVelocities}
                        onChange={(e) => setSortVelocities(e.target.checked)}
                        color="primary"
                    />
                }
                label="Sort Velocities"
            />
            <Button
                variant='contained'
                onClick={transform}
                style={{ marginTop: '1rem' }}
            >
                {activeTransformer ? 'Update' : 'Insert'} Dynamics Gradients
            </Button>

            <ZoomControls
                stretchX={stretchX}
                setStretchX={setStretchX}
                rangeX={[1, 40]}
            />

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

                <GradientDetails
                    setGradient={(gradient) => {
                        if (!currentDate) return
                        gradients.set(currentDate, gradient)
                        setGradients(new Map(gradients))
                    }}
                    gradient={currentDate ? gradients.get(currentDate) : undefined}
                    open={!!currentDate}
                    onClose={() => setCurrentDate(undefined)}
                />

            </div>
        </div >
    )
}