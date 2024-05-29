import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';

export async function loadVerovio(): Promise<VerovioToolkit> {
    const module = await createVerovioModule()
    return new VerovioToolkit(module)
}
