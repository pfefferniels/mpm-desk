import React, { useState } from 'react';
import { asMSM } from './asMSM';
import { MPM, MSM, Pipeline } from 'mpmify';
import { ExtractStyleDefinitions, InsertDynamicsInstructions, InsertTempoInstructions, InsertTemporalSpread, SimplifyTempo, TranslatePhyiscalTimeToTicks } from 'mpmify/lib/transformers';
import { read } from 'midifile-ts'
import { usePiano } from './hooks/usePiano';

export const App = () => {
    const { play } = usePiano()
    const [msm, setMSM] = useState<MSM>();
    const [mpm, setMPM] = useState<MPM>();

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files ? event.target.files[0] : null;
        if (file && file.name.endsWith('.mei')) {
            const reader = new FileReader();
            reader.onload = async (e: ProgressEvent<FileReader>) => {
                const content = e.target?.result as string;
                setMSM(await asMSM(content));
            };
            reader.readAsText(file);
        } else {
            alert('Please select a MEI file.');
        }
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


    return (
        <div>
            <button onClick={handleFileImport}>Import Aligned MEI</button>
            <input
                type="file"
                id="fileInput"
                style={{ display: 'none' }}
                onChange={handleFileChange}
            />
            {msm && (
                <>
                    <button onClick={handleDownloadMSM}>Download MSM</button>
                    <button onClick={generateMPM}>Generate MPM</button>
                </>
            )}
            {mpm && (
                <>
                    <button onClick={() => playMPM()}>Play</button>
                    <button onClick={() => copyToClipboard(mpm.serialize())}>Copy</button>
                    <pre style={{ margin: '1rem' }}>
                        {mpm.serialize()}
                    </pre>
                </>
            )}
        </div>
    );
};
