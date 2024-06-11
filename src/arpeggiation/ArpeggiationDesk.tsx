import { ChordMap, MsmNote } from "mpmify/lib/msm"
import { TransformerViewProps } from "../TransformerViewProps"
import { useRef } from "react"
import { randomColor } from "../utils"
import { ArpeggioPlacement, InsertTemporalSpread } from "mpmify/lib/transformers"
import { SplitButton } from "./SplitButton"
import { ButtonGroup } from "@mui/material"

interface ChordProps {
    notes: MsmNote[]
}

export const Chord = ({ notes }: ChordProps) => {
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
                x={firstOnset * stretch}
                y={0}
                width={(lastOnset - firstOnset) * stretch}
                height={height}
                fill={color.current}
                fillOpacity={0.3} />

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
        notes.sort((a, b) => a["midi.onset"] - b["midi.onset"])
        c.push((
            <Chord notes={notes} />
        ))
    }

    return (
        <g>
            {c}
        </g>
    )
}

export const ArpeggiationDesk = ({ msm, mpm, setMSM, setMPM }: TransformerViewProps) => {
    const transform = (placement: ArpeggioPlacement) => {
        const insert = new InsertTemporalSpread({
            minimumArpeggioSize: 2,
            durationThreshold: 2,
            part: 'global',
            placement,
            noteOffShiftTolerance: 2
        })

        insert.transform(msm, mpm)

        setMSM(msm.clone())
        setMPM(mpm.clone())
    }

    const options = [
        {
            label: 'All before beat',
            onClick: () => transform('before-beat')
        },
        {
            label:'All on beat',
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
                <ChordOverview chords={msm.asChords()} />
            </svg>
            <SplitButton options={options} />
        </div>
    )
}
