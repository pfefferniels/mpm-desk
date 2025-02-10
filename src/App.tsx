import React, { useState } from 'react';
import { asMSM } from './asMSM';
import { MPM, MSM, Pipeline } from 'mpmify';
import { read } from 'midifile-ts'
import { usePiano } from 'react-pianosound';
import { Button, Grid, IconButton, List, ListItem, ListItemButton, ListItemText, Stack } from '@mui/material';
import { Aspect, DeskSwitch, aspects } from './DeskSwitch';
import './App.css'
import { exportMPM } from '../../mpm-ts/lib';
import { FileOpen, PauseCircle, PlayCircle } from '@mui/icons-material';
import { TransformerStack } from './TransformerStack';
import { Transformer } from 'mpmify/lib/transformers/Transformer';

export const App = () => {
    const { play, stop } = usePiano()

    const [initialMSM, setInitialMSM] = useState<MSM>(new MSM());

    const [msm, setMSM] = useState<MSM>(new MSM());
    const [mpm, setMPM] = useState<MPM>(new MPM());

    const [transformers, setTransformers] = useState<Transformer[]>([])

    const [isPlaying, setIsPlaying] = useState(false)
    const [fileName, setFileName] = useState<string>()
    const [selectedAspect, setSelectedAspect] = useState<Aspect>('result')

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files ? event.target.files[0] : null;
        if (!file) return
        const reader = new FileReader();
        reader.onload = async (e: ProgressEvent<FileReader>) => {
            const content = e.target?.result as string;
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

    const reset = () => {
        setMPM(new MPM())
        if (initialMSM) setMSM(initialMSM.deepClone())
    }

    const run = () => {
        const pipeline = new Pipeline()
        transformers.forEach(t => {
            t.setNext(undefined)
            pipeline.push(t)
        })
        pipeline.head?.transform(msm, mpm)

        setMPM(mpm.clone())
        setMSM(msm.clone())
    }

    return (
        <>
            <Stack direction='column'>
                <Stack direction='row' spacing={1} p={1} sx={{ height: '5vh' }}>
                    <Button
                        variant='outlined'
                        onClick={handleFileImport}
                        startIcon={<FileOpen />}
                    >
                        {fileName || 'Import Aligned MEI'}
                    </Button>
                    <input
                        type="file"
                        id="fileInput"
                        accept='application/xml,.mei'
                        style={{ display: 'none' }}
                        onChange={handleFileChange}
                    />
                    {mpm && (
                        <>
                            <IconButton
                                onClick={() => isPlaying ? stopMPM() : playMPM()}
                            >
                                {isPlaying ? <PauseCircle /> : <PlayCircle />}
                            </IconButton>
                        </>
                    )}
                </Stack>

                <Grid container sx={{ minHeight: '90vh' }}>
                    <Grid item xs={2}>
                        <List>
                            {aspects.map(aspect => (
                                <ListItem key={`aspect_${aspect}`}>
                                    <ListItemButton
                                        selected={selectedAspect === aspect}
                                        onClick={() => setSelectedAspect(aspect)}>
                                        <ListItemText>{aspect}</ListItemText>
                                    </ListItemButton>
                                </ListItem>
                            ))}
                        </List>
                    </Grid>
                    <Grid item xs={10}>
                        <DeskSwitch
                            selectedAspect={selectedAspect}
                            mpm={mpm}
                            msm={msm}
                            setMPM={setMPM}
                            setMSM={setMSM}
                            addTransformer={(transformer) => setTransformers(prev => [...prev, transformer])}
                        />
                    </Grid>
                </Grid>
            </Stack>

            <div style={{ position: 'absolute', top: '2rem', right: '2rem' }}>
                <TransformerStack
                    transformers={transformers}
                    onSelect={() => { }}
                    onRemove={(transformer) => {
                        setTransformers(prev => prev.filter(t => t !== transformer))
                    }}
                    onReset={reset}
                    onRun={run}
                />
            </div>
        </>
    );
};
