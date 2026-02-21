import { useEffect } from 'react';
import { useLatest } from './useLatest';

interface UsePublicWorkLoaderParams {
    enabled: boolean;
    onMeiLoaded: (meiContent: string) => Promise<void> | void;
    onWorkLoaded: (jsonContent: string) => void;
    onError?: (error: unknown) => void;
}

export const usePublicWorkLoader = ({
    enabled,
    onMeiLoaded,
    onWorkLoaded,
    onError,
}: UsePublicWorkLoaderParams) => {
    const onMeiLoadedRef = useLatest(onMeiLoaded);
    const onWorkLoadedRef = useLatest(onWorkLoaded);
    const onErrorRef = useLatest(onError);

    useEffect(() => {
        if (!enabled) return;

        const loadFiles = async () => {
            try {
                const meiResponse = await fetch('/transcription.mei');
                if (meiResponse.ok) {
                    const meiContent = await meiResponse.text();
                    await onMeiLoadedRef.current(meiContent);
                }

                const jsonResponse = await fetch('/info.json');
                if (jsonResponse.ok) {
                    const jsonContent = await jsonResponse.text();
                    onWorkLoadedRef.current(jsonContent);
                }
            } catch (error) {
                onErrorRef.current?.(error);
            }
        };

        void loadFiles();
    }, [enabled, onMeiLoadedRef, onWorkLoadedRef, onErrorRef]);
};
