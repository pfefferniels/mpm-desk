import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { DescriptionRun } from '../../fitting/description/client';
import type { AlignmentData } from '../../fitting/fit.worker';
import { PULSES_PER_QUARTER } from '../../fitting/ppq';
import type { DescribedPlace } from '../../fitting/transformers/description/Describe';
import { useEditable } from '../../hooks/Editing';
import { useScoreDocument } from '../../hooks/ScoreDocument';
import { useLatest } from '../../hooks/useLatest';
import { useWorkDocument } from '../../hooks/WorkDocument';
import type { Call } from '../../model/Work';
import { barsOf } from './adapter';
import type { Asked, Driver } from './asking';
import { byHand, made, migrated, remarkCall, remarksOf, removed, resolved, reworded, type Remark } from './document';
import type { RemarkInWords } from './expert';
import type { DescribeServices } from './services';
import { useDescription } from './useDescription';

const NO_REMARKS: readonly Remark[] = [];

/** What the chain said of each step of a remark that did not run, as the expert is told. */
const errorsOf = (run: DescriptionRun, remark: Remark): string[] =>
    (run.remarks.find((report) => report.id === remark.id)?.steps ?? []).flatMap((step, index) =>
        step.error === undefined ? [] : [`step ${String(index + 1)} (${remark.steps[index]?.name ?? '?'}): ${step.error}`],
    );

const inWords = ({ id, text, about, steps }: Remark): RemarkInWords => ({ id, text, about, steps });

/** The remarks of the document, the run they come to, and everything that can be done with one. */
export interface Remarks {
    /** The alignment as loaded; null until a score is open. */
    alignment: AlignmentData | null;
    /** The document as it was last run; null until its first run is in. */
    run: DescriptionRun | null;
    /** The calls `run` was made of. */
    ran: readonly Call[];
    /** The same recording with nothing described. */
    bare: DescriptionRun | null;
    /** A run is under way, and `run` is of a document since changed. */
    stale: boolean;
    /** Why the document as it stands could not be run. */
    problem: string | null;
    remarks: readonly Remark[];
    /** Where each was made, by its id. */
    places: ReadonlyMap<string, DescribedPlace>;
    /** What is known of each remark's way through the expert. */
    asked: ReadonlyMap<string, Asked>;
    /** Whether there is a key, and so an expert to ask. */
    canAsk: boolean;
    /** Record a remark, and ask the expert what it comes to. */
    make: (text: string, about: DescribedPlace) => void;
    /** Say a remark anew: what it became goes, and it is asked again. */
    reword: (id: string, text: string) => void;
    /** Take a remark out, with everything it became. */
    remove: (id: string) => void;
    ask: (id: string) => void;
    stop: (id: string) => void;
    /** Answer what the expert asked about a remark. */
    reply: (id: string, answer: string) => void;
}

/**
 * The describe desk's side of the document: its remarks, the run they come to, and the asking.
 *
 * - **Run and write.** Whenever the calls or the alignment change the document is run
 *   (`useDescription`), and what each remark came to is written into it as one edit
 *   (`document.ts`): a no-op, and no step of undo, where nothing changed.
 * - **Make.** A remark is in the document the moment it is said, as words and a place with no
 *   steps, so that the words are never lost; then the expert is asked, one remark at a time.
 * - **Ask.** The request is made of the document and the run in hand when a remark's turn
 *   comes; its answer is run before it is written, so that the steps and the calls they come to
 *   arrive together; and steps the chain refused go back once for mending.
 *
 * In the viewer the document is run and shown, and nothing is written or asked.
 */
