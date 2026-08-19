import { compareTransformers, importWork, InsertMetadata, registerTransformer, Transformer, validate } from 'mpmify';
import { InsertTempo } from '../transformers/InsertTempo';

registerTransformer(InsertTempo, { after: 'ApproximateLogarithmicTempo' });

interface WorkMetadata {
    author: string;
    title: string;
}

interface ParsedWork {
    transformers: Transformer[];
    metadata: WorkMetadata;
    validationMessages: string[];
}

const extractMetadataFromTransformers = (transformers: Transformer[]): WorkMetadata => {
    const metadataTransformer = transformers.find(t => t.name === 'InsertMetadata') as InsertMetadata | undefined;
    if (!metadataTransformer) return { author: '', title: '' };
    return {
        author: metadataTransformer.options.authors?.[0]?.text ?? '',
        title: metadataTransformer.options.comments?.[0]?.text ?? '',
    };
};

export const parseWork = (content: string): ParsedWork => {
    const { transformers: loaded } = importWork(content);
    const validationMessages = validate(loaded).map(message => message.message);
    const transformers = loaded
        .filter(transformer => transformer.name !== 'InsertMetadata')
        .sort(compareTransformers);

    return {
        transformers,
        metadata: extractMetadataFromTransformers(loaded),
        validationMessages,
    };
};
