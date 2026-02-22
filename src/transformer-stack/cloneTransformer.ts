import { Argumentation, Transformer } from "mpmify";

export const cloneTransformerWithArgumentation = (transformer: Transformer, argumentation: Argumentation): Transformer => {
    const clone = Object.create(Object.getPrototypeOf(transformer)) as Transformer;
    Object.assign(clone, transformer, { argumentation });
    return clone;
};
