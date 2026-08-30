/**
 * The accidental a note takes from the notation around it, which verovio does
 * not apply.
 *
 * Verovio reads a note's sounding pitch from the note alone: `Note::GetPitchClass`
 * adds `Note::GetChromaticAlteration`, and that returns the alteration of the
 * note's own `<accid>` — the child element the MEI importer makes out of `@accid`
 * and `@accid.ges` — or zero. Nothing in verovio consults the key signature or an
 * accidental written earlier in the same measure. A score that leaves its flats to
 * the key signature, which is ordinary and correct MEI, therefore sounds wrong: in
 * B flat minor every unmarked b, e, a, d and g comes back a semitone too high.
 *
 * It is worth being clear about what that does and does not break, because the
 * failure is silent. The engraving is right — the key signature is drawn and the
 * notes sit where they belong. Verovio's own comparisons are right too, because
 * they compare its pitch against its pitch. It only goes wrong where the pitch
 * meets a number from outside: a MIDI recording of the piece. Aligning
 * `scores/chopin-op9` against its recording matched 711 of 1728 notes before this,
 * and 1682 after it — the aligner was pairing the pitch classes the key signature
 * happens not to touch, and throwing the other 62% away as unplayed.
 *
 * So this module supplies the one thing verovio is missing, and nothing else. It
 * returns the alteration that is *implied* — never one the note states for itself,
 * because verovio has already applied that — so a document that spells every
 * alteration out gets an empty map back and behaves exactly as it did before.
 */

/**
 * Semitones per accidental, as `TransPitch::GetChromaticAlteration` reads them.
 *
 * The union of verovio's two tables, gestural and written. Where both define a
 * value they agree; `nf`, `ns`, `x`, `xs` and `sx` are written-only spellings.
 * The quarter-tone values are commented out in verovio and fall through to zero,
 * so they are left out here for the same answer.
 */
const ALTERATION: Record<string, number> = {
    tf: -3,
    ff: -2,
    f: -1,
    nf: -1,
    n: 0,
    ns: 1,
    s: 1,
    ss: 2,
    x: 2,
    xs: 3,
    sx: 3,
    ts: 3,
};

/** The pitch names a signature takes, in the order signatures add them. */
const FLAT_ORDER = ["b", "e", "a", "d", "g", "c", "f"];
const SHARP_ORDER = ["f", "c", "g", "d", "a", "e", "b"];

/**
 * The alteration each note is missing, in semitones, by `@xml:id`.
 *
 * Only notes that need one are in the map, so `alterations.get(id) ?? 0` is the
 * correction to add to the pitch verovio reports. A note that says what it sounds
 * as — through `@accid`, `@accid.ges`, a child `<accid>`, `@pnum` or `@pname.ges`
 * — is never in it.
 *
 * `onsets` is where each note falls, by `@xml:id`, as verovio's timemap has it.
 * An accidental holds for the rest of its measure, and *the rest* is in sounding
 * time, not in the order the file is written: the layers of a staff are written
 * one after the other, so without the onsets an accidental in the second layer
 * reaches back over the whole of the first. On the app's own transcription that
 * is not hypothetical — an f sharp on the last beat of m. 24 would otherwise
 * sharpen the note the other voice holds from the first. Passing nothing falls
 * back on the written order, which is the same order for a staff of one layer.
 */
