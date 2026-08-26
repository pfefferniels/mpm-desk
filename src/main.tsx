import React from 'react';
import ReactDOM from 'react-dom/client';
import { PianoContextProvider } from 'react-pianosound';
import { App } from './App';
import { Viewer } from './Viewer';
import { ModeProvider } from './hooks/ModeProvider';
import './index.css';
// Populates the transformer registry for this thread. Stated at the entry point rather than
// left to whichever module happens to be imported first: the registry is module-level state,
// and a chain reconstructed before it is populated silently loses every call it cannot name.
// The fitting worker imports it on its own side for the same reason.
import './fitting/transformers/Order';

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
 */
const isEditor = window.location.pathname === '/editor';

const root = document.getElementById('root');
if (!root) throw new Error('no #root to mount on');

ReactDOM.createRoot(root).render(
    <React.StrictMode>
        {isEditor ? (
            <ModeProvider>
                <PianoContextProvider velocities={3}>
                    <App />
                </PianoContextProvider>
            </ModeProvider>
        ) : (
            <Viewer />
        )}
    </React.StrictMode>,
);
