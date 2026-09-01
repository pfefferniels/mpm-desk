import { useState } from 'react';

/**
 * The two values a number field has: the text it holds, and the number read out of it.
 *
 * Two rather than one, because a number field has a state no number represents — the empty box you
 * are halfway through retyping. Holding only the number means rejecting `''` on the way in, and a
 * controlled input restores its DOM value from the state it was given, so backspacing through
 * `720` stops dead at `7` and the box can never be cleared.
 *
 * So the text is what the field holds and the number is derived from it, falling back to `initial`
 * while the box is empty or holds something `accepts` refuses.
 */
export const useNumberField = (initial: number, accepts: (value: number) => boolean) => {
    const [text, setText] = useState(String(initial));
    const parsed = Number(text);
    const value =
        text.trim() !== '' && Number.isFinite(parsed) && accepts(parsed) ? parsed : initial;

    return { text, setText, value };
};
