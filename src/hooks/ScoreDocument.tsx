import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * The score as it stands, and which reading of it the chain is looking at.
 *
 * The *work* document is the chain (`useWorkDocument`); this is the other document — the MEI,
 * which nothing in the chain rewrites. Two desks draw it.
 *
 * It is a context rather than a field on `ViewProps` because `ViewProps` is deliberately what the
 * fit *produced*, and the MEI is an input to the fit. Widening the bag would push one desk's needs
 * onto the other fourteen, which is the mistake `TransformerViewProps.tsx` records having already
 * been made twice.
 */
interface ScoreDocumentValue {
    /** The MEI as it stands. `undefined` before a file is open. */
    mei: string | undefined;
    /**
     * Replace it — which the alignment desk does, and nothing else may.
     *
     * The chain does not rewrite the MEI, and that stays true: what the alignment desk writes is
     * the `<performance>`, which is *upstream* of the chain rather than part of it. Which sounding
     * event realises which written note is what the fold reads before it fits anything, so the
     * document it reads is the desk's to state.
     *
     * It costs a fit — a new MEI is a new `Alignment`, and the worker reloads — so the desk writes
     * once, when the reader commits, rather than on every decision.
     */
    setMei: (mei: string) => void;
    /**
     * The `@source` of the recording the chain prefers, or `''` for "whichever comes first".
     *
     * A `MakeChoice` names a `@source`, and the MEI's `<recording>` elements carry the same
     * string, so verovio's `performanceRecording` takes it with no lookup in between. Held here
     * rather than computed in the desk, so that "which reading is on screen" has one home the day
     * a second desk asks.
     */
    recording: string;
}

const ScoreDocumentContext = createContext<ScoreDocumentValue | null>(null);

export const useScoreDocument = (): ScoreDocumentValue => {
    const context = useContext(ScoreDocumentContext);
    if (!context) throw new Error('useScoreDocument must be used within a ScoreDocumentProvider');
    return context;
};

interface ScoreDocumentProviderProps {
    mei: string | undefined;
    setMei: (mei: string) => void;
    recording: string;
    children: ReactNode;
}

export const ScoreDocumentProvider = ({
    mei,
    setMei,
    recording,
    children,
}: ScoreDocumentProviderProps) => {
    const value = useMemo(() => ({ mei, setMei, recording }), [mei, setMei, recording]);
    return <ScoreDocumentContext value={value}>{children}</ScoreDocumentContext>;
};
