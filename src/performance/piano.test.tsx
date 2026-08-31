/**
 * What happens when the samples are not there yet.
 *
 * The failure this guards against is silent by construction: `@tonejs/piano` drops every note it
 * cannot sound and only warns on the console, so a play that goes through ungated looks to the
 * page like a play that worked.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MidiFile } from 'midifile-ts';
import { usePiano } from './piano';
import { SampleLoadingNotice } from '../components/SampleLoading';

let status: 'loading' | 'done' | 'error' | undefined;
const play = vi.fn(() => null);
const playSingleNote = vi.fn();

vi.mock('react-pianosound', () => ({
    usePiano: () => ({ status, play, playSingleNote, stop: vi.fn() }),
}));

const Transport = () => {
    const piano = usePiano();
    return (
        <button onClick={() => void piano.play({} as MidiFile)}>play</button>
    );
};

const press = () => {
    render(
        <>
            <Transport />
            <SampleLoadingNotice />
        </>,
    );
    fireEvent.click(screen.getByText('play'));
};

beforeEach(() => {
    play.mockClear();
    playSingleNote.mockClear();
});

describe('the piano while its samples are loading', () => {
    it('refuses the play and says why', () => {
        status = 'loading';
        press();

        expect(play).not.toHaveBeenCalled();
        expect(screen.getByText(/still loading its samples/)).toBeInTheDocument();
    });

    it('says so when the samples could not be fetched at all', () => {
        status = 'error';
        press();

        expect(play).not.toHaveBeenCalled();
        expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
    });

    it('plays, and stays quiet, once they are there', () => {
        status = 'done';
        press();

        expect(play).toHaveBeenCalled();
        expect(screen.queryByText(/still loading its samples/)).toBeNull();
    });

    it('lets a piano that has not said anything yet through', () => {
        status = undefined;
        press();

        expect(play).toHaveBeenCalled();
    });
});
