import { useState } from 'react';
import { Box, Button, Popover, TextField, Typography } from '@mui/material';
import { Key } from '@mui/icons-material';
import { ToolbarButton } from '../../components/toolbar/ToolbarButton';

interface KeyFieldProps {
    /** The key in use, if there is one. */
    held: string | null;
    onChange: (key: string | null) => void;
    /** The model the key speaks to. */
    model: string;
}

/**
 * Where the reader's own key is entered, and what is said of it wherever it is asked for: where
 * it is kept, and what is sent with it.
 *
 * The key is never shown again once it is kept, only that there is one.
 */
export const KeyField = ({ held, onChange, model }: KeyFieldProps) => {
    const [typed, setTyped] = useState('');
    const keep = () => {
        const key = typed.trim();
        if (!key) return;
        onChange(key);
        setTyped('');
    };
    return (
        <Box data-expert-key sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="body2" color="text.secondary">
                A remark is turned into steps by {model}, asked with your own Anthropic API key. The key is kept in this browser only,
                never in the document. When you make a remark, it is sent to Anthropic’s API together with the remark, the notes of the
                piece and what has been described so far.
            </Typography>
            {held !== null ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ flex: 1 }}>
                        A key is kept, ending in {held.slice(-4)}.
                    </Typography>
                    <Button variant="outlined" onClick={() => onChange(null)}>
                        Forget it
                    </Button>
                </Box>
            ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TextField
                        size="small"
                        type="password"
                        placeholder="sk-ant-…"
                        value={typed}
                        autoComplete="off"
                        onChange={(event) => setTyped(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') keep();
                            // A key is not a remark, and Space in it does not start the playing.
                            event.stopPropagation();
                        }}
                        inputProps={{ 'aria-label': 'Anthropic API key' }}
                        sx={{ flex: 1, '& .MuiInputBase-root': { height: 30 } }}
                    />
                    <Button variant="outlined" disabled={typed.trim() === ''} onClick={keep}>
                        Keep it
                    </Button>
                </Box>
            )}
        </Box>
    );
};

/**
 * The key, called up from the toolbar.
 *
 * The button says whether there is one: without it remarks are kept as words and nothing comes
 * of them, which the reader should not have to make a remark to find out.
 */
export const ExpertKey = ({ held, onChange, model }: KeyFieldProps) => {
    // The button's holder in state, not a ref: it is what the popover is hung on while it renders.
    const [holder, setHolder] = useState<HTMLSpanElement | null>(null);
    const [open, setOpen] = useState(false);
    return (
        <span ref={setHolder} style={{ display: 'inline-flex' }}>
            <ToolbarButton
                icon={<Key fontSize="small" color={held === null ? 'warning' : 'inherit'} />}
                label="Expert"
                tooltip={
                    held === null
                        ? 'No key: remarks are kept as words, and not turned into steps. Enter one here'
                        : 'Remarks are turned into steps with your key'
                }
                onClick={() => setOpen(true)}
            >
                Expert
            </ToolbarButton>
            <Popover
                open={open}
                anchorEl={holder}
                onClose={() => setOpen(false)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                slotProps={{ paper: { sx: { p: 2, width: 380, mt: 0.5 } } }}
            >
                <KeyField held={held} onChange={onChange} model={model} />
            </Popover>
        </span>
    );
};
