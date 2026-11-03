/**
 * An MPM element as the performance encodes it: every attribute, unrounded, one tag a line.
 *
 * espressivo's serializer declares the MPM namespace on whatever element it is handed; the file
 * declares it once, at its root, so the quote leaves it out.
 */
export function encodingOf(xml: string): string {
    const lines: string[] = [];
    let depth = 0;
    for (const [token] of xml.replace(/\s+xmlns="[^"]*"/g, '').matchAll(/<[^>]+>|[^<]+/g)) {
        const text = token.trim();
        if (!text) continue;
        if (text.startsWith('</')) depth = Math.max(0, depth - 1);
        lines.push('  '.repeat(depth) + text);
        if (text.startsWith('<') && !text.startsWith('</') && !text.endsWith('/>') && !text.startsWith('<?')) depth++;
    }
    return lines.join('\n');
}
