import { useEffect, useState } from "react";

/** Where @tonejs/piano fetches its samples from */
const SAMPLE_URL = "https://tambien.github.io/Piano/audio/";

export interface SampleProgress {
    /** Samples fetched so far */
    samples: number;
    /** What they weighed, when the host allows us to see it */
    bytes: number;
}

/**
 * What the piano has loaded so far.
 *
 * The samples are fetched one file per note, so counting them says more about
 * how far along the loading is than the three states the piano itself reports.
 */
export function useSampleProgress(active: boolean): SampleProgress {
    const [progress, setProgress] = useState<SampleProgress>({ samples: 0, bytes: 0 });

    useEffect(() => {
        if (!active || typeof performance?.getEntriesByType !== "function") return;

        const read = () => {
            const samples = performance
                .getEntriesByType("resource")
                .filter((entry) => entry.name.startsWith(SAMPLE_URL)) as PerformanceResourceTiming[];

            setProgress({
                samples: samples.length,
                // Cross-origin hosts may withhold the size, in which case this stays 0
                bytes: samples.reduce((total, entry) => total + (entry.encodedBodySize || 0), 0),
            });
        };

        read();
        const interval = setInterval(read, 300);
        return () => clearInterval(interval);
    }, [active]);

    return progress;
}
