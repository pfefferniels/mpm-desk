import { Button } from "@mui/material"
import { TransformerViewProps } from "../TransformerViewProps"
import { downloadAsFile } from "../utils"

export const ResultDesk = ({ mpm }: TransformerViewProps) => {
    const handleDownload = () => {
        downloadAsFile(mpm.serialize(), 'export.mpm', 'application/xml')
    }

    return (
        <div>
            <div style={{ width: '80vw', height: '70vh', overflow: 'scroll' }}>
                <pre style={{ margin: '1rem' }}>
                    {mpm && mpm.serialize()}
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
