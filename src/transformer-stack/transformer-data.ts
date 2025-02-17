import { Transformer } from "mpmify/lib/transformers/Transformer";

const transformerDataKey = Symbol('task');
export type TransformerData = { [transformerDataKey]: true; transformerId: Transformer['id']; };
export function getTransformerData(transformer: Transformer): TransformerData {
    return { [transformerDataKey]: true, transformerId: transformer.id };
}
export function isTransformerData(data: Record<string | symbol, unknown>): data is TransformerData {
    return data[transformerDataKey] === true;
}