export const useRemarks = (services: DescribeServices, expertKey: string | null): Remarks => {
    const editable = useEditable();
    const { calls, replaceCalls, metadata } = useWorkDocument();
    const { pristine } = useScoreDocument();
    const { session } = services;
    const { asking, client } = session;

    useEffect(() => {
        session.open();
        return () => session.close();
    }, [session]);

    const alignment = useMemo<AlignmentData | null>(
        () =>
            pristine && {
                allNotes: pristine.allNotes,
                pedals: pristine.pedals,
                graces: pristine.graces,
                tiedPrincipals: pristine.tiedPrincipals,
                timeSignatures: pristine.timeSignatures,
            },
        [pristine],
    );

    const expert = useMemo(() => (expertKey === null ? null : services.createExpert(expertKey)), [expertKey, services]);
    const asked = useSyncExternalStore(asking.subscribe, asking.read);

    /**
     * A run is in: the calls its remarks came to go into the document, as one edit.
     *
     * The one place an expert's answer is written. It reaches here already run: the answer waits
     * in the session, the document is run with it in place (`useDescription`), and this is handed
     * both. Whatever is to stand between an answer and its being written, a question to the
     * reader about what it would displace, belongs in front of the `replaceCalls` below.
     */
    const write = (document: readonly Call[], run: DescriptionRun) => {
        if (!editable) return;
        const answers = [...asking.read()].flatMap(([id, entry]) => (entry.answer ? [id] : []));
        // A state of the document undo has brought back is left as the reader asked for it.
        if (answers.length === 0 && session.written.has(calls)) return;
        session.written.add(calls);
        const edit = resolved(document, run);
        replaceCalls(edit.remove, edit.add);
        const told = remarksOf(document);
        for (const id of answers) {
            const remark = told.find((each) => each.id === id);
            asking.written(id, remark ? errorsOf(run, remark) : []);
        }
    };
    const description = useDescription({ alignment, calls, asked, client, onRun: write });
    const { run } = description;

    const remarks = useMemo(() => (alignment ? remarksOf(description.made) : NO_REMARKS), [alignment, description.made]);
    const places = useMemo(() => new Map(remarks.map((remark) => [remark.id, remark.about])), [remarks]);

    const latest = useLatest({ made: description.made, run, alignment, expert, title: metadata.title });

    // How a remark is asked, for as long as the desk is open and has a run to ask about.
    const hasRun = run !== null;
    useEffect(() => {
        if (!editable || !hasRun) return;
        const driver: Driver = (id, entry, { mend, signal, onProgress }) => {
            const now = latest.current;
            const all = remarksOf(now.made);
            const remark = all.find((each) => each.id === id);
            if (!remark || !now.run || !now.alignment || !now.expert) return null;
            const { alignment: recording, made: document } = now;
            return now.expert.ask(
                {
                    remark: inWords(remark),
                    thread: entry.thread,
                    ...(mend && { mend }),
                    others: all.filter((each) => each.id !== id).map(inWords),
                    byHand: byHand(document),
                    run: now.run,
                    piece: { title: now.title, ppq: PULSES_PER_QUARTER, bars: barsOf(now.run.roll) },
                    tryOut: (steps) => client.describe(recording, document, { trial: { remark: id, steps: [...steps] } }),
                },
                { signal, onProgress },
            );
        };
        asking.drive(driver);
        return () => asking.drive(null);
    }, [asking, client, editable, hasRun, latest]);

    // Remarks to ask as soon as the document holds them as they were just written: the expert is
    // shown the document, and until then the document does not say what was just said.
    const toAsk = useRef(new Set<string>());
    useEffect(() => {
        for (const id of [...toAsk.current]) {
            if (!remarks.some((remark) => remark.id === id)) continue;
            toAsk.current.delete(id);
            asking.enqueue(id);
        }
    }, [remarks, asking]);

    // The next in line is asked about the document as it now stands, the last answer in it.
    useEffect(() => {
        asking.resume();
    }, [asking, description.made]);

    // What is known of a remark the document no longer holds is known of nothing.
    useEffect(() => {
        if (!alignment) return;
        for (const id of asked.keys()) if (!remarks.some((remark) => remark.id === id)) asking.forget(id);
    }, [asked, remarks, asking, alignment]);

    const canAsk = expert !== null;
    return {
        alignment,
        run,
        ran: description.ran,
        bare: description.bare,
        stale: description.stale,
        problem: description.problem,
        remarks,
        places,
        asked,
        canAsk,
        make: (text, about) => {
            const id = services.newId();
            const edit = made(migrated(calls), remarkCall(id, text, about, services.now()));
            replaceCalls(edit.remove, edit.add);
            if (canAsk) toAsk.current.add(id);
        },
        reword: (id, text) => {
            const edit = reworded(migrated(calls), id, { text, date: services.now() });
            asking.forget(id);
            replaceCalls(edit.remove, edit.add);
            if (canAsk) toAsk.current.add(id);
        },
        remove: (id) => {
            const edit = removed(migrated(calls), id);
            asking.forget(id);
            replaceCalls(edit.remove, edit.add);
        },
        ask: (id) => asking.enqueue(id),
        stop: (id) => asking.stop(id),
        reply: (id, answer) => asking.reply(id, answer),
    };
};
