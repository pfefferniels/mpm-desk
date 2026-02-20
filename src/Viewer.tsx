import { useCallback, useEffect, useMemo, useState } from 'react';
import { compareTransformers, importWork, MSM } from 'mpmify';
import { getRange, Transformer } from 'mpmify/lib/transformers/Transformer';
import { asMSM } from './asMSM';
import { asPathD, negotiateIntensityCurve } from './utils/intensityCurve';

export const Viewer = () => {
    const [msm, setMSM] = useState<MSM>(new MSM());
    const [transformers, setTransformers] = useState<Transformer[]>([]);

    const loadWorkFromJson = useCallback((content: string) => {
        const { transformers: loaded } = importWork(content);
        const nonMetadata = loaded.filter(t => t.name !== 'InsertMetadata');
        setTransformers(nonMetadata.sort(compareTransformers));
    }, []);

    useEffect(() => {
        const loadFiles = async () => {
            try {
                const meiResponse = await fetch('/transcription.mei');
                if (meiResponse.ok) {
                    const meiContent = await meiResponse.text();
                    setMSM(await asMSM(meiContent));
                }

                const jsonResponse = await fetch('/info.json');
                if (jsonResponse.ok) {
                    const jsonContent = await jsonResponse.text();
                    loadWorkFromJson(jsonContent);
                }
            } catch (e) {
                console.error('Failed to load files:', e);
            }
        };

        loadFiles();
    }, [loadWorkFromJson]);

    const argumentations = useMemo(() =>
        Map.groupBy(transformers, t => t.argumentation),
        [transformers]
    );

    const maxDate = getRange(transformers, msm)?.to || 0;

    const totalHeight = 300;
    const padTop = 40;
    const padBottom = 40;
    const stretchX = 0.05;

    const scaled = useMemo(() =>
        negotiateIntensityCurve(argumentations, maxDate, msm),
        [argumentations, maxDate, msm]
    );

    const curvePathD = useMemo(
        () => asPathD(scaled, stretchX, totalHeight, padTop, padBottom),
        [scaled, stretchX, totalHeight],
    );

    const width = maxDate * stretchX;

    if (transformers.length === 0 || maxDate === 0) return null;

    return (
        <svg
            width="100%"
            height={totalHeight}
            viewBox={`0 0 ${width} ${totalHeight}`}
            preserveAspectRatio="none"
            style={{ display: 'block' }}
        >
            <path
                d={curvePathD}
                fill="none"
                stroke="#888"
                strokeWidth={1.3}
                strokeOpacity={0.5}
                strokeDasharray="2.6 3.9"
                strokeLinejoin="round"
                strokeLinecap="round"
            />
        </svg>
    );
};
