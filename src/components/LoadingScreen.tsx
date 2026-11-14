const spinKeyframes = `@keyframes loading-spin { to { transform: rotate(360deg) } }`;

interface LoadingScreenProps {
    /** What is under way, said under the spinner: "Running the chain". */
    message?: string;
    /** Why nothing is coming, said in the spinner's place. */
    error?: string;
}

/**
 * Shown while the baked files are in flight, and in their place if they never arrive.
 *
 * Progress and failure are two props rather than one, because the spinner is what tells a reader
 * whether to wait: a step of the load that says what it is doing is still loading, and only a
 * load that has failed stops turning.
 */
export const LoadingScreen = ({ message, error }: LoadingScreenProps) => (
    <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        // At least the viewport rather than exactly it, so an error longer than the screen
        // scrolls instead of spilling over the top, where nothing can reach it.
        minHeight: '100vh',
        boxSizing: 'border-box',
        padding: 16,
        gap: 12,
    }}>
        <style>{spinKeyframes}</style>
        {error === undefined && (
            <div style={{
                width: 28,
                height: 28,
                border: '3px solid rgba(128,128,128,0.2)',
                borderTopColor: 'rgba(128,128,128,0.6)',
                borderRadius: '50%',
                animation: 'loading-spin .8s linear infinite',
            }} />
        )}
        <div style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 13,
            color: 'rgba(128,128,128,0.7)',
            maxWidth: 480,
            textAlign: 'center',
            // A chain the worker refused reports one problem per line.
            whiteSpace: 'pre-line',
        }}>
            {error ?? message ?? 'Loading'}
        </div>
    </div>
);
