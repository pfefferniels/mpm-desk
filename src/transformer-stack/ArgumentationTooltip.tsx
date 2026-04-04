import { Popper, Paper, Typography, Stack, Divider } from "@mui/material";
import { Argumentation } from "mpmify";

interface ArgumentationTooltipProps {
    argumentations: Argumentation[];
    anchorEl: { getBoundingClientRect: () => DOMRect; contextElement?: Element };
}

export const ArgumentationTooltip = ({
    argumentations,
    anchorEl,
}: ArgumentationTooltipProps) => (
    <Popper
        open
        anchorEl={anchorEl}
        placement="top"
        modifiers={[
            { name: "offset", options: { offset: [0, 8] } },
            { name: "preventOverflow", options: { padding: 8 } },
        ]}
        style={{ zIndex: 10, pointerEvents: "none" }}
    >
        <Paper elevation={4} sx={{ borderRadius: 2, p: 1.5 }}>
            <Stack direction="row" divider={<Divider orientation="vertical" flexItem />} spacing={1.5}>
                {argumentations.map(argumentation => (
                    <div key={argumentation.id} style={{ maxWidth: 300 }}>
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
                ))}
            </Stack>
        </Paper>
    </Popper>
);
