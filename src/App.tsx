import React, { useState } from 'react';
import { asMSM } from './asMSM';
import { MPM, MSM } from 'mpmify';
import { read } from 'midifile-ts'
import { usePiano } from 'react-pianosound';
import { AppBar, Button, Card, IconButton, ListItem, ListItemButton, ListItemText, MenuList, Stack, Tooltip, Typography } from '@mui/material';
import { AnyTransformer, Aspect, DeskSwitch, aspects } from './DeskSwitch';
import './App.css'
import { exportMPM } from '../../mpm-ts/lib';
import { CopyAllRounded, FileOpen, PauseCircle, PlayCircle } from '@mui/icons-material';
import { TransformerStack } from './transformer-stack/TransformerStack';
import { Transformer } from 'mpmify/lib/transformers/Transformer';
import { v4 } from 'uuid';
import { MsmNote } from 'mpmify/lib/msm';

const injectInstructions = (mei: string, msm: MSM, mpm: MPM): string => {
    const meiDoc = new DOMParser().parseFromString(mei, 'application/xml')

    const instructions = mpm.getInstructions()
    for (const instruction of instructions) {
        let notes: MsmNote[] = []
        if (instruction.noteid) {
            notes = instruction.noteid
                .split(' ')
                .map(id => msm.getByID(id.slice(1)))
                .filter(note => !!note)
        }
        else {
            // TODO: take scope into account
            notes = msm.notesAtDate(instruction.date, 'global')
        }
        if (notes.length === 0) continue

        const plist = notes.map(note => `#${note['xml:id']}`).join(' ')
        const corresp = meiDoc.querySelector(`*[*|id=${notes[0]['xml:id']}]`)
        if (!corresp) continue

        const measure = corresp.closest('measure')
        if (!measure) continue

        const annot = meiDoc.createElementNS('http://www.music-encoding.org/ns/mei', 'dir')
        annot.setAttribute('xml:id', `dir-${v4().slice(0, 8)}`)
        annot.setAttribute('plist', plist)
        annot.setAttribute('startid', `#${notes[0]['xml:id']}`)
        annot.setAttribute('corresp', `#${instruction['xml:id']}`)
        annot.textContent = instruction.type
        const comment = meiDoc.createComment(
            Object.entries(instruction)
                .filter(([k, v]) => (
                    !['date', 'xml:id', 'type', 'corresp', 'noteid'].includes(k) &&
                    v !== undefined
                ))
                .map(([k, v]) => `${k}: ${v}`)
                .join(', ')
        );
        annot.appendChild(comment);
        measure.appendChild(annot)
    }

    return new XMLSerializer().serializeToString(meiDoc)
}

