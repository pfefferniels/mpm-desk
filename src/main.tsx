/* eslint-disable react-refresh/only-export-components -- This is the entry point: it mounts the
   tree and exports nothing, by design. Fast refresh has no module here to swap, so the rule's
   advice — move the components to a file with exports — would only undo the bundle split the two
   `lazy` calls below exist to make. */
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { PianoContextProvider } from 'react-pianosound';
import { ModeProvider } from './hooks/ModeProvider';
import { LoadingScreen } from './components/LoadingScreen';
import { theme } from './theme';
import './index.css';

/**
 * Two routes, and deliberately two component trees.
 *
 * `/` is the **viewer**: the tree of curved words, the exaggeration knob, playback. It reads a
 * finished reconstruction and shows what it claims. Nothing in it edits anything.
 *
 * `/editor` is the **editor**: the desks. Each one plots what the recording did in its own
 * dimension and lets that be annotated — the tempo skyline, the dynamics curve, the rubato
 * frames — plus a narrative desk for grouping the resulting calls and saying why.
 *
 * They are two trees because they answer different questions: a viewer asks *what does this
 * performance do*, an editor asks *what have I claimed about it and where*. Sharing one tree
 * means every component down it carrying a mode flag, which is the cost the split avoids.
 *
 * What they do share is underneath both: `src/fitting/` runs the chain, `src/model/` says what a
 * work file is, and `src/utils/espressivo.ts` renders. That is the part worth having in common.
 *
 * ## Two trees, and now two downloads
 *
 * The split was real in the source and not in the build. Both were imported here unconditionally,
 * so one bundle held both and each route paid for the other: measured over a per-package split of
 * the old bundle, the viewer's tree was 545 KB and the desks with the chain behind them well over
 * that, and every reader of the finished reconstruction downloaded all of it to look at some
 * words on a line.
 *
 * `lazy` at the one place that already knew which tree it wanted costs a dynamic import and gets
 * the source's own boundary back in the output.
 */
const isEditor = window.location.pathname === '/editor';

const Editor = lazy(async () => ({ default: (await import('./App')).App }));
const Viewer = lazy(async () => ({ default: (await import('./Viewer')).Viewer }));

const root = document.getElementById('root');
if (!root) throw new Error('no #root to mount on');

/**
 * The theme goes outside the split, and above `Suspense`.
 *
 * Above `Suspense` because `CssBaseline` has to have set the body background and `color-scheme`
 * before the first paint, and the first paint is the loading screen — put it inside and the fallback
 * flashes in the user agent's colours while the route's chunk is still arriving.
 *
 * Around both branches because both need it. The obvious reading is that the desks are the MUI tree
 * and the viewer is hand-drawn SVG, but the viewer's glass toolbar reads `text.secondary` and
 * `text.disabled` in four places, and has been resolving them against a theme nobody configured.
 *
 * `enableColorScheme` is a bug fix rather than tidying. The deleted `:root` said
 * `color-scheme: light dark`, which told a dark-mode browser it could paint form controls dark —
 * so the narrative desk's native `<textarea>` and its filter `<input>` came out dark-on-dark
 * inside a white table, on a machine set to dark, for a UI that has no dark mode.
 */
createRoot(root).render(
    <StrictMode>
        <ThemeProvider theme={theme}>
            <CssBaseline enableColorScheme />
            <Suspense fallback={<LoadingScreen />}>
                {isEditor ? (
                    <ModeProvider>
                        <PianoContextProvider velocities={3}>
                            <Editor />
                        </PianoContextProvider>
                    </ModeProvider>
                ) : (
                    <Viewer />
                )}
            </Suspense>
        </ThemeProvider>
    </StrictMode>,
);
