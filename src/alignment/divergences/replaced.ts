import type { AcceptedAnchor } from "./attribution";
import type { PlayedGroup, UnplayedGroup } from "./grouping";
import { expectedMs } from "./timeMap";
import type { DivergenceSettings, ReplacedDivergence, ReplacedReading } from "./types";

/**
 * Match up the halves of a substitution.
 *
 * A written note that went unplayed and a played note that answered to nothing
 * are one event when the second falls where the first was due. Only single notes
 * are paired: a run of played notes against a run of written ones is a passage
 * played differently, which is a larger claim than this should make on its own.
 *
 * Pairs are taken cheapest first, and each half may be used once, so the closest
 * reading wins and nothing is counted twice.
 */
export function pairReplacements(
    played: PlayedGroup[],
    unplayed: UnplayedGroup[],
    map: { onset: number; ms: number }[],
    accepted: ReadonlyMap<string, AcceptedAnchor>,
    settings: DivergenceSettings
): { replaced: ReplacedDivergence[]; playedLeft: PlayedGroup[]; unplayedLeft: UnplayedGroup[] } {
    const candidates: {
        playedIndex: number;
        unplayedIndex: number;
        lateMs: number;
        semitones: number;
        cost: number;
    }[] = [];

    // A played note the model has already accounted for is not a loose half
    // looking for a partner. Falling at the moment a written note was due is a
    // coincidence; being named as that note's ornament is an answer, and the
    // reader can still overrule it at the note itself.
    const singles = played
        .map((group, index) => ({ group, index }))
        .filter(
            (entry) =>
                entry.group.entries.length === 1 &&
                !accepted.has(entry.group.entries[0].span.id)
        );

    unplayed.forEach((group, unplayedIndex) => {
        if (group.entries.length !== 1) return;

        const written = group.entries[0].note;
        const due = expectedMs(written.onset, map);
        if (due === undefined) return;

        for (const { group: candidate, index: playedIndex } of singles) {
            const span = candidate.entries[0].span;
            const lateMs = span.onsetMs - due;
            const semitones = span.pitch - written.pitch;

            if (Math.abs(lateMs) > settings.replacementMs) continue;
            if (Math.abs(semitones) > settings.replacementSemitones) continue;

            candidates.push({
                playedIndex,
                unplayedIndex,
                lateMs,
                semitones,
                cost:
                    Math.abs(lateMs) / settings.replacementMs +
                    Math.abs(semitones) / (settings.replacementSemitones + 1),
            });
        }
    });

    candidates.sort((a, b) => a.cost - b.cost);

    const usedPlayed = new Set<number>();
    const usedUnplayed = new Set<number>();
    const replaced: ReplacedDivergence[] = [];

    for (const candidate of candidates) {
        if (usedPlayed.has(candidate.playedIndex)) continue;
        if (usedUnplayed.has(candidate.unplayedIndex)) continue;
        usedPlayed.add(candidate.playedIndex);
        usedUnplayed.add(candidate.unplayedIndex);

        const { insertion, span } = played[candidate.playedIndex].entries[0];
        const { deletion, note } = unplayed[candidate.unplayedIndex].entries[0];
        const { reading, because } = readReplaced(candidate.semitones, candidate.lateMs);

        replaced.push({
            kind: "replaced",
            id: `replaced-${unplayed[candidate.unplayedIndex].id}`,
            scoreId: note.note,
            perfId: span.id,
            pitches: [note.pitch, span.pitch],
            reading,
            because,
            onset: note.onset,
            onsetMs: span.onsetMs,
            lateMs: candidate.lateMs,
            confidence: Math.min(insertion.confidence, deletion.confidence),
        });
    }

    replaced.sort((a, b) => a.onsetMs - b.onsetMs);

    return {
        replaced,
        playedLeft: played.filter((_, index) => !usedPlayed.has(index)),
        unplayedLeft: unplayed.filter((_, index) => !usedUnplayed.has(index)),
    };
}

function readReplaced(
    semitones: number,
    lateMs: number
): { reading: ReplacedReading; because: string } {
    const where = `where the score writes it${
        Math.abs(lateMs) < 20 ? "" : `, ${Math.abs(lateMs).toFixed(0)} ms ${lateMs > 0 ? "late" : "early"}`
    }`;

    if (semitones === 0) {
        return {
            reading: "unmatched-pair",
            because:
                `The written note itself, played ${where}, which the aligner did not ` +
                `pair with it. Nothing was added and nothing left out; the alignment ` +
                `simply has a hole here.`,
        };
    }

    if (semitones % 12 === 0) {
        const octaves = Math.abs(semitones) / 12;
        return {
            reading: "octave-displaced",
            because:
                `The written note taken ${octaves === 1 ? "an octave" : `${octaves} octaves`} ` +
                `${semitones > 0 ? "higher" : "lower"}, played ${where}.`,
        };
    }

    if (Math.abs(semitones) <= 2) {
        return {
            reading: "neighbour-slip",
            because:
                `${intervalWords(semitones)} the written note, played ${where}. ` +
                `A neighbour struck instead of the note itself is the commonest slip there is.`,
        };
    }

    return {
        reading: "different-note",
        because: `${intervalWords(semitones)} the written note, played ${where}.`,
    };
}

/** How far off a substitute was, said in words rather than in semitones. */
function intervalWords(semitones: number): string {
    const distance = Math.abs(semitones);
    const size =
        distance === 1
            ? "A semitone"
            : distance === 2
              ? "A tone"
              : `${distance} semitones`;
    return `${size} ${semitones > 0 ? "above" : "below"}`;
}
