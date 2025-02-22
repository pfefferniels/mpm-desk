import { Tab, Tabs } from "@mui/material";
import { useState } from "react";
import { ScopedTransformerViewProps } from "../DeskSwitch";
import { TabPanel } from "../TabPanel";
import { OrnamentationStyles } from "./OrnamentationStyles";
import { ArticulationStyles } from "./ArticulationStyles";

export const StylesDesk = (props: ScopedTransformerViewProps) => {
    const [tabIndex, setTabIndex] = useState(0)

    const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
        setTabIndex(newValue)
    }

    return (
        <div style={{ width: '80vw', overflow: 'scroll' }}>
            <Tabs value={tabIndex} onChange={handleTabChange} aria-label="Ornaments and Articulations tabs">
                <Tab label="Ornaments" id="simple-tab-0" aria-controls="simple-tabpanel-0" />
                <Tab label="Articulations" id="simple-tab-1" aria-controls="simple-tabpanel-1" />
            </Tabs>

            <TabPanel value={tabIndex} index={0}>
                <OrnamentationStyles {...props} />
            </TabPanel>

            <TabPanel value={tabIndex} index={1}>
                <ArticulationStyles {...props} />
            </TabPanel>
        </div>
    )
}
