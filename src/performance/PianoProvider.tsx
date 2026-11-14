/**
 * The piano, mounted once something asks to hear it.
 *
 * `react-pianosound`'s `PianoContextProvider` sets `@tonejs/piano` fetching its samples the moment
 * it mounts, 94 files and some 16 MB from another host, and has no prop that defers it. Mounted
 * at the root, as it was, it made every visit pay for the download on arrival, though most visits
 * to the viewer never press Play.
 *
 * So it mounts beside the app rather than around it, once `performance/piano.ts` says sound is
 * wanted: on the first press of Play, or the first hover or click on something that auditions.
 * Beside rather than around because wrapping the app in it later would change the element above
 * every desk, and React would remount the whole tree, the open document with it. Nothing below
 * reads the library's context, then: `usePiano` in `performance/piano.ts` hands out the piano
 * that `Publish` passes on.
 */

import { useEffect, type ReactNode } from 'react'
import { PianoContextProvider, usePiano as usePianoSound } from 'react-pianosound'
import { PIANO_VELOCITIES, publishPiano, useSoundWanted } from './piano'

export const PianoProvider = ({ children }: { children: ReactNode }) => {
    const wanted = useSoundWanted()

    return (
        <>
            {children}
            {wanted && (
                <PianoContextProvider velocities={PIANO_VELOCITIES}>
                    <Publish />
                </PianoContextProvider>
            )}
        </>
    )
}

/** The one caller of the library's hook, which passes on what it returns every time it renders. */
const Publish = () => {
    const piano = usePianoSound()

    useEffect(() => {
        publishPiano(piano)
    })
    useEffect(() => () => publishPiano(null), [])

    return null
}