export function impliedAlterations(
    meiDoc: Document,
    onsets: Map<string, number> = new Map()
): Map<string, number> {
    const alterations = new Map<string, number>();

    /** The signature for a staff that states none of its own. */
    let scoreKey = new Map<string, string>();
    /** The signature in force per `@n`, for the staves that state one. */
    const staffKeys = new Map<string, Map<string, string>>();

    const visit = (element: Element): void => {
        switch (element.localName) {
            case "scoreDef": {
                const key = keySignatureOf(element);
                if (key) {
                    // A key stated for the whole score replaces what the staves
                    // were doing. The staffDefs of this same scoreDef are visited
                    // next, so a staff that states its own puts it straight back.
                    scoreKey = key;
                    staffKeys.clear();
                }
                break;
            }
            case "staffDef": {
                const key = keySignatureOf(element);
                const n = element.getAttribute("n");
                if (key && n) staffKeys.set(n, key);
                break;
            }
            case "measure":
                visitMeasure(element);
                return;
        }

        for (const child of readableChildren(element)) visit(child);
    };

    /**
     * One measure, which is as far as an accidental reaches: the state below is
     * made here and thrown away at the barline.
     *
     * The notes are gathered first and resolved after, because they have to be
     * resolved in the order they sound and a measure is not written in that
     * order — every layer of a staff starts again at the downbeat. They are
     * gathered per staff, not per `<staff>` element or per layer, because an
     * accidental holds for the staff it stands on and for every voice on it.
     *
     * A key change written inside a measure rather than between two is taken to
     * hold for the whole of that measure. Ordering it against the notes would
     * need a time for it, which the timemap does not give; a key changes at a
     * barline in any case, and a converter that writes one puts a `<scoreDef>`
     * between the measures.
     */
    const visitMeasure = (measure: Element): void => {
        const perStaff = new Map<string, Element[]>();

        const gather = (element: Element, staffN: string | undefined): void => {
            switch (element.localName) {
                case "staff":
                    staffN = element.getAttribute("n") ?? "";
                    break;
                case "keySig":
                    if (staffN !== undefined) staffKeys.set(staffN, accidentalsOf(element));
                    return;
                case "note":
                    if (staffN !== undefined) {
                        const notes = perStaff.get(staffN);
                        if (notes) notes.push(element);
                        else perStaff.set(staffN, [element]);
                    }
                    return;
            }

            for (const child of readableChildren(element)) gather(child, staffN);
        };

        gather(measure, undefined);

        for (const [staffN, notes] of perStaff) {
            /** What a pitch was last altered to in this measure, by name and octave. */
            const carried = new Map<string, string>();
            for (const note of inSoundingOrder(notes, onsets)) resolve(note, staffN, carried);
        }
    };

    const resolve = (note: Element, staffN: string, carried: Map<string, string>): void => {
        const pname = note.getAttribute("pname");
        const id = note.getAttribute("xml:id");
        if (!pname || !id) return;

        // `Note::GetMIDIPitch` returns @pnum as it stands, without looking at any
        // accidental at all, and a note carrying @pname.ges has already been told
        // what it sounds as. Neither is something the notation around it can
        // correct, so both are left alone.
        if (note.hasAttribute("pnum") || note.hasAttribute("pname.ges")) return;

        // An accidental applies to the pitch it stands on, in that octave only
        const written = `${pname}${note.getAttribute("oct") ?? ""}`;

        const own = ownAccidental(note);
        if (own !== undefined) {
            carried.set(written, own);
            return;
        }

        const signature = staffKeys.get(staffN) ?? scoreKey;
        const accid = carried.get(written) ?? signature.get(pname);
        if (accid === undefined) return;

        const alteration = ALTERATION[accid] ?? 0;
        if (alteration !== 0) alterations.set(id, alteration);
    };

    // From <music> rather than from the root, so that a <score> quoted in the
    // header - an <incip> holds one - cannot change the key of the piece
    const music = meiDoc.querySelector("music") ?? meiDoc.documentElement;
    if (music) visit(music);

    return alterations;
}

/**
 * The notes in the order they sound, and in the order they are written wherever
 * the timemap says nothing — which is every note of a document nothing was read
 * for, so that the walk still works without one.
 */
function inSoundingOrder(notes: Element[], onsets: Map<string, number>): Element[] {
    if (onsets.size === 0) return notes;

    return notes
        .map((note, index) => ({
            note,
            index,
            onset: onsets.get(note.getAttribute("xml:id") ?? ""),
        }))
        .sort((a, b) => {
            // A note the timemap has nothing for goes last, where it cannot alter
            // anything that sounds before it. Two of them keep their written order,
            // which `Infinity - Infinity` would otherwise decide with a NaN.
            const byOnset = (a.onset ?? Infinity) - (b.onset ?? Infinity);
            return Number.isNaN(byOnset) || byOnset === 0 ? a.index - b.index : byOnset;
        })
        .map((entry) => entry.note);
}

