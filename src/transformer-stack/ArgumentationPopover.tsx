import { useState } from "react";
import { Popper, Paper, Typography, IconButton, Stack } from "@mui/material";
import { Edit } from "@mui/icons-material";
import { Argumentation } from "mpmify";
import { ArgumentationDialog } from "./ArgumentationDialog";

interface ArgumentationPopoverProps {
    argumentation: Argumentation;
    anchorEl: { getBoundingClientRect: () => DOMRect; contextElement?: Element };
    onArgumentationChange: () => void;
}

export const ArgumentationPopover = ({
    argumentation,
    anchorEl,
    onArgumentationChange,
}: ArgumentationPopoverProps) => {
    const [dialogOpen, setDialogOpen] = useState(false);

    return (
        <>
            <Popper
                open
                anchorEl={anchorEl}
                placement="top"
                modifiers={[
                    { name: "offset", options: { offset: [0, 8] } },
                    { name: "preventOverflow", options: { padding: 8 } },
                ]}
                style={{ zIndex: 10 }}
            >
                <Paper elevation={4} sx={{ borderRadius: 2, p: 1.5, maxWidth: 300 }}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                        <div>
                            <Typography variant="subtitle2" sx={{ textTransform: "capitalize" }}>
                                {argumentation.conclusion.motivation || "No motivation"}
                            </Typography>
                            {argumentation.conclusion.certainty && (
                                <Typography variant="caption" color="text.secondary">
                                    {argumentation.conclusion.certainty}
                                </Typography>
                            )}
                            {argumentation.conclusion.note && (
                                <Typography variant="body2" sx={{ mt: 0.5 }}>
                                    {argumentation.conclusion.note}
                                </Typography>
                            )}
                        </div>
                        <IconButton size="small" onClick={() => setDialogOpen(true)}>
                            <Edit fontSize="small" />
                        </IconButton>
                    </Stack>
                </Paper>
            </Popper>
            <ArgumentationDialog
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                argumentation={argumentation}
                onChange={onArgumentationChange}
            />
        </>
    );
};
