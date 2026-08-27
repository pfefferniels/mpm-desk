import { ViewProps } from "../TransformerViewProps"
import { downloadAsFile } from "../../utils/utils"
import { exportMPM } from "../../fitting/instructions/index"
import { CopyAll, Download } from "@mui/icons-material"
import { renderExpressiveMidi } from "espressivo"
import { DeskToolbar } from "../../components/DeskToolbar"
import { ToolGroup } from "../../components/toolbar/ToolGroup"
import { ToolbarButton } from "../../components/toolbar/ToolbarButton"

// todo rename to debugdesk
export const ResultDesk = ({ mpm, msm }: ViewProps) => {
    const handleDownloadMPM = () => {
        downloadAsFile(exportMPM(mpm), 'export.mpm', 'application/xml')
    }

    /**
     * The performance as MIDI.
     *
     * Rendered in the browser by espressivo, in about forty milliseconds — no backend involved.
     */
    const handleDownloadMIDI = () => {
        try {
            const midi = renderExpressiveMidi({ msm: msm.serializeScore() ?? '', mpm: exportMPM(mpm) })
            downloadAsFile(new Blob([midi as BlobPart]), 'export.midi', 'audio/midi')
        } catch (error) {
            console.error('Failed to export MIDI:', error)
        }
    }

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // clipboard write failed silently
        }
    };

    return (
        <div>
            {/*
                One group, captioned "Document", because all three act on the whole document
                across every aspect — which is what separates them from a desk's own edits, and
                is the caption `TempoDesk` already files Translate To Ticks under.

                They were a `<Stack direction='row'>` at the *foot* of the page, underneath an
                80vw × 70vh scrolling `<pre>` of the entire file. Two things were wrong with
                that and only one of them was placement. The actions were reachable only after
                scrolling past the thing they act on, so a desk whose whole job is "get this out
                of the editor" hid its exits; and two of the three were `variant='contained'`,
                which said this desk had two principal actions. The MPM *is* the artefact this
                editor writes — the MIDI is a rendering of it and the clipboard is a convenience
                — so exactly one of them is `primary`.

                Each carries a `label` as well as a `tooltip`: the tooltips are sentences saying
                what the file will be, and a sentence makes a poor accessible name.
            */}
            <DeskToolbar>
                <ToolGroup label='Document'>
                    <ToolbarButton
                        primary
                        icon={<Download />}
                        label='Download MPM'
                        tooltip='Save the performance markup itself, as an .mpm file'
                        onClick={handleDownloadMPM}
                    >
                        Download MPM
                    </ToolbarButton>
                    <ToolbarButton
                        icon={<Download />}
                        label='Download MIDI'
                        tooltip='Render the performance to a MIDI file and save it'
                        onClick={handleDownloadMIDI}
                    >
                        Download MIDI
                    </ToolbarButton>
                    <ToolbarButton
                        icon={<CopyAll />}
                        label='Copy to Clipboard'
                        tooltip='Copy the performance markup to the clipboard'
                        onClick={() => copyToClipboard(exportMPM(mpm))}
                    >
                        Copy to Clipboard
                    </ToolbarButton>
                </ToolGroup>
            </DeskToolbar>

            <div style={{ width: '80vw', height: '70vh', overflow: 'scroll' }}>
                <pre style={{ margin: '1rem' }}>
                    {mpm && exportMPM(mpm)}
                </pre>
                <pre style={{ margin: '2rem', color: 'blue' }}>
                    {msm && msm.serialize()}
                </pre>
            </div>
        </div>
    )
}