export const App = () => {
    const { play, stop } = usePiano()

    const [initialMSM, setInitialMSM] = useState<MSM>(new MSM());

    const [msm, setMSM] = useState<MSM>(new MSM());
    const [mpm, setMPM] = useState<MPM>(new MPM());
    const [mei, setMEI] = useState<string>()

    const [transformers, setTransformers] = useState<Transformer[]>([])
    const [activeTransformer, setActiveTransformer] = useState<Transformer>()

    const [isPlaying, setIsPlaying] = useState(false)
    const [fileName, setFileName] = useState<string>()
    const [selectedAspect, setSelectedAspect] = useState<Aspect>('metadata')

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files ? event.target.files[0] : null;
        if (!file) return
        const reader = new FileReader();
        reader.onload = async (e: ProgressEvent<FileReader>) => {
            const content = e.target?.result as string;
            setMEI(content);
            setMSM(await asMSM(content));
            setInitialMSM(await asMSM(content));
            setFileName(file.name)
        };
        reader.readAsText(file);
    };

    const handleFileImport = () => {
        const fileInput = document.getElementById('fileInput') as HTMLInputElement;
        fileInput.click();
    };

    const playMPM = async () => {
        if (!mpm || !msm) return

        const request = {
            mpm: exportMPM(mpm),
            msm: msm.serialize(false)
        }

        console.log(`Converting to MIDI ...`)
        const response = await fetch(`http://localhost:8080/convert`, {
            method: 'POST',
            body: JSON.stringify(request)
        })

        const midiBuffer = await response.arrayBuffer()
        const file = read(midiBuffer)
        play(file)

        setIsPlaying(true)
    }

    const stopMPM = () => {
        stop()
        setIsPlaying(false)
    }

    const reset = (newTransformers: Transformer[]) => {
        const newMPM = new MPM()
        const newMSM = initialMSM ? initialMSM.deepClone() : new MSM()

        newTransformers.forEach(t => {
            t.run(newMSM, newMPM)
        })

        setMPM(newMPM)
        setMSM(newMSM)
        setTransformers(newTransformers)
    }

    const wasCreatedBy = (id: string): InstanceType<AnyTransformer> | undefined => {
        return transformers.find(t => t.created.includes(id)) as InstanceType<AnyTransformer> | undefined
    }

    return (
        <>
            <AppBar position='static' color='transparent'>
                <Stack direction='row'>
                    {fileName && (
                        <Typography component="div" sx={{ padding: '0.5rem' }}>
                            {fileName}
                        </Typography>)
                    }

                    <Tooltip title='Import MEI file' arrow>
                        <Button
                            onClick={handleFileImport}
                            startIcon={<FileOpen />}
                        >
                            Open
                        </Button>
                    </Tooltip>

                    <input
                        type="file"
                        id="fileInput"
                        accept='application/xml,.mei'
                        style={{ display: 'none' }}
                        onChange={handleFileChange}
                    />
                    {(mpm.getInstructions().length > 0) && (
                        <>
                            <IconButton
                                onClick={() => isPlaying ? stopMPM() : playMPM()}
                            >
                                {isPlaying ? <PauseCircle /> : <PlayCircle />}
                            </IconButton>

                            {mei && (
                                <IconButton
                                    onClick={async () => {
                                        console.log('parsing mei', mei)
                                        const newMEI = injectInstructions(mei, msm, mpm)
                                        const result = await navigator.clipboard.writeText(newMEI)
                                        console.log('MEI copied to clipboard', result)
                                    }}
                                >
                                    <CopyAllRounded />
                                </IconButton>
                            )}
                        </>
                    )}
                </Stack>
            </AppBar>

            <Card sx={{
                backdropFilter: 'blur(17px)',
                background: 'rgba(255, 255, 255, 0.4)',
                margin: '1rem',
                position: 'absolute',
                top: '4rem',
                left: '1rem',
                zIndex: 1000
            }}>
                <MenuList dense>
                    {aspects.map(aspect => (
                        <ListItem key={`aspect_${aspect}`}>
                            <ListItemButton
                                selected={selectedAspect === aspect}
                                onClick={() => setSelectedAspect(aspect)}>
                                <ListItemText>{aspect}</ListItemText>
                            </ListItemButton>
                        </ListItem>
                    ))}
                </MenuList>
            </Card>

            <DeskSwitch
                aspect={selectedAspect}
                changeAspect={setSelectedAspect}
                mpm={mpm}
                msm={msm}
                setMPM={setMPM}
                setMSM={setMSM}
                addTransformer={(transformer) => {
                    const newTransformers = [...transformers, transformer]

                    transformer.argumentation = {
                        description: '',
                        id: `decision-${v4().slice(0, 8)}`
                    }

                    transformer.run(msm, mpm)
                    setTransformers(newTransformers)
                    setMSM(msm.clone())
                    setMPM(mpm.clone())
                }}
                wasCreatedBy={wasCreatedBy}
                activeTransformer={activeTransformer}
                setActiveTransformer={setActiveTransformer}
            />

            <div style={{ position: 'absolute', top: '2rem', right: '2rem' }}>
                <TransformerStack
                    transformers={transformers}
                    setTransformers={setTransformers}
                    onSelect={transformer => setActiveTransformer(transformer)}
                    onRemove={transformer => reset(transformers.filter(t => t !== transformer))}
                    onReset={() => reset(transformers)}
                    activeTransformer={activeTransformer}
                />
            </div>
        </>
    );
};
