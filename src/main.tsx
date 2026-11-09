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
 * Two routes over one component tree.
 *
 * `/editor` is the **editor**: the desks, each plotting what the recording did in its own
 * dimension and turning a gesture on that plot into a transformer call — the tempo skyline, the
 * dynamics curve, the rubato frames — and the markup desk, which shows the document they have
 * been writing.
 *
 * Every other path is the **viewer**: the same desks over the reconstruction welte225.org
 * publishes, with every gesture that edits taken away. It is for reading a curve against the
 * observations it was fitted to, which is why it is the editor's desks rather than a drawing of
 * its own. `App` says what differs between the two; `hooks/Editing.tsx` is how a desk asks.
 * GitHub Pages serves the app for `/editor` through the `404.html` fallback `vite.config.ts`
 * writes.
 *
 * `lazy` so that the loading screen paints while the chunk with the desks and the fitting chain
 * behind them is still arriving.
 */
const isEditor = /^\/editor\/?$/.test(window.location.pathname);

const App = lazy(async () => ({ default: (await import('./App')).App }));

const root = document.getElementById('root');
if (!root) throw new Error('no #root to mount on');

/**
 * The theme goes outside the split, and above `Suspense`.
 *
 * Above `Suspense` because `CssBaseline` has to have set the body background and `color-scheme`
 * before the first paint, and the first paint is the loading screen — put it inside and the fallback
 * flashes in the user agent's colours while the app's chunk is still arriving.
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
                    <App mode={isEditor ? 'edit' : 'view'} />
                </PianoContextProvider>
            </Suspense>
        </ThemeProvider>
    </StrictMode>,
);
