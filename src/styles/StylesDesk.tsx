import { Button } from "@mui/material";
import { TransformerViewProps } from "../TransformerViewProps";
import { ExtractStyleDefinitions } from "mpmify/lib/transformers";
import { Ornament } from "../../../mpm-ts/lib";

export const StylesDesk = ({ msm, mpm, setMSM, setMPM }: TransformerViewProps) => {
    const transform = () => {
        const extract = new ExtractStyleDefinitions()

        extract.transform(msm, mpm)

        setMSM(msm.clone())
        setMPM(mpm.clone())
    }
    return (
        <div style={{ width: '80vw', overflow: 'scroll' }}>
            <div>
                Candidates for style extraction: {mpm.getInstructions<Ornament>('ornament').filter(o => o["frame.start"] !== undefined).length}
            </div>

            <Button
                variant='contained'
                onClick={transform}
            >
                Extract Styles
            </Button>
        </div>
    )
}