/**
 * The accidental the note states for itself, or nothing.
 *
 * `@accid.ges` before `@accid`, which is the order
 * `TransPitch::GetChromaticAlteration` tries them in, and a descendant `<accid>`
 * last — that is what `Note::GetDrawingAccid` finds, and the MEI importer turns
 * both attributes into one of those anyway.
 *
 * An `<accid>` carrying neither attribute answers `n` rather than nothing. It says
 * as little as an element can, but verovio has an accidental for the note either
 * way and gets zero out of it, so the note is altered by nothing rather than by
 * the key signature.
 */
function ownAccidental(note: Element): string | undefined {
    const stated = note.getAttribute("accid.ges") ?? note.getAttribute("accid");
    if (stated !== null) return stated;

    const accid = note.querySelector("accid");
    if (!accid) return undefined;

    return accid.getAttribute("accid.ges") ?? accid.getAttribute("accid") ?? "n";
}

/**
 * The signature this scoreDef or staffDef states, or nothing if it states none.
 *
 * Nothing and an empty map are different answers: a `<keySig sig="0"/>` cancels
 * whatever was in force, while a staffDef that carries no key at all — the mid-score
 * one that only changes a clef, say — leaves it alone.
 */
function keySignatureOf(element: Element): Map<string, string> | undefined {
    for (const child of element.children) {
        if (child.localName === "keySig") return accidentalsOf(child);
    }

    // The attribute form, from before <keySig> became an element
    const attribute = element.getAttribute("key.sig") ?? element.getAttribute("keysig");
    return attribute === null ? undefined : signatureAccidentals(attribute);
}

/** What a `<keySig>` alters, by pitch name. */
function accidentalsOf(keySig: Element): Map<string, string> {
    // A signature that is not one of the ordinary ones writes itself out
    const written = [...keySig.children].filter((child) => child.localName === "keyAccid");
    if (written.length > 0) {
        return new Map(
            written.flatMap((accid) => {
                const pname = accid.getAttribute("pname");
                const value = accid.getAttribute("accid");
                return pname && value ? ([[pname, value]] as [string, string][]) : [];
            })
        );
    }

    return signatureAccidentals(keySig.getAttribute("sig") ?? "");
}

/** The pitch names `5f`, `3s` and the like alter, and what to. */
function signatureAccidentals(sig: string): Map<string, string> {
    const match = /^(\d+)([fs])$/.exec(sig.trim());
    // "0", "mixed" and anything unreadable alter nothing
    if (!match) return new Map();

    const order = match[2] === "f" ? FLAT_ORDER : SHARP_ORDER;
    return new Map(order.slice(0, Number(match[1])).map((pname) => [pname, match[2]]));
}

/**
 * The children verovio reads, which is one branch only of an `<app>` or a
 * `<choice>`.
 *
 * `MEIInput::ReadAppChildren` shows the branch: the first of the configured
 * `appXPathQuery` expressions that matches, and the first child otherwise. The
 * toolkit asks for `./rdg[contains(@source, 'performance')]`, so that is the rule
 * mirrored here. Reading the unchosen branch as well would be wrong in one way
 * that matters: an accidental in a reading nobody plays would carry to the notes
 * after it.
 */
function readableChildren(element: Element): Element[] {
    if (element.localName !== "app" && element.localName !== "choice") {
        return [...element.children];
    }

    const branches = [...element.children];
    const performance = branches.find(
        (branch) =>
            branch.localName === "rdg" &&
            (branch.getAttribute("source") ?? "").includes("performance")
    );

    const chosen = performance ?? branches[0];
    return chosen ? [chosen] : [];
}
