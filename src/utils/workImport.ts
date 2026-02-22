import { compareTransformers, importWork, InsertMetadata, Transformer, validate } from 'mpmify';
import { SecondaryData } from '../desks/TransformerViewProps';

interface WorkMetadata {
    author: string;
    title: string;
}

interface ParsedWork {
    transformers: Transformer[];
    secondary: SecondaryData;
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
    const { transformers: loaded, secondary } = importWork(content);
    const validationMessages = validate(loaded).map(message => message.message);
    const transformers = loaded
        .filter(transformer => transformer.name !== 'InsertMetadata')
        .sort(compareTransformers);

    return {
        transformers,
        secondary: secondary ?? {},
        metadata: extractMetadataFromTransformers(loaded),
        validationMessages,
    };
};
