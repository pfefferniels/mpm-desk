/* eslint-disable react-refresh/only-export-components -- This is the entry point: it mounts the
   tree and exports nothing, by design. Fast refresh has no module here to swap, so the rule's
   advice — move the components to a file with exports — would only undo the bundle split the
   `lazy` call below exists to make. */
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { PianoContextProvider } from 'react-pianosound';
import { PIANO_VELOCITIES } from './performance/piano';
import { LoadingScreen } from './components/LoadingScreen';
import { theme } from './theme';
import './index.css';

/**
 * The editor, at every path.
 *
 * The desks: each one plots what the recording did in its own dimension and lets that be
 * annotated — the tempo skyline, the dynamics curve, the rubato frames — and the markup desk
 * shows the document they have been writing. Reading a finished reconstruction is the landing
 * page of welte225.org's business, which loads the published files itself; there is no viewer
 * here.
 *
 * Every path, rather than `/` alone, so that `/editor`, where the editor used to live and where
 * links given out still point, opens it as well. GitHub Pages serves the app for it through the
 * `404.html` fallback that `vite.config.ts` writes.
 *
 * `lazy` so that the loading screen paints while the editor's chunk, the desks with the fitting
 * chain behind them, is still arriving.
 */
const Editor = lazy(async () => ({ default: (await import('./App')).App }));

const root = document.getElementById('root');
if (!root) throw new Error('no #root to mount on');

/**
 * The theme goes outside the split, and above `Suspense`.
 *
 * Above `Suspense` because `CssBaseline` has to have set the body background and `color-scheme`
 * before the first paint, and the first paint is the loading screen — put it inside and the fallback
 * flashes in the user agent's colours while the editor's chunk is still arriving.
 *
 * `enableColorScheme` is a bug fix rather than tidying. The deleted `:root` said
 * `color-scheme: light dark`, which told a dark-mode browser it could paint form controls dark —
 * so a native `<textarea>` or `<input>` came out dark-on-dark inside a white desk, on a machine set
 * to dark, for a UI that has no dark mode.
 */
createRoot(root).render(
    <StrictMode>
        <ThemeProvider theme={theme}>
            <CssBaseline enableColorScheme />
            <Suspense fallback={<LoadingScreen />}>
                <PianoContextProvider velocities={PIANO_VELOCITIES}>
                    <Editor />
                </PianoContextProvider>
            </Suspense>
        </ThemeProvider>
    </StrictMode>,
);
