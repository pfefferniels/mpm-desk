/**
 * What sends for the samples, and what happens while they are not there.
 *
 * Both failures this guards against are silent by construction. `@tonejs/piano` drops every note
 * it cannot sound and only warns on the console, so a play that goes through ungated looks to the
 * page like a play that worked. And the download is 16 MB from another host, which a visit that
 * never asks to hear anything pays for without anything on screen saying so.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import type { MidiFile } from 'midifile-ts';

let status: 'loading' | 'done' | 'error' | undefined;
const play = vi.fn(() => null);
const playSingleNote = vi.fn();
/** How often the library's provider has mounted, which is when the real one starts the download. */
let downloads = 0;

vi.mock('react-pianosound', () => ({
    PianoContextProvider: ({ children }: { children: ReactNode }) => {
        useEffect(() => {
            downloads += 1;
        }, []);
        return children;
    },
    usePiano: () => ({ status, play, playSingleNote, stop: vi.fn() }),
}));

/**
 * The modules under test, fresh for every test. Whether sound has been asked for belongs to the
 * page and lasts as long as it is open, so one test's asking would otherwise be every later one's.
 *
 * The test timeout rather than a hook's default ten seconds, because the first import of the
 * notice is the first of MUI too, and a hook is held to the clock where collection is not.
 */
let piano: typeof import('./piano');
let PianoProvider: typeof import('./PianoProvider').PianoProvider;
let SampleLoadingNotice: typeof import('../components/SampleLoading').SampleLoadingNotice;

beforeEach(async () => {
    vi.resetModules();
    piano = await import('./piano');
    ({ PianoProvider } = await import('./PianoProvider'));
    ({ SampleLoadingNotice } = await import('../components/SampleLoading'));
    status = undefined;
    downloads = 0;
    play.mockClear();
    playSingleNote.mockClear();
}, 20000);

/** A transport, and a gesture that auditions, which are the two ways there are to ask. */
const Transport = () => {
    const { play: start, playSingleNote: audition } = piano.usePiano();
    const { loading } = piano.useSampleLoading();
    return (
        <>
            <button onClick={() => void start({} as MidiFile)}>play</button>
            <button onClick={() => audition(60)}>audition</button>
            <span>{loading ? 'loading' : 'not loading'}</span>
        </>
    );
};

const mount = () =>
    render(
        <PianoProvider>
            <Transport />
            <SampleLoadingNotice />
        </PianoProvider>,
    );

const press = (name: 'play' | 'audition') => fireEvent.click(screen.getByText(name));

describe('sending for the samples', () => {
    it('fetches nothing until something asks to be heard', () => {
        mount();

        expect(downloads).toBe(0);
        expect(screen.getByText('not loading')).toBeInTheDocument();
    });

    it('sends for them on the first play, refuses it, and says why', () => {
        mount();
        press('play');

        expect(downloads).toBe(1);
        expect(play).not.toHaveBeenCalled();
        expect(screen.getByText('loading')).toBeInTheDocument();
        expect(screen.getByText(/still loading its samples/)).toBeInTheDocument();
    });

    it('sends for them on the first audition too', () => {
        mount();
        press('audition');

        expect(downloads).toBe(1);
        expect(playSingleNote).not.toHaveBeenCalled();
        expect(screen.getByText(/still loading its samples/)).toBeInTheDocument();
    });

    it('sends for them once, however often it is asked', () => {
        status = 'loading';
        mount();
        press('play');
        press('audition');
        press('play');

        expect(downloads).toBe(1);
    });

    it('leaves a desk mounted on its own silent rather than broken', () => {
        render(<Transport />);
        press('play');

        expect(play).not.toHaveBeenCalled();
        expect(downloads).toBe(0);
    });
});

describe('the piano once it has been sent for', () => {
    /** The first press sends for the samples; the second is the one this is about. */
    const pressTwice = () => {
        mount();
        press('play');
        press('play');
    };

    it('refuses the play while the samples load, and says why', () => {
        status = 'loading';
        pressTwice();

        expect(play).not.toHaveBeenCalled();
        expect(screen.getByText(/still loading its samples/)).toBeInTheDocument();
    });

    it('takes a piano that has said nothing yet for one that is loading', () => {
        status = undefined;
        pressTwice();

        expect(play).not.toHaveBeenCalled();
        expect(screen.getByText('loading')).toBeInTheDocument();
    });

    it('says so when the samples could not be fetched at all', () => {
        status = 'error';
        pressTwice();

        expect(play).not.toHaveBeenCalled();
        expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
    });

    it('plays once they are there', () => {
        status = 'done';
        pressTwice();

        expect(play).toHaveBeenCalledTimes(1);
        expect(screen.getByText('not loading')).toBeInTheDocument();
    });
});
