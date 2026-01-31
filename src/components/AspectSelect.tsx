import React, { useState } from 'react';
import { Card, Collapse, Divider, List, ListItemButton, ListItemText } from '@mui/material';
import { ExpandLess, ExpandMore } from '@mui/icons-material';
import { correspondingDesks } from '../DeskSwitch';

interface AspectSelectProps {
    selectedDesk: string;
    setSelectedDesk: (desk: string) => void;
}

export const AspectSelect: React.FC<AspectSelectProps> = ({
    selectedDesk,
    setSelectedDesk,
}) => {
    const [toExpand, setToExpand] = useState<string>();

    const aspectGroups = Array.from(
        Map.groupBy(correspondingDesks, desk => desk.aspect)
    );

    let lastGroup: string | undefined;

    return (
        <Card
            elevation={5}
            sx={{
                position: 'absolute',
                top: 0,
                right: 0,
                backdropFilter: 'blur(17px)',
                background: 'rgba(255, 255, 255, 0.6)',
                marginTop: '1rem',
                marginRight: '1rem',
                width: 'fit-content',
                minWidth: '200px',
            }}
        >
            <List>
                <ListItemButton
                    selected={selectedDesk === 'metadata'}
                    onClick={() => {
                        setSelectedDesk('metadata');
                        setToExpand(undefined);
                    }}
                >
                    <ListItemText>metadata</ListItemText>
                </ListItemButton>
                <Divider sx={{ my: 1 }} />
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
        </Card>
    );
};
