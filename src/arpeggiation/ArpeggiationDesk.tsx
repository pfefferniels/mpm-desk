import { ChordMap } from "mpmify/lib/msm"
import { ArpeggioPlacement, InsertDynamicsGradient, InsertTemporalSpread } from "mpmify/lib/transformers"
import { SplitButton } from "./SplitButton"
import { ScopedTransformerViewProps } from "../DeskSwitch"
import { Chord } from "./Chord"

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
    const transform = (defaultPlacement: ArpeggioPlacement) => {
        const insertGradient = new InsertDynamicsGradient({
            part
        })

        const insertSpread = new InsertTemporalSpread({
            minimumArpeggioSize: 2,
            durationThreshold: 2,
            part,
            placement: new Map(),
            defaultPlacement,
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
