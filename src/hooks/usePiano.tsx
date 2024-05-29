import React, { ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { Piano } from "@tonejs/piano/build/piano/Piano";
import * as Tone from 'tone'
import { MidiFile } from 'midifile-ts';
import { asNotes } from './MidiNote';

function convertRange(value: number, r1: [number, number], r2: [number, number]) {
  return (value - r1[0]) * (r2[1] - r2[0]) / (r1[1] - r1[0]) + r2[0];
}

interface PianoContextProps {
  piano: Piano;
}

const PianoContext = createContext<PianoContextProps | undefined>(undefined);

interface PianoContextProviderProps {
  children: ReactNode
}

export const PianoContextProvider = ({ children }: PianoContextProviderProps) => {
  const [piano] = useState(() => {
    const initializedPiano = new Piano({
      // release: true,
      velocities: 4,
    });

    (async () => {
      await initializedPiano.load();
    })();

    return initializedPiano.toDestination();
  });

  useEffect(() => {
    return () => {
      // Clean up piano resources when the component unmounts
      piano.disconnect()
    };
  }, [piano]);

  return (
    <PianoContext.Provider value={{ piano }}>
      {children}
    </PianoContext.Provider>
  );
};

// Your MIDI event handling functions
export const usePiano = () => {
  const context = useContext(PianoContext);
  if (!context) {
    throw new Error('usePiano must be used within a PianoContextProvider');
  }
  const piano = context.piano

  const play = (file: MidiFile) => {
    const notes = asNotes(file)
    piano.toDestination()

    for (const note of notes) {
      Tone.Transport.schedule(() => {
        piano.keyDown({
          note: note.pitch.toString(),
          velocity: convertRange(note.velocity, [30,60], [0.1, 0.9])
        });
      }, note.onsetMs / 1000);

      Tone.Transport.schedule(() => {
        piano.keyUp({
          note: note.pitch.toString()
        })
      }, note.offsetMs / 1000);
    }

    // TODO: pedal
    
    if (Tone.Transport.state === 'started') return
    Tone.start()
    Tone.Transport.start()
  };

  const stopAll = () => {
    // console.log('stop all')
    // Tone.Transport.stop()
    // piano.stopAll()
  }

  const playSingleNote = (pitch: number, durationMs: number = 500, velocity?: number) => {
    if (!piano) return
    piano.toDestination();
    piano.keyDown({
      note: pitch.toString(),
      velocity
    })

    // calling piano.keyUp() directly with the time parameter set to 0.5
    // will make the piano stop completely (for unknown reasons ...)
    setTimeout(() => {
      piano.keyUp({
        note: pitch.toString()
      })
    }, durationMs)
  };

  return {
    play,
    playSingleNote,
    stop: stopAll,
    seconds: Tone.Transport.seconds,
    jumpTo: (seconds: number) => Tone.Transport.seconds = seconds
  };
};
