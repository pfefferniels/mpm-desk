import { useState } from "react";
import { Popper, Paper, Typography, IconButton, Stack, Divider } from "@mui/material";
import { Edit } from "@mui/icons-material";
import { Argumentation } from "mpmify";
import { ArgumentationDialog } from "./ArgumentationDialog";

interface ArgumentationPopoverProps {
    argumentations: Argumentation[];
    anchorEl: { getBoundingClientRect: () => DOMRect; contextElement?: Element };
    onArgumentationChange: () => void;
}

export const ArgumentationPopover = ({
    argumentations,
    anchorEl,
    onArgumentationChange,
}: ArgumentationPopoverProps) => {
    const [editingIndex, setEditingIndex] = useState<number | null>(null);

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
                <Paper elevation={4} sx={{ borderRadius: 2, p: 1.5 }}>
                    <Stack direction="row" divider={<Divider orientation="vertical" flexItem />} spacing={1.5}>
                        {argumentations.map((argumentation, i) => (
                            <Stack key={argumentation.id} direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ maxWidth: 300 }}>
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
                                <IconButton size="small" onClick={() => setEditingIndex(i)}>
                                    <Edit fontSize="small" />
                                </IconButton>
                            </Stack>
                        ))}
                    </Stack>
                </Paper>
            </Popper>
            {editingIndex !== null && argumentations[editingIndex] && (
                <ArgumentationDialog
                    open
                    onClose={() => setEditingIndex(null)}
                    argumentation={argumentations[editingIndex]}
                    onChange={onArgumentationChange}
                />
            )}
        </>
    );
};
