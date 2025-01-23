import { Button, Stack } from "@mui/material"
import { TransformerViewProps } from "../TransformerViewProps"
import { downloadAsFile } from "../utils"
import { exportMPM } from "../../../mpm-ts/lib"
import { CopyAll, Download } from "@mui/icons-material"

export const ResultDesk = ({ mpm }: TransformerViewProps) => {
    const handleDownload = () => {
        downloadAsFile(exportMPM(mpm), 'export.mpm', 'application/xml')
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
            </div>

            <Stack direction='row' spacing={1}>
                <Button
                    variant='contained'
                    onClick={handleDownload}
                    startIcon={<Download />}
                >
                    Download
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
