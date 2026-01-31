// Performance logging utility for debugging render performance
// Usage: Wrap expensive computations with measureTime()
// Enable in dev mode by setting localStorage.setItem('debug_perf', 'true')

const isEnabled = () => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('debug_perf') === 'true';
};

type RenderLog = {
    component: string;
    timestamp: number;
    renderCount: number;
};

const renderCounts = new Map<string, number>();
const renderLogs: RenderLog[] = [];

export function logRender(componentName: string): void {
    if (!isEnabled()) return;

    const count = (renderCounts.get(componentName) || 0) + 1;
    renderCounts.set(componentName, count);

    renderLogs.push({
        component: componentName,
        timestamp: performance.now(),
        renderCount: count
    });

    console.log(`[Render] ${componentName} #${count}`);
}

export function measureTime<T>(label: string, fn: () => T): T {
    if (!isEnabled()) return fn();

    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;

    if (duration > 1) { // Only log if > 1ms
        console.log(`[Perf] ${label}: ${duration.toFixed(2)}ms`);
    }

    return result;
}

export function getRenderStats(): Record<string, number> {
    return Object.fromEntries(renderCounts);
}

export function getRecentRenders(ms: number = 1000): RenderLog[] {
    const cutoff = performance.now() - ms;
    return renderLogs.filter(log => log.timestamp > cutoff);
}

export function clearStats(): void {
    renderCounts.clear();
    renderLogs.length = 0;
}

// Expose to window for debugging
if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).perfDebug = {
        enable: () => localStorage.setItem('debug_perf', 'true'),
        disable: () => localStorage.setItem('debug_perf', 'false'),
        stats: getRenderStats,
        recent: getRecentRenders,
        clear: clearStats
    };
}
