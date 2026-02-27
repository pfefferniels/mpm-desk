import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";

interface MergeOrChainDialogProps {
    open: boolean;
    onMerge: () => void;
    onChain: () => void;
    onClose: () => void;
}

export const MergeOrChainDialog = ({ open, onMerge, onChain, onClose }: MergeOrChainDialogProps) => (
    <Dialog open={open} onClose={onClose}>
        <DialogTitle>Merge or Chain?</DialogTitle>
        <DialogContent>
            <DialogContentText>
                <strong>Merge</strong> moves the source region's transformers into the target region.
            </DialogContentText>
            <DialogContentText sx={{ mt: 1 }}>
                <strong>Chain</strong> links the source region as a continuation of the target, forming an argumentation chain.
            </DialogContentText>
        </DialogContent>
        <DialogActions>
            <Button onClick={onClose}>Cancel</Button>
            <Button onClick={onChain} variant="outlined">Chain</Button>
            <Button onClick={onMerge} variant="contained">Merge</Button>
        </DialogActions>
    </Dialog>
);
