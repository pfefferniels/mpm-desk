import React, { useState } from 'react';
import { asMSM } from './asMSM';
import { MPM, MSM, Pipeline } from 'mpmify';
import { ExtractStyleDefinitions, InsertDynamicsInstructions, InsertTempoInstructions, InsertTemporalSpread, SimplifyTempo, TranslatePhyiscalTimeToTicks } from 'mpmify/lib/transformers';
import { read } from 'midifile-ts'
import { usePiano } from './hooks/usePiano';
import { Button, Grid, List, ListItem, ListItemButton, ListItemText, Stack } from '@mui/material';
import { TempoDesk } from './tempo/TempoDesk';
import { ArpeggiationDesk } from './arpeggiation/ArpeggiationDesk';

const aspects = ['arpeggiation', 'tempo', 'dynamics', 'result'] as const;
type Aspect = typeof aspects[number];

export const App = () => {
    const { play } = usePiano()
    const [msm, setMSM] = useState<MSM>();
    const [mpm, setMPM] = useState<MPM>(new MPM(2));
    const [selectedAspect, setSelectedAspect] = useState<Aspect>()

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files ? event.target.files[0] : null;
        if (!file) return
        const reader = new FileReader();
        reader.onload = async (e: ProgressEvent<FileReader>) => {
            const content = e.target?.result as string;
            setMSM(await asMSM(content));
        };
        reader.readAsText(file);
    };

    const handleFileImport = () => {
        const fileInput = document.getElementById('fileInput') as HTMLInputElement;
        fileInput.click();
    };

    const handleDownloadMSM = () => {
        if (!msm) return

        const element = document.createElement('a');
        const file = new Blob([msm.serialize(false)], { type: 'text/plain' });
        element.href = URL.createObjectURL(file);
        element.download = 'export.msm';
        document.body.appendChild(element); // Append the element to the body
        element.click(); // Simulate a click on the element
        document.body.removeChild(element); // Remove the element from the body
    };

    const generateMPM = () => {
        if (!msm) return

        const pipeline = new Pipeline()
        pipeline.push(new InsertTempoInstructions())
        const newMPM = new MPM(2)

        const translate = new TranslatePhyiscalTimeToTicks()
        const simplify = new SimplifyTempo()
        const insertTempo = new InsertTempoInstructions()
        const spread = new InsertTemporalSpread()
        const extract = new ExtractStyleDefinitions()
        const leftDynamics = new InsertDynamicsInstructions({ part: 0, beatLength: 0.125 })
        const rightDynamics = new InsertDynamicsInstructions({ part: 1, beatLength: 0.125 })

        spread.setNext(
            insertTempo.setNext(
                simplify.setNext(
                    translate.setNext(
                        extract.setNext(
                            leftDynamics.setNext(
                                rightDynamics
                            )
                        )
                    )
                ))
        )

        spread.transform(msm, newMPM)
        // pipeline.head?.transform(msm, newMPM)
        setMPM(newMPM)
    }

    const playMPM = async () => {
        if (!mpm || !msm) return

        const request = {
            mpm: mpm.serialize(),
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
    }

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            console.log("Content copied to clipboard successfully!");
        } catch (error) {
            console.error("Failed to copy content to clipboard: ", error);
        }
    };

    let main = null
    if (!msm || !mpm || !selectedAspect) {
        main = 'not yet ready'
    }
    else {
        switch (selectedAspect) {
            case 'arpeggiation':
                main = (
                    <ArpeggiationDesk
                        msm={msm}
                        mpm={mpm}
                        setMSM={setMSM}
                        setMPM={setMPM} />
                )
                break;
            case 'tempo':
                main = (
                    <TempoDesk
                        msm={msm}
                        mpm={mpm}
                        setMSM={setMSM}
                        setMPM={setMPM} />)
                break
            default:
                main = (
                    <pre style={{ margin: '1rem' }}>
                        {mpm && mpm.serialize()}
                    </pre>
                )
        }
    }

    return (
        <div>
            <Stack direction='row' spacing={1} p={1}>
                <Button variant='outlined' onClick={handleFileImport}>Import Aligned MEI</Button>
                <input
                    type="file"
                    id="fileInput"
                    accept='application/xml,.mei'
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                />
                {msm && (
                    <>
                        <Button variant='outlined' onClick={handleDownloadMSM}>Download MSM</Button>
                        <Button variant='outlined' onClick={generateMPM}>Generate MPM</Button>
                    </>
                )}
                {mpm && (
                    <>
                        <Button variant='outlined' onClick={() => playMPM()}>Play</Button>
                        <Button variant='outlined' onClick={() => copyToClipboard(mpm.serialize())}>Copy</Button>
                    </>
                )}
            </Stack>

            <Grid container>
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
                    {main}
                </Grid>
            </Grid>
        </div>
    );
};
