import type { NoteSpan } from "../../performance/midiSpans";
import type { ScoreNote } from "../../score/scoreNotes";
import type { OrnamentSign } from "../../mei/ornamentSigns";
import type { AcceptedAnchor } from "./attribution";
import type { PlayedGroup } from "./grouping";
import { anchorFor, type Anchor } from "./timeMap";
import type { AddedDivergence, AddedReading, DivergenceInput } from "./types";

export interface AddedContext {
    anchors: Anchor[];
    /** The matched notes again, by id, for looking an attributed anchor up */
    anchorByScoreId: Map<string, Anchor>;
    scoreById: Map<string, ScoreNote>;
    /** The head's answers, already judged sure enough to act on */
    accepted: ReadonlyMap<string, AcceptedAnchor>;
    firstMs: number;
    lastMs: number;
    simultaneousMs: number;
    figureNotes: number;
    hasRepeats: boolean;
}

/**
 * The written note a figure belongs to, and where that answer came from.
 *
 * The model's answer wins wherever there is one: it answers which written note
 * this decorates, where the timing can only answer which was struck last.
 *
 * An anchor that itself went unplayed has no performed moment, so `onsetMs` is
 * NaN and every comparison against it is false. Which is right: nothing can be
 * said about two notes being struck together when one never was.
 */
function anchorOf(
    group: PlayedGroup,
    ctx: AddedContext
): {
    anchor: Anchor | undefined;
    from: "model" | "timing" | null;
    gate?: number;
    posterior?: number;
    corroborated?: boolean;
} {
    const named = ctx.accepted.get(group.entries[0].span.id);
    if (named) {
        const said = {
            from: "model",
            gate: named.gate,
            posterior: named.posterior,
            corroborated: named.corroborated,
        } as const;

        const matched = ctx.anchorByScoreId.get(named.scoreId);
        if (matched) return { anchor: matched, ...said };

        const note = ctx.scoreById.get(named.scoreId);
        if (note) {
            return {
                anchor: {
                    scoreId: note.note,
                    onset: note.onset,
                    onsetMs: Number.NaN,
                    pitch: note.pitch,
                },
                ...said,
            };
        }
    }

    const guessed = anchorFor(group.entries[0].span.onsetMs, ctx.anchors);
    return { anchor: guessed, from: guessed ? "timing" : null };
}

export function readPlayed(
    group: PlayedGroup,
    input: DivergenceInput,
    ctx: AddedContext
): AddedDivergence {
    const spans = group.entries.map((entry) => entry.span);
    const onsetMs = spans[0].onsetMs;
    const { anchor, from, gate, posterior, corroborated } = anchorOf(group, ctx);
    const signs = anchor ? input.signs.get(anchor.scoreId) ?? [] : [];

    const { reading, because } = readAdded(
        spans,
        anchor,
        signs,
        ctx,
        from === "model"
            ? { gate: gate ?? 0, posterior: posterior ?? 0, corroborated: !!corroborated }
            : undefined
    );

    return {
        kind: "added",
        id: group.id,
        perfIds: spans.map((span) => span.id),
        pitches: spans.map((span) => span.pitch),
        anchorId: anchor?.scoreId ?? null,
        anchorFrom: anchor ? from : null,
        ...(from === "model" && posterior !== undefined
            ? { anchorConfidence: posterior, anchorCorroborated: !!corroborated }
            : {}),
        signs,
        reading,
        because,
        onsetMs,
        confidence: Math.min(...group.entries.map((entry) => entry.insertion.confidence)),
    };
}

function readAdded(
    spans: NoteSpan[],
    anchor: Anchor | undefined,
    signs: OrnamentSign[],
    ctx: AddedContext,
    attributed?: { gate: number; posterior: number; corroborated: boolean }
): { reading: AddedReading; because: string } {
    const onsetMs = spans[0].onsetMs;

    if (onsetMs < ctx.firstMs || onsetMs > ctx.lastMs) {
        return {
            reading: "outside",
            because: "Played before the first or after the last note the score accounts for.",
        };
    }

    if (anchor && signs.length > 0) {
        const names = [...new Set(signs.map((sign) => sign.name))].join(" and ");
        return {
            reading: "written-ornament",
            because:
                `The score writes a ${names} on this note. Verovio reads an ornament sign as ` +
                `the single note it is written on, so the rest of what was played has no note ` +
                `to match - these are that ornament, performed.` +
                (attributed === undefined
                    ? ""
                    : attributed.corroborated
                      ? ` The model puts ${
                            spans.length === 1 ? "this note" : `all ${spans.length} notes`
                        } on that written note too - it ranks it clearly ahead of every other, ` +
                        `though it is only ${Math.round(attributed.gate * 100)}% sure they ` +
                        `are ornaments at all. The sign is what settles that.`
                      : ` The model puts ${
                            spans.length === 1 ? "this note" : `all ${spans.length} notes`
                        } on that written note as well, ${Math.round(
                            attributed.posterior * 100
                        )}% sure.`),
        };
    }

    // The model was asked which written note this decorates, and answered. That
    // is a different question from the alignment's, and the only evidence here
    // that is about ornamentation rather than about counting and proximity.
    if (anchor && attributed !== undefined) {
        return {
            reading: "ornamentation",
            because:
                `The model reads ${
                    spans.length === 1 ? "this note" : `these ${spans.length} notes`
                } as ornamenting a written note, ${Math.round(attributed.posterior * 100)}% ` +
                `sure, and the score writes no ornament there. It has only ever been taught ` +
                `this on rendered performances, so it is worth looking at.`,
        };
    }

    if (spans.length >= ctx.figureNotes && anchor && nearAnchor(spans, anchor)) {
        return {
            reading: "ornamentation",
            because:
                `${spans.length} notes played quickly around a written note, none more than a ` +
                `few semitones from it, and the score writes no ornament here.`,
        };
    }

    if (anchor && Math.abs(onsetMs - anchor.onsetMs) <= ctx.simultaneousMs) {
        const interval = spans[0].pitch - anchor.pitch;
        if (Math.abs(interval) % 12 === 0 && interval !== 0) {
            const octaves = Math.abs(interval) / 12;
            return {
                reading: "added-octave",
                because:
                    `Struck with a written note, ` +
                    `${octaves === 1 ? "an octave" : `${octaves} octaves`} ` +
                    `${interval > 0 ? "above" : "below"} it.`,
            };
        }
        return {
            reading: "fuller-chord",
            because: "Struck with a written note, at another tone of the chord.",
        };
    }

    if (ctx.hasRepeats) {
        return {
            reading: "repeat-pass",
            because:
                "The score writes its repeats with repeat signs rather than writing them out, " +
                "so everything played on a second pass has no note of its own to match.",
        };
    }

    return {
        reading: "added-note",
        because: "A note of its own, between written ones.",
    };
}

/** Whether a figure stays within a few semitones of the note it surrounds. */
function nearAnchor(spans: NoteSpan[], anchor: Anchor): boolean {
    return spans.every((span) => Math.abs(span.pitch - anchor.pitch) <= 4);
}
