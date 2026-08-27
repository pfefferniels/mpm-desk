import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Alert, AlertTitle, Button, Stack } from '@mui/material';

interface Props {
    /** Changing this remounts the desk — switching desk should clear a previous desk's error. */
    resetKey: string;
    children: ReactNode;
}

interface State {
    error: Error | null;
}

/**
 * Keeps a throwing desk from taking the editor with it.
 *
 * The editor holds the only copy of the work: nothing writes `work.json` back on its own, and
 * `App` sets `onbeforeunload` because of it. Before this, one bad `find(...)` in a desk — and the
 * desks are full of them, since a note the recording does not have is a normal state of an
 * unfinished fit — unmounted the whole tree and the session's work went with it.
 *
 * So the boundary sits around the desk slot **only**. The app bar above it survives, which means
 * `AppMenu`'s Save survives, which is the entire point: the answer to a desk crashing is to save
 * and reload, and that has to still be reachable.
 *
 * A boundary has to be a class — `getDerivedStateFromError` has no hook form.
 */
export class DeskErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidUpdate(previous: Props) {
        // A different desk is not the desk that failed.
        if (previous.resetKey !== this.props.resetKey && this.state.error) {
            this.setState({ error: null });
        }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('The desk threw:', error, info.componentStack);
    }

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;

        return (
            <Alert severity="error" sx={{ m: 2 }}>
                <AlertTitle>This desk could not draw</AlertTitle>
                <Stack spacing={1} alignItems="flex-start">
                    <span>
                        The rest of the editor is unaffected, and your work is still loaded — save
                        it before doing anything else.
                    </span>
                    <code style={{ fontSize: 12, opacity: 0.8 }}>{error.message}</code>
                    <Button size="small" onClick={() => this.setState({ error: null })}>
                        Try drawing it again
                    </Button>
                </Stack>
            </Alert>
        );
    }
}
