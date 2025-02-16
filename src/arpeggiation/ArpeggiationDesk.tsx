import { ScopedTransformerViewProps } from "../DeskSwitch"
import { useState } from "react"
import { Tab, Tabs } from "@mui/material"
import { TabPanel } from "../TabPanel"
import { DynamicsGradientDesk } from "./DynamicsGradientDesk"
import { TemporalSpreadDesk } from "./TemporalSpreadDesk"

export const ArpeggiationDesk = (props: ScopedTransformerViewProps) => {
    const [tabIndex, setTabIndex] = useState(0)

    const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
        setTabIndex(newValue)
    }

    return (
        <div>
            <Tabs value={tabIndex} onChange={handleTabChange} aria-label="Ornaments and Articulations tabs">
                <Tab label="Dynamics Gradient" id="simple-tab-0" aria-controls="simple-tabpanel-0" />
                <Tab label="Temporal Spread" id="simple-tab-1" aria-controls="simple-tabpanel-1" />
            </Tabs>

            <TabPanel value={tabIndex} index={0}>
                <DynamicsGradientDesk {...props} />
            </TabPanel>
            <TabPanel value={tabIndex} index={1}>
                <TemporalSpreadDesk {...props} />
            </TabPanel>
        </div>
    )
}
