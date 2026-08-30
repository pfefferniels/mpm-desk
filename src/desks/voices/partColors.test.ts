import { describe, expect, test } from 'vitest';
import { colorForPart, PART_COLORS, UNASSIGNED } from './partColors';

/** WCAG relative luminance. */
const luminance = (hex: string): number => {
    const channel = (offset: number) => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};

/** Contrast against white, which is what the score is drawn on. */
const onWhite = (hex: string): number => 1.05 / (luminance(hex) + 0.05);

describe('the part palette', () => {
    test('every hue is visible on white at notehead size', () => {
        // 3:1 is WCAG's threshold for a non-text graphic. It is what rules out Okabe–Ito's yellow
        // (1.1), orange (2.25) and sky blue (2.31), which is why this is not that palette.
        const failing = PART_COLORS.filter((color) => onWhite(color) < 3);
        expect(failing).toEqual([]);
    });

    test('a note in no part is fainter than any part, so it reads as absent', () => {
        const faintestPart = Math.min(...PART_COLORS.map(onWhite));
        expect(onWhite(UNASSIGNED)).toBeLessThan(faintestPart);
    });

    test('no two parts share a colour', () => {
        expect(new Set(PART_COLORS).size).toBe(PART_COLORS.length);
    });

    test('numbers parts from one, and cycles rather than running out', () => {
        expect(colorForPart(1)).toBe(PART_COLORS[0]);
        expect(colorForPart(PART_COLORS.length)).toBe(PART_COLORS.at(-1));
        expect(colorForPart(PART_COLORS.length + 1)).toBe(PART_COLORS[0]);
    });
});
