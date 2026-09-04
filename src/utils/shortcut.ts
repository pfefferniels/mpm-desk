/**
 * How a keyboard shortcut is spelled where a tooltip has to name one.
 *
 * A hint that disagrees with its binding is worse than no hint. Every binding uses
 * `react-hotkeys-hook`'s `mod+`, which resolves to Command on a Mac and Control elsewhere, so the
 * label has to resolve it the same way.
 *
 * The platform test below is character for character the expression the library makes internally
 * (`react-hotkeys-hook/packages/react-hotkeys-hook/dist/index.js`). A test of our own could
 * differ from the library's on some machine, an iPad reporting a desktop user agent being the
 * obvious candidate, which is why the library excludes the iOS families by name, and nothing here
 * or in CI would catch it. The library also guards `typeof navigator` for a server render, which
 * a Vite SPA has no entry point for.
 *
 * A user-agent test is a heuristic rather than an authority, and inheriting that limitation is
 * the point: wherever the library is wrong about the platform these labels are wrong the same
 * way, and the hint still describes the binding.
 */
const isApple =
    /mac/i.test(navigator.userAgent) && !/iphone|ipad|ipod/i.test(navigator.userAgent);

/** What `mod+` means here. Note the trailing `+`: the Apple glyphs are written without one. */
const modLabel = isApple ? '⌘' : 'Ctrl+';

const shiftLabel = isApple ? '⇧' : 'Shift+';

/**
 * `shortcut('S')` ⇒ `⌘S` or `Ctrl+S`; `shortcut('Z', true)` ⇒ `⇧⌘Z` or `Ctrl+Shift+Z`.
 *
 * The two platforms order the modifiers differently and both orders are load-bearing to the eye
 * that reads them: Apple's own menus write Shift before Command, and every Windows menu writes
 * Ctrl first. One template for both would be legible but subtly foreign on one of them.
 */
export const shortcut = (key: string, shift?: boolean) =>
    shift
        ? isApple
            ? `${shiftLabel}${modLabel}${key}`
            : `${modLabel}${shiftLabel}${key}`
        : `${modLabel}${key}`;
