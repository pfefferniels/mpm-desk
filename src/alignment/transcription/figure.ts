/**
 * Which ornament sign a played figure would be written as, were it written as a sign.
 *
 * Only ever an offer. A sign says less than the notes do: it names the kind of figure and
 * leaves the playing of it to the recording, which is why the transcriber writes the notes out
 * and leaves the sign for a reader who knows the figure is conventional.
 */

export type FigureSign =
    | { name: "trill" }
    | { name: "mordent"; form: "upper" | "lower" }
    | { name: "turn" };

/**
 * Read a figure against the note it decorates.
 *
 * Both neighbours touched is a turn; one neighbour, struck more than once, a trill; one
 * neighbour once, a mordent, upper or lower by which it was. A figure that touches neither is
 * called a trill for want of anything better, which is what the desk has always offered.
 */
export function signFor(pitches: readonly number[], anchorPitch: number): FigureSign {
    const upper = pitches.filter((pitch) => pitch - anchorPitch >= 1 && pitch - anchorPitch <= 2).length;
    const lower = pitches.filter((pitch) => anchorPitch - pitch >= 1 && anchorPitch - pitch <= 2).length;

    if (upper > 0 && lower > 0) return { name: "turn" };
    if (upper > 1 || lower > 1 || pitches.length >= 4) return { name: "trill" };
    if (lower === 1) return { name: "mordent", form: "lower" };
    if (upper === 1) return { name: "mordent", form: "upper" };
    return { name: "trill" };
}

/**
 * The signs a reader may pick between, by the name the decision is kept under.
 *
 * What {@link signFor} reads off a figure is a guess at which of these it is, and a reader who
 * knows the figure knows better: a turn played with a slip in it is still a turn.
 */
export const SIGN_KINDS = ["trill", "mordent-upper", "mordent-lower", "turn"] as const;
export type SignKind = (typeof SIGN_KINDS)[number];

export const isSignKind = (value: unknown): value is SignKind =>
    typeof value === "string" && (SIGN_KINDS as readonly string[]).includes(value);

export const signOf = (kind: SignKind): FigureSign =>
    kind === "mordent-upper"
        ? { name: "mordent", form: "upper" }
        : kind === "mordent-lower"
          ? { name: "mordent", form: "lower" }
          : { name: kind };

export const kindOf = (sign: FigureSign): SignKind =>
    sign.name === "mordent" ? `mordent-${sign.form}` : sign.name;
