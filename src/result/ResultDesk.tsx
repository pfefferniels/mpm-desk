import { Button, Stack } from "@mui/material"
import { ViewProps } from "../TransformerViewProps"
import { downloadAsFile } from "../utils/utils"
import { exportMPM } from "../../../mpm-ts/lib"
import { CopyAll, Download } from "@mui/icons-material"

export const ResultDesk = ({ mpm, msm }: ViewProps) => {
    const handleDownloadMPM = () => {
        downloadAsFile(exportMPM(mpm), 'export.mpm', 'application/xml')
    }

    const handleDownloadMIDI = async () => {
        const request = {
            mpm: exportMPM(mpm)
        }

        console.log(`Converting to MIDI ...`)
        const response = await fetch(`http://localhost:8080/convert`, {
            method: 'POST',
            body: JSON.stringify(request)
        })

        const midiBuffer = await response.arrayBuffer()
        downloadAsFile(midiBuffer, 'export.midi', 'audio/midi')
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
            <div style={{ width: '80vw', height: '70vh', overflow: 'scroll' }}>
                <pre style={{ margin: '1rem' }}>
                    {mpm && exportMPM(mpm)}
                </pre>
                <pre style={{ margin: '2rem', color: 'blue' }}>
                    {msm && msm.serialize(false)}
                </pre>
            </div>

            <Stack direction='row' spacing={1}>
                <Button
                    variant='contained'
                    onClick={handleDownloadMPM}
                    startIcon={<Download />}
                >
                    Download MPM
                </Button>
                <Button
                    variant='contained'
                    onClick={handleDownloadMIDI}
                    startIcon={<Download />}
                >
                    Download MIDI
                </Button>
                <Button
                    variant='outlined'
                    onClick={() => copyToClipboard(exportMPM(mpm))}
                    startIcon={<CopyAll />}
                >
                    Copy to Clipboard
                </Button>
            </Stack>
        </div>
    )
}
