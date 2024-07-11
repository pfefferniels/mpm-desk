import { Button } from "@mui/material"
import { TransformerViewProps } from "../TransformerViewProps"
import { downloadAsFile } from "../utils"
import { exportMPM } from "../../../mpm-ts/lib"

export const ResultDesk = ({ mpm }: TransformerViewProps) => {
    const handleDownload = () => {
        downloadAsFile(exportMPM(mpm), 'export.mpm', 'application/xml')
    }

    return (
        <div>
            <div style={{ width: '80vw', height: '70vh', overflow: 'scroll' }}>
                <pre style={{ margin: '1rem' }}>
                    {mpm && exportMPM(mpm)}
                </pre>
            </div>

            <Button
                variant='contained'
                onClick={handleDownload}>
                Download
            </Button>
        </div>
    )
}
