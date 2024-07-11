import { Button } from "@mui/material";
import { TransformerViewProps } from "../TransformerViewProps";
import { StylizeArticulation, StylizeOrnamentation } from "mpmify/lib/transformers";
import { Ornament } from "../../../mpm-ts/lib";

export const StylesDesk = ({ msm, mpm, setMSM, setMPM }: TransformerViewProps) => {
    const transform = () => {
        const stylizeOrnaments = new StylizeOrnamentation()
        const stylizeArticulation = new StylizeArticulation()

        stylizeOrnaments.transform(msm, mpm)
        stylizeArticulation.transform(msm, mpm)

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
