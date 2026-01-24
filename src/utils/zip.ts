export function zip<A, B>(a: A[], b: B[]): Array<A & B> {
    const len = Math.min(a.length, b.length);
    const result: Array<A & B> = [];

    for (let i = 0; i < len; i++) {
        result.push({...a[i], ...b[i]});
    }

    return result;
}
