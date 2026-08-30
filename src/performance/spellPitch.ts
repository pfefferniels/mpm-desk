// https://chatgpt.com/share/68968374-dfb0-8005-8adf-f2bacdb54c7c

type Mode = "major" | "minor";
type SpelledNote = { midi: number; name: string; pc: number; octave: number };

const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER  = ["B", "E", "A", "D", "G", "C", "F"];

// Natural pitch classes in C major, by letter:
const NAT_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11
};

// Circle-of-fifths positions (major tonics). 0 = C, +1 = G, ... -1 = F, etc.
const FIFTHS_INDEX_MAJOR: Record<string, number> = {
  "C": 0,  "G": 1,  "D": 2,  "A": 3,  "E": 4,  "B": 5,  "F#": 6,  "C#": 7,
  "F": -1, "Bb": -2,"Eb": -3,"Ab": -4,"Db": -5,"Gb": -6,"Cb": -7
};

// Compute number of sharps (positive) or flats (negative) for a key.
function keyAccidentalCount(tonic: string, mode: Mode): number {
  // For minor, use the relative major a minor third up (add 3 semitones on the circle: +3 fifths ≡ relative major).
  // On the circle of fifths, relative major is +3 steps from the minor tonic name *as spelled*;
  // but to keep things simple, we map minor tonic to its relative major name explicitly via a table.
  const REL_MAJ_FOR_MINOR: Record<string, string> = {
    "A":"C","E":"G","B":"D","F#":"A","C#":"E","G#":"B","D#":"F#","A#":"C#",
    "D":"F","G":"Bb","C":"Eb","F":"Ab","Bb":"Db","Eb":"Gb","Ab":"Cb"
  };

  let majorTonic = tonic;
  if (mode === "minor") {
    majorTonic = REL_MAJ_FOR_MINOR[tonic];
    if (!majorTonic) throw new Error(`Unsupported minor tonic '${tonic}'. Use spellings like A, F#, Bb, etc.`);
  }

  const k = FIFTHS_INDEX_MAJOR[majorTonic];
  if (k === undefined) throw new Error(`Unsupported tonic '${tonic}'.`);
  return k; // +n sharps, -n flats
}

// Build the key signature: which letters carry # or b in this key
function keySignature(tonic: string, mode: Mode): Record<string, "" | "#" | "b"> {
  const n = keyAccidentalCount(tonic, mode);
  const sig: Record<string, "" | "#" | "b"> = { A:"", B:"", C:"", D:"", E:"", F:"", G:"" };

  if (n > 0) {
    for (let i = 0; i < n; i++) sig[SHARP_ORDER[i]] = "#";
  } else if (n < 0) {
    for (let i = 0; i < -n; i++) sig[FLAT_ORDER[i]] = "b";
  }
  return sig;
}

// Map letter + accidental (nat/#/b) to pitch class
function letterAccToPc(letter: string, acc: "" | "#" | "b"): number {
  const base = NAT_PC[letter];
  const delta = acc === "#" ? 1 : acc === "b" ? -1 : 0;
  return (base + delta + 12) % 12;
}

// Given a pitch class and a key signature, choose a (letter, accidental) spelling.
// Strategy:
//  1) Prefer a candidate whose accidental matches the key signature for that letter (i.e., diatonic).
//  2) Otherwise, prefer # in sharp keys, b in flat keys.
//  3) Tie-break by choosing the alphabetically first letter (stable & deterministic).
function spellPcInKey(pc: number, sig: Record<string, "" | "#" | "b">): { letter: string; accidental: "" | "#" | "b" } {
  const letters = ["A","B","C","D","E","F","G"];
  const candidates: Array<{ letter: string; accidental: "" | "#" | "b" }> = [];

  for (const L of letters) {
    for (const acc of ["", "#", "b"] as const) {
      if (letterAccToPc(L, acc) === pc) candidates.push({ letter: L, accidental: acc });
    }
  }

  // 1) Diatonic match
  const diatonic = candidates.filter(c => sig[c.letter] === c.accidental);
  if (diatonic.length) {
    // If multiple, choose stable alphabetical
    diatonic.sort((a, b) => a.letter.localeCompare(b.letter));
    return diatonic[0];
  }

  // 2) Preference by signature tendency
  const sharpCount = Object.values(sig).filter(a => a === "#").length;
  const flatCount  = Object.values(sig).filter(a => a === "b").length;
  const prefer: "#" | "b" = sharpCount >= flatCount ? "#" : "b";

  const preferSet = candidates.filter(c => c.accidental === prefer);
  if (preferSet.length) {
    preferSet.sort((a, b) => a.letter.localeCompare(b.letter));
    return preferSet[0];
  }

  // 3) Fallback: naturals if nothing else matched (should only happen in C major/A minor with odd pcs)
  const naturals = candidates.filter(c => c.accidental === "");
  if (naturals.length) {
    naturals.sort((a, b) => a.letter.localeCompare(b.letter));
    return naturals[0];
  }

  // Should never get here, but just in case:
  candidates.sort((a, b) => a.letter.localeCompare(b.letter));
  return candidates[0];
}

export function spellMidi(midi: number, tonic: string, mode: Mode = "major"): SpelledNote {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const sig = keySignature(tonic, mode);
  const { letter, accidental } = spellPcInKey(pc, sig);
  return { midi, pc, octave, name: `${letter}${accidental}${octave}` };
}

