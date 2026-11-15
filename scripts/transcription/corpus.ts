import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One roll and the score it is a performance of. */
export interface Pair {
    /** The SUPRA druid, which names `midi/<roll>.mid` */
    roll: string;
    /** The score's file name without its extension, which names `mei/<score>.mei` */
    score: string;
    title: string;
    performer: string;
}

export const readManifest = (dir: string): Pair[] =>
    readFileSync(join(dir, 'manifest.tsv'), 'utf-8')
        .split('\n')
        .filter((line) => line.trim().length > 0 && !line.startsWith('#'))
        .map((line) => {
            const [roll, score, title, performer] = line.split('\t');
            return { roll, score, title, performer };
        });
