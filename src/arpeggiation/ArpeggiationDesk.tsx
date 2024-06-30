import { ChordMap, MsmNote } from "mpmify/lib/msm"
import { useRef, useState } from "react"
import { asMIDI, randomColor } from "../utils"
import { ArpeggioPlacement, InsertDynamicsGradient, InsertTemporalSpread } from "mpmify/lib/transformers"
import { SplitButton } from "./SplitButton"
import { ButtonGroup } from "@mui/material"
import { usePiano } from "react-pianosound"
import { ScopedTransformerViewProps } from "../DeskSwitch"
import { Part } from "../../../mpm-ts/lib"

interface ChordProps {
    notes: MsmNote[]
}

export const Chord = ({ notes }: ChordProps) => {
    const { play, stop } = usePiano()
    const [hovered, setHovered] = useState(false)
    const color = useRef(randomColor())

    const stretch = 30
    const height = 200

    if (notes.length <= 1) {
        return null
    }

    const firstOnset = notes[0]['midi.onset']
    const lastOnset = notes[notes.length - 1]['midi.onset']

    return (
        <g className='chord'>
            <rect
                onMouseOver={() => {
                    const midi = asMIDI(notes)
                    if (midi) {
                        stop()
                        play(midi)
                    }
                    setHovered(true)
                }}
                onMouseOut={() => {
                    stop()
                    setHovered(false)
                }}
                x={firstOnset * stretch}
                y={0}
                width={(lastOnset - firstOnset) * stretch}
                height={height}
                fill={color.current}
                fillOpacity={hovered ? 0.35 : 0.1} />

            {notes.map(note => {
                return (
                    <line
                        key={`instantNote_${note['xml:id']}`}
                        x1={note["midi.onset"] * stretch}
                        x2={note["midi.onset"] * stretch}
                        y1={0}
                        y2={height}
                        stroke={color.current}
                        strokeWidth={1} />
                )
            })}
        </g>
    )
}

interface ChordOverviewProps {
    chords: ChordMap
}

export const ChordOverview = ({ chords }: ChordOverviewProps) => {
    const c = []
    for (const notes of chords.values()) {
        const chordNotes = notes.slice().sort((a, b) => a["midi.onset"] - b["midi.onset"])
        c.push((
            <Chord notes={chordNotes} />
        ))
    }

    return (
        <g>
            {c}
        </g>
    )
}

export const ArpeggiationDesk = ({ msm, mpm, setMSM, setMPM, part }: ScopedTransformerViewProps) => {
    const transform = (placement: ArpeggioPlacement) => {
        const insertSpread = new InsertTemporalSpread({
            minimumArpeggioSize: 2,
            durationThreshold: 2,
            part: part as Part,
            placement,
            noteOffShiftTolerance: 2
        })

        const insertGradient = new InsertDynamicsGradient({
            part: part as Part
        })

        insertSpread.transform(msm, mpm)
        insertGradient.transform(msm, mpm)

        setMSM(msm.clone())
        setMPM(mpm.clone())
    }

    const options = [
        {
            label: 'All before beat',
            onClick: () => transform('before-beat')
        },
        {
            label: 'All on beat',
            onClick: () => transform('on-beat')
        },
        {
            label: 'Estimate',
            onClick: () => transform('estimate')
        }
    ]

    return (
        <div style={{ width: '80vw', overflow: 'scroll' }}>
            <ButtonGroup>

            </ButtonGroup>
            <svg width={10000}>
                <ChordOverview chords={msm.asChords(part as Part)} />
            </svg>
            <SplitButton options={options} />
        </div>
    )
}
