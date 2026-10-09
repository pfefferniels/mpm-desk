import { Alert, Snackbar } from '@mui/material';

interface MessageSnackbarProps {
    /** What went wrong, or undefined while nothing has. */
    message: string | undefined;
    onClose: () => void;
}

/** The editor's one place for reporting a failure: a failed load, a fit's problems, a bad file. */
export const MessageSnackbar = ({ message, onClose }: MessageSnackbarProps) => (
    <Snackbar open={message !== undefined} autoHideDuration={4000} onClose={onClose}>
        <Alert onClose={onClose} severity="error" variant="filled" sx={{ width: '40%' }}>
            {message}
        </Alert>
    </Snackbar>
);
