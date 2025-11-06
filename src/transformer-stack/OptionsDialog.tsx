import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, TextField } from "@mui/material";
import { TransformationOptions } from "mpmify";
import { useEffect, useState } from "react";

interface OptionsDialogProps {
    open: boolean;
    onClose: () => void;
    options: TransformationOptions;
    onDone: (options: TransformationOptions) => void;
}

export const OptionsDialog = ({ open, onClose, options, onDone }: OptionsDialogProps) => {
    const [localOptions, setLocalOptions] = useState<TransformationOptions>(options);

    const handleChange = (key: string, value: string | number) => {
        setLocalOptions(prev => ({
            ...prev,
            [key]: value
        }));
    };

    const handleSubmit = () => {
        onDone(localOptions);
    };

    useEffect(() => {
        setLocalOptions(options);
    }, [options]);

    if (!open) return null;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Edit Transformation Options</DialogTitle>
            <DialogContent dividers>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                    {Object.entries(localOptions).map(([key, value]) => {
                        if (typeof value === 'boolean') {
                            return (
                                <FormControlLabel
                                    key={key}
                                    control={
                                        <Checkbox
                                            checked={value}
                                            onChange={(e) => setLocalOptions(prev => ({ ...prev, [key]: e.target.checked }))}
                                        />
                                    }
                                    label={key}
                                />
                            );
                        }
                        
                        if (typeof value !== 'string' && typeof value !== 'number') {
                            // Skip non-string/number options for simplicity
                            return <Box key={key}>{typeof value}</Box>;
                        }

                        const isNumber = typeof value === 'number';
                        return (
                            <TextField
                                key={key}
                                label={key}
                                type={isNumber ? 'number' : 'text'}
                                value={value as string | number}
                                onChange={(e) => handleChange(key, isNumber ? Number(e.target.value) : e.target.value)}
                                fullWidth
                                variant="outlined"
                            />
                        );
                    })}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button onClick={handleSubmit} variant="contained">Done</Button>
            </DialogActions>
        </Dialog>
    );
}