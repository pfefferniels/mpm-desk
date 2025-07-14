import { useEffect, useRef, useState } from "react";
import { Dynamics } from "../../../mpm-ts/lib";
import { usePiano } from "react-pianosound";
import { useNotes } from "../hooks/NotesProvider";
import { asMIDI, downloadAsFile } from "../utils/utils";
import { Scope, ScopedTransformerViewProps } from "../TransformerViewProps";
import { MSM, MsmNote } from "mpmify/lib/msm";
import { Range } from "../tempo/Tempo";
import { DynamicsWithEndDate, InsertDynamicsInstructions } from "mpmify/lib/transformers";
import { Box, Button, Stack, ToggleButton } from "@mui/material";
import { CurveSegment } from "./CurveSegment";
import { DynamicsCircle } from "./DynamicsCircle";
import { VerticalScale } from "./VerticalScale";
import { useSymbolicZoom } from "../hooks/ZoomProvider";
import { createPortal } from "react-dom";
import { Ribbon } from "../Ribbon";
import { Add, Clear, FileOpen, Save } from "@mui/icons-material";

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

export const DynamicsDesk = ({ part, msm, mpm, addTransformer, activeElements, setActiveElement, appBarRef }: ScopedTransformerViewProps<InsertDynamicsInstructions>) => {
    const { play, stop } = usePiano()
    const { slice } = useNotes()

    const [datePlayed, setDatePlayed] = useState<number>()
    const [segments, setSegments] = useState<DynamicsSegment[]>([])
    const [phantomVelocities, setPhantomVelocities] = useState<Map<number, number>>(new Map())
    const [currentPhantomDate, setCurrentPhantomDate] = useState<number>()
    const [phantomMode, setPhantomMode] = useState(false)
    const [markers, setMarkers] = useState<number[]>([])
    const [instructions, setInstructions] = useState<DynamicsWithEndDate[]>([])
    const stretchX = useSymbolicZoom()

    const svgRef = useRef<SVGSVGElement>(null);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return

            e.preventDefault()
            if (!currentPhantomDate || !phantomMode) return

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
    }, [currentPhantomDate, phantomMode]);

    useEffect(() => {
        setMarkers([])

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
    }, [mpm, part])

    const stretchY = 3
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
        addTransformer(new InsertDynamicsInstructions({
            markers,
            phantomVelocities,
            scope: part
        }))
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

    const handleClick = (_: MouseEvent, segment: DynamicsSegment) => {
        if (phantomMode) {
            phantomVelocities.set(segment.date.start, segment.velocity)
            setPhantomVelocities(new Map(phantomVelocities))
            setCurrentPhantomDate(segment.date.start)
            return
        }
        insertMarker(segment.date.start)
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
        circles.push(
            <DynamicsCircle
                key={`velocity_segment_${segment.date}_${i}`}
                segment={segment}
                datePlayed={datePlayed}
                stretchX={stretchX}
                screenY={(velocity: number) => (127 - velocity) * stretchY}
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
        <div style={{ height: '400', overflow: 'scroll' }}>
            <Box sx={{ m: 1 }}>{part !== 'global' && `Part ${part + 1}`}</Box>
            <Stack direction='row' spacing={1} sx={{ position: 'sticky', left: 0 }}>
                {createPortal((
                    <>
                        <Ribbon title='Dynamics'>
                            <Button
                                startIcon={<Add />}
                                size='small'
                                variant='contained'
                                onClick={handleInsert}
                            >
                                Insert
                            </Button>
                        </Ribbon>
                        <Ribbon title='Markers'>
                            <Button
                                variant='outlined'
                                size='small'
                                onClick={() => {
                                    downloadAsFile(JSON.stringify(markers, null, 4), 'dynamics_markers.json')
                                }}
                                startIcon={<Save />}
                            >
                                Export
                            </Button>

                            <Button
                                variant='outlined'
                                size='small'
                                onClick={handleFileImport}
                                startIcon={<FileOpen />}
                            >
                                Import
                            </Button>
                            <input
                                type="file"
                                id="markersInput"
                                accept='*.json'
                                style={{ display: 'none' }}
                                onChange={handleFileChange}
                            />

                            <Button
                                variant='outlined'
                                size='small'
                                onClick={() => setMarkers(segments.map(s => s.date.start).sort())}
                            >
                                Insert from Points
                            </Button>
                        </Ribbon>
                        <Ribbon title='Phantoms'>
                            <ToggleButton
                                value='check'
                                size='small'
                                selected={phantomMode}
                                onChange={() => setPhantomMode(!phantomMode)}
                            >
                                Edit Velocity
                            </ToggleButton>
                            <Button
                                size='small'
                                variant='outlined'
                                onClick={() => setPhantomVelocities(new Map())}
                                startIcon={<Clear />}
                            >
                                Clear
                            </Button>
                        </Ribbon>
                    </>
                ), appBarRef.current || document.body)}
            </Stack>

            <svg
                ref={svgRef}
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
