import { ChordMap, MsmNote } from "mpmify/lib/msm"
import { useState } from "react"
import { asMIDI } from "../utils"
import { ArpeggioPlacement, InsertDynamicsGradient, InsertTemporalSpread } from "mpmify/lib/transformers"
import { SplitButton } from "./SplitButton"
import { usePiano } from "react-pianosound"
import { ScopedTransformerViewProps } from "../DeskSwitch"

interface ChordProps {
    notes: MsmNote[]
}

export const Chord = ({ notes }: ChordProps) => {
    const { play, stop } = usePiano()
    const [hovered, setHovered] = useState(false)

    const stretch = 30
    const height = 200

    if (notes.length <= 1) {
        return null
    }

    const firstOnset = notes[0]['midi.onset']
    const lastOnset = notes[notes.length - 1]['midi.onset']
    const frameLength = lastOnset - firstOnset

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
                width={frameLength * stretch}
                height={height}
                fill='gray'
                fillOpacity={hovered ? 0.35 : 0.1} />

            {notes.map(note => {
                return (
                    <line
                        key={`instantNote_${note['xml:id']}`}
                        x1={note["midi.onset"] * stretch}
                        x2={note["midi.onset"] * stretch}
                        y1={0}
                        y2={height}
                        stroke='gray'
                        strokeWidth={1} />
                )
            })}

            {frameLength !== 0 && (
                <text
                    x={(firstOnset + frameLength / 2) * stretch}
                    y={height / 2}
                    textAnchor="middle"
                    fill='black'
                    opacity={hovered ? 1 : 0.2}
                    fontSize={hovered ? 14 : 10}
                    fontWeight={hovered ? 'bold' : 'normal'}
                >
                    {(frameLength * 1000).toFixed(0)}ms
                </text>
            )}
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
            <Chord
                key={`chordNotes_${chordNotes[0]["xml:id"]}`}
                notes={chordNotes}
            />
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
        const insertGradient = new InsertDynamicsGradient({
            part
        })

        const insertSpread = new InsertTemporalSpread({
            minimumArpeggioSize: 2,
            durationThreshold: 2,
            part,
            placement,
            noteOffShiftTolerance: 2
        })

        insertGradient.transform(msm, mpm)
        insertSpread.transform(msm, mpm)

        insertGradient.insertMetadata(mpm)
        insertSpread.insertMetadata(mpm)

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
        <div>
            <div style={{ width: '80vw', overflow: 'scroll' }}>
                <svg width={10000}>
                    <ChordOverview chords={msm.asChords(part)} />
                </svg>
            </div>
            <SplitButton options={options} />
        </div>
    )
}
