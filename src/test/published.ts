import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PUBLISHED, type Published } from '../model/published';

/**
 * The published files on disk: a checkout of welte225.org, the sibling directory unless
 * `WELTE225` says otherwise (CI checks the repository out inside the workspace).
 */
const checkout = resolve(process.env.WELTE225 ?? '../welte225.org');

export const publishedPath = (file: Published): string => {
    const path = resolve(checkout, PUBLISHED[file]);
    if (!existsSync(path)) {
        throw new Error(
            `${path} is missing: clone https://github.com/pfefferniels/welte225.org beside this repository, or set WELTE225 to a checkout of it`,
        );
    }
    return path;
};
