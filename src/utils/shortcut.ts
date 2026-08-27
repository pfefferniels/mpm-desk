/**
 * How a keyboard shortcut is spelled where a tooltip has to name one.
 *
 * A hint that disagrees with its binding is worse than no hint, and the app had exactly that
 * disagreement waiting to happen: `AppMenu` binds `meta+s` and `meta+o` — the Command key,
 * literally, so on Windows and Linux there is no Save shortcut at all — while undo and redo are
 * bound with `react-hotkeys-hook`'s `mod+`, which resolves to Command on a Mac and Control
 * everywhere else. Two spellings of the same intention, and nothing on screen said which key a
 * given desk actually wanted.
 *
 * So the platform test below is not a fresh guess at what a Mac is. It is character for character
 * the expression the library makes internally to resolve `mod`
 * (`react-hotkeys-hook/packages/react-hotkeys-hook/dist/index.js`), which is the only way a label
 * can be guaranteed to name the key that is really bound: a test of our own could differ from the
 * library's on some machine — an iPad reporting a desktop user agent is the obvious candidate,
 * which is why the library excludes the iOS families by name — and nothing here or in CI would
 * ever catch it. The library also guards `typeof navigator` for a server render; this is a Vite
 * SPA with no such entry point, so that guard would be ceremony.
 *
 * A user-agent test is a heuristic, not an authority. That is a limitation the app inherits from
 * `react-hotkeys-hook` rather than one it invents, and inheriting it is the point: wherever the
 * library is wrong about the platform, these labels are wrong in exactly the same way, and the
 * hint still describes the binding.
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
