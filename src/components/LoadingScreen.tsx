const spinKeyframes = `@keyframes loading-spin { to { transform: rotate(360deg) } }`;

/** Shown while the baked files are in flight, and in their place if they never arrive. */
export const LoadingScreen = ({ message }: { message?: string }) => (
    <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: 12,
    }}>
        <style>{spinKeyframes}</style>
        {!message && (
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
        }}>
            {message ?? 'Loading'}
        </div>
    </div>
);
