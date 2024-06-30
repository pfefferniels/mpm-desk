import { useState } from "react";
import { Part } from "../../../mpm-ts/lib";
import { usePiano } from "react-pianosound";
import { useNotes } from "../hooks/NotesProvider";
import { asMIDI } from "../utils";
import { ScopedTransformerViewProps } from "../DeskSwitch";

export const DynamicsDesk = ({ part, msm }: ScopedTransformerViewProps) => {
    const { play, stop } = usePiano()
    const { slice } = useNotes()

    const [datePlayed, setDatePlayed] = useState<number>()

    const stretchY = 5
    const margin = 10

    const handlePlay = (from: number, to?: number) => {
        let notes = slice(from, to)
        if (typeof part === 'number') notes = notes.filter(note => note.part - 1 === part)
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

    const circles: JSX.Element[] = []
    msm.asChords(part as Part).forEach((notes, date) => {
        if (!notes.length) return

        for (const note of notes) {
            circles.push((
                <circle
                    cx={date * 0.03 + margin}
                    cy={350 - note["midi.velocity"] * stretchY}
                    key={`velocity_${note["xml:id"]}`}
                    r={3}
                    fill={datePlayed === note.date ? 'blue' : 'black'}
                    onMouseOver={() => handlePlay(note.date, note.date + note.duration)}
                    onClick={() => handlePlay(note.date)} />
            ))
        }
    })

    return (
        <div>
            {part !== 'global' && <div>Part {part + 1}</div>}
            <svg width={1000} height={300}>
                {circles}
            </svg>
        </div>
    )
}

