import React, { useState } from 'react';
import { Card, Collapse, Divider, IconButton, List, ListItemButton, ListItemText, Typography } from '@mui/material';
import { ChevronRight, ExpandLess, ExpandMore } from '@mui/icons-material';
import { correspondingDesks } from '../desks/DeskSwitch';

interface AspectSelectProps {
    selectedDesk: string;
    setSelectedDesk: (desk: string) => void;
}

export const AspectSelect: React.FC<AspectSelectProps> = ({
    selectedDesk,
    setSelectedDesk,
}) => {
    const [toExpand, setToExpand] = useState<string>();
    const [collapsed, setCollapsed] = useState(false);

    const aspectGroups = Array.from(
        Map.groupBy(correspondingDesks, desk => desk.aspect)
    );

    let lastGroup: string | undefined;

    return (
        <Card
            elevation={0}
            sx={{
                // Against the desk area, not the page. Nothing above this used to establish a
                // containing block, so `top: 0` resolved against the initial one and the card
                // painted over the app bar's right end; `App` wraps the desk in a positioned
                // box now, and this is what that box is for.
                position: 'absolute',
                top: 0,
                right: 0,
                marginTop: '1rem',
                marginRight: '1rem',
                // Above the desks, below the bar. The desks position their own overlays at
                // `zIndex: 1` and `5`, and an absolutely-positioned card at `auto` loses to
                // every one of them.
                zIndex: (theme) => theme.zIndex.appBar - 1,
                // Opaque, where this was `blur(17px)` under 60% white.
                //
                // What is behind it is a plot: note rectangles, gridlines and saturated curve
                // fills at high spatial frequency. Blurring that gives a mottled ground whose
                // luminance moves with whatever has been scrolled underneath, so the list's
                // own contrast is a function of the scroll position — and over the amber spans
                // the `saturate` boost averaged the plot's chroma into the panel and came out
                // as a cream wash. Covering the plot honestly beats half-showing it.
                bgcolor: 'background.paper',
                border: 1,
                borderColor: 'divider',
                width: 'fit-content',
                minWidth: collapsed ? undefined : '200px',
                // `ListItemButton.Mui-selected` tints with `alpha(primary.main, …)` rather than
                // `action.selected`, and against a near-black primary that tint is a hair off
                // the hover fill. A rule down the left edge says "this one" at a glance, which
                // is the device `SegmentRow` already uses for the sounding row.
                '& .Mui-selected': {
                    bgcolor: 'action.hover',
                    boxShadow: (theme) => `inset 3px 0 0 ${theme.palette.primary.main}`,
                },
            }}
        >
            {collapsed ? (
                <IconButton
                    onClick={() => setCollapsed(false)}
                    size="small"
                    aria-label="Show the aspect list"
                    sx={{ m: 0.5 }}
                >
                    <ChevronRight fontSize="small" />
                </IconButton>
            ) : (
                <>
                    <ListItemButton onClick={() => setCollapsed(true)} dense>
                        <Typography variant="subtitle2" sx={{ flexGrow: 1, fontWeight: 'bold' }}>
                            Aspects
                        </Typography>
                        <ExpandMore fontSize="small" sx={{ transform: 'rotate(90deg)' }} />
                    </ListItemButton>
                    <Divider />
                    <List>
                        {/* Metadata is an entry in `correspondingDesks` like any other now, so
                            it is listed by the loop below rather than written in by hand. Its
                            own group is what keeps the divider under it. */}
                        {aspectGroups.map(([aspect, info]) => {
                            if (info.length === 0) return null;

                            const currentGroup = info[0].group;
                            const showDivider = lastGroup !== undefined && currentGroup !== lastGroup;
                            lastGroup = currentGroup;

                            return (
                                <React.Fragment key={aspect}>
                                    {showDivider && <Divider sx={{ my: 1 }} />}
                                    {info.length === 1 ? (
                                        <ListItemButton
                                            selected={aspect === selectedDesk}
                                            onClick={() => {
                                                setSelectedDesk(aspect);
                                                setToExpand(undefined);
                                            }}
                                        >
                                            <ListItemText>{aspect}</ListItemText>
                                        </ListItemButton>
                                    ) : (
                                        <ListItemButton
                                            selected={aspect === toExpand}
                                            onClick={() => {
                                                setToExpand(aspect === toExpand ? undefined : aspect);
                                            }}
                                        >
                                            <ListItemText>{aspect}</ListItemText>
                                            {aspect === toExpand ? <ExpandLess /> : <ExpandMore />}
                                        </ListItemButton>
                                    )}

                                    {info.length > 1 && (
                                        <Collapse in={toExpand === aspect} timeout="auto" unmountOnExit>
                                            <List dense component='div' disablePadding sx={{ pl: 3 }}>
                                                {info.map(({ displayName }) => {
                                                    if (!displayName) return null;

                                                    return (
                                                        <ListItemButton
                                                            key={displayName}
                                                            selected={displayName === selectedDesk}
                                                            onClick={() => setSelectedDesk(displayName)}
                                                        >
                                                            <ListItemText>{displayName}</ListItemText>
                                                        </ListItemButton>
                                                    );
                                                })}
                                            </List>
                                        </Collapse>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </List>
                </>
            )}
        </Card>
    );
};
