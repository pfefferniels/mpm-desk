import { useEffect, useState } from "react";
import { Dynamics } from "../../../mpm-ts/lib";
import { usePiano } from "react-pianosound";
import { useNotes } from "../hooks/NotesProvider";
import { asMIDI, downloadAsFile } from "../utils";
import { Scope, ScopedTransformerViewProps } from "../DeskSwitch";
import { MSM, MsmNote } from "mpmify/lib/msm";
import { expandRange, Range } from "../tempo/Tempo";
import { DynamicsWithEndDate, InsertDynamicsInstructions } from "mpmify/lib/transformers";
import { Box, Button, Stack, ToggleButton } from "@mui/material";
import { CurveSegment } from "./CurveSegment";
import { DynamicsCircle } from "./DynamicsCircle";
import { VerticalScale } from "./VerticalScale";

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

export const DynamicsDesk = ({ part, msm, mpm, setMSM, setMPM }: ScopedTransformerViewProps) => {
    const { play, stop } = usePiano()
    const { slice } = useNotes()

    const [datePlayed, setDatePlayed] = useState<number>()
    const [segments, setSegments] = useState<DynamicsSegment[]>([])
    const [editMode, setCombinationMode] = useState(false)
    const [markers, setMarkers] = useState<number[]>([])
    const [instructions, setInstructions] = useState<DynamicsWithEndDate[]>([])

    useEffect(() => {
        setMarkers([])

        const dynamics = mpm.getInstructions<Dynamics>('dynamics', part)
        const withEndDate = []
        for (let i = 0; i < dynamics.length - 1; i++) {
            withEndDate.push({
                ...dynamics[i],
                endDate: dynamics[i + 1].date
            })
        }
        setInstructions(withEndDate)
    }, [mpm, part])

    const stretchY = 3
    const stretchX = 0.03
    const margin = 20

    useEffect(() => setSegments(extractDynamicsSegments(msm, part)), [msm, part])

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files ? event.target.files[0] : null;
        if (!file) return
        const reader = new FileReader();
        reader.onload = async (e: ProgressEvent<FileReader>) => {
            const content = e.target?.result as string;
            const json = JSON.parse(content)
            if (!Array.isArray(json)) {
                console.log('Invalid JSON file provided.')
                return
            }

            setMarkers(json)
        };

        reader.readAsText(file);
    };

    const handleFileImport = () => {
        const fileInput = document.getElementById('markersInput') as HTMLInputElement;
        fileInput.click();
    };

    const handleInsert = () => {
        const insert = new InsertDynamicsInstructions({
            part: part,
            markers: markers
        })

        mpm.removeInstructions('dynamics', part)
        insert.transform(msm, mpm)
        insert.insertMetadata(mpm)

        setMSM(msm.clone())
        setMPM(mpm.clone())
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
        setMarkers(prev => [...prev, date].sort())
    }

    const removeMarker = (date: number) => {
        setMarkers(prev => {
            const index = prev.indexOf(date)
            if (index !== -1) {
                prev.splice(index, 1)
            }
            return [...prev]
        })
    }

    const handleClick = (e: MouseEvent, segment: DynamicsSegment) => {
        if (!editMode) {
            insertMarker(segment.date.start)
            return
        }

        if (e.altKey && e.shiftKey) {
            const index = segments.indexOf(segment)
            if (index !== -1) {
                segments.splice(index, 1)
                setSegments([...segments])
            }
        }
        if (e.shiftKey) {
            const active = segments.find(s => s.active)
            if (!active) return
            active.date = expandRange(active.date, segment.date)
            active.velocity = (active.velocity + segment.velocity) / 2
            setSegments([...segments])
        }
        else {
            const active = segments.find(s => s.active)
            if (active) active.active = false

            setSegments([...segments, {
                date: {
                    start: segment.date.start,
                    end: segment.date.end
                },
                velocity: segment.velocity,
                active: true
            }])
        }
    }

    const circles: JSX.Element[] = segments.map((segment, i) => {
        return (
            <DynamicsCircle
                key={`velocity_segment_${segment.date}_${i}`}
                segment={segment}
                datePlayed={datePlayed}
                stretchX={stretchX}
                stretchY={stretchY}
                handlePlay={handlePlay}
                handleClick={handleClick}
            />
        )
    })

    const markerLines = markers.map(date => {
        return (
            <line
                x1={date * stretchX}
                x2={date * stretchX}
                y1={350}
                y2={350 - 100 * stretchY}
                stroke={'black'}
                strokeWidth={2}
                key={`velocity_segment_${date}`}
                fill='black'
                onClick={() => removeMarker(date)} />
        )
    })

    const curves = instructions.map(i => {
        return (
            <CurveSegment instruction={i} stretchX={stretchX} stretchY={stretchY} />
        )
    })

    return (
        <div style={{ height: '400' }}>
            <Box sx={{ m: 1 }}>{part !== 'global' && `Part ${part + 1}`}</Box>
            <Stack direction='row' spacing={1}>
                <Button variant='contained' onClick={handleInsert}>Insert into MPM</Button>
                <Button variant='outlined' onClick={() => {
                    downloadAsFile(JSON.stringify(markers, null, 4), 'dynamics_markers.json')
                }}>Export Markers</Button>
                <Button variant='outlined' onClick={handleFileImport}>Import Markers</Button>
                <input
                    type="file"
                    id="markersInput"
                    accept='*.json'
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                />

                <ToggleButton
                    value='check'
                    size='small'
                    selected={editMode}
                    onChange={() => setCombinationMode(!editMode)}
                >
                    Edit Volumes
                </ToggleButton>
            </Stack>

            <svg
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
                <VerticalScale min={30} max={80} step={5} stretchY={stretchY} />
                {curves}
                {circles}
                {markerLines}
            </svg>
        </div>
    )
}
