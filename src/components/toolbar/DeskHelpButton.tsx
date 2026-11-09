import { Fragment, useState } from 'react';
import { Box, IconButton, Popover, Tooltip, Typography } from '@mui/material';
import { InfoOutlined } from '@mui/icons-material';
import type { DeskHelp } from '../../desks/DeskSwitch';
import { useEditable } from '../../hooks/Editing';

interface DeskHelpButtonProps {
    /** What the open desk calls itself — the popover's heading. */
    deskName: string;
    help: DeskHelp;
}

/**
 * What the open desk is for, and what can be done on it.
 *
 * Beside the desk's name in row two, not at the end of it: that row scrolls sideways when a desk
 * contributes more controls than fit — the tempo desk alone contributes four groups — and a help
 * button that scrolls out of reach is one nobody finds.
 *
 * The words are the registry's, off `DeskHelp` in `DeskSwitch.tsx`. Two reasons they are not each
 * desk's own: the button is drawn before the desk module has loaded, and a desk that shipped
 * without help would then be a desk that says nothing rather than one that fails to compile.
 *
 * In the viewer it leaves out the gestures that edit (`DeskAction.edits`), which the viewer does
 * not offer.
 */
export const DeskHelpButton = ({ deskName, help }: DeskHelpButtonProps) => {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const label = `About the ${deskName} desk`;
    const editable = useEditable();
    const actions = editable ? help.actions : help.actions?.filter((action) => !action.edits);

    return (
        <>
            {/* No `Hinted` wrapper: that `<span>` exists so a tooltip hears a hover a *disabled*
                button would swallow, and this control has no disabled state. */}
            <Tooltip title={label}>
                <IconButton
                    aria-label={label}
                    onClick={(event) => {
                        setAnchor(event.currentTarget);
                    }}
                    sx={{ flexShrink: 0, color: 'text.disabled' }}
                >
                    <InfoOutlined fontSize='small' />
                </IconButton>
            </Tooltip>

            <Popover
                open={anchor !== null}
                anchorEl={anchor}
                onClose={() => {
                    setAnchor(null);
                }}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                slotProps={{
                    paper: {
                        sx: { maxWidth: 460, p: 2, border: 1, borderColor: 'divider' },
                    },
                }}
            >
                <Typography variant='subtitle2' sx={{ textTransform: 'capitalize' }}>
                    {deskName}
                </Typography>
                <Typography variant='body2' color='text.secondary' sx={{ mt: 0.5 }}>
                    {help.summary}
                </Typography>

                {/* A grid rather than a table: two columns of phrases with no header row is not a
                    table, and the gesture column has to size itself to the longest gesture. */}
                {actions !== undefined && actions.length > 0 && (
                    <Box
                        sx={{
                            mt: 1.5,
                            display: 'grid',
                            gridTemplateColumns: 'auto 1fr',
                            columnGap: 1.5,
                            rowGap: 0.75,
                            alignItems: 'baseline',
                        }}
                    >
                        {actions.map(({ gesture, does }) => (
                            <Fragment key={gesture}>
                                <Typography
                                    variant='caption'
                                    sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}
                                >
                                    {gesture}
                                </Typography>
                                <Typography variant='caption' color='text.secondary'>
                                    {does}
                                </Typography>
                            </Fragment>
                        ))}
                    </Box>
                )}
            </Popover>
        </>
    );
};
