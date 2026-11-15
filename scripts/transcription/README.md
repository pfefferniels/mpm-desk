# Measuring the transcription

`src/alignment/transcription` writes what a performer played differently into the score, without
asking. These scripts are how it is known how well it does that: on real piano rolls, against
published scores, with the aligner the app ships.

## The corpus

Thirty-two red Welte rolls of Chopin from the
[Stanford University Piano Roll Archive](https://github.com/pianoroll/SUPRA) (Shi, Sapp, Arul,
McBride and Smith, ISMIR 2019), recorded for Welte-Mignon by d'Albert, Busoni, Carreño, Hofmann,
Paderewski, Pachmann, Saint-Saëns, Sauer and others, each against the first edition of
its piece as encoded by the Fryderyk Chopin Institute
([humdrum-chopin-first-editions](https://github.com/pl-wnifc/humdrum-chopin-first-editions)):
twelve nocturnes, six preludes, eight etudes, five waltzes and the Berceuse. `manifest.tsv` names
the pairs and says which were left out and why.

Neither is kept here. SUPRA is CC BY-NC-SA 4.0 and both are a download away:

```sh
scripts/transcription/fetch.sh ../corpus          # rolls, scores, and the scores as MEI
npx vite-node scripts/transcription/align.ts ../corpus    # the model, once: a few seconds a roll
```

`align.ts` runs the shipped checkpoint under Node and keeps what it said in `align/`, so that
everything below reads it from there. The scripts run the app's own code; `node.ts` supplies the
two things a browser has and Node has not.

## What there is no ground truth for, and what stands in for it

Nobody has written out by hand what these pianists added. So two questions are asked instead,
each of which has an answer.

### Can it put back a note it has been denied?

```sh
npx vite-node scripts/transcription/holdout.ts ../corpus
```

A written note that was matched is taken out of the score, and the note that was played for it
is handed to the transcriber as though the performer had added it. What comes back is held
against what Chopin wrote. The timing is real, a pianist on a Welte roll; only the question is
constructed. Four of them, for the four relations an added note can stand in to the text:

| | hidden | asked | placed exactly where written | a sixteenth-note grid on the same tempo | nearest grid place, no prior |
| --- | --- | ---: | ---: | ---: | ---: |
| alone | a whole moment of the score, every note written at it | 7,408 | **77.4%** | 69.6% | 55.3% |
| run | two to five moments in a row | 6,841 | **76.2%** | 62.3% | 47.8% |
| chord | one note of a moment whose other notes stay | 3,874 | **89.0%** | 78.2% | 67.0% |

The two columns on the right are what a transcriber without a model of the music does: snap to
sixteenths, which is what notation software calls quantising, or to whatever is nearest. Both use
the same tempo map, so the difference is what the prior is worth, the score's own neighbouring
bars saying which note values the passage moves in.

What is left wrong is mostly not the model's to get right. In 4.5% of the "alone" cases the
hidden note stands on an irregular tuplet no grid has, in 3.7% it was struck out of order with
its neighbours, one hand ahead of the other; the rest is a pianist of 1905 playing two notes
that are written a quaver apart forty milliseconds apart.

With the place given, the rest of the notation, over 11,282 notes:

| | right |
| --- | ---: |
| the staff | 94.8% |
| the spelling (letter and accidental) | 98.6% |
| the note value, of 3,869 notes standing alone | 84.0% (39.4% by how long the key was held) |

The last line is why a note is written as long as it is to the next note in its hand and not as
long as the key was down.

**Grace notes are not found.** Of 559 grace notes the scores write, 13% come back as grace
notes and 86% as measured notes. That is the model being held to it: on these rolls a written
grace note takes a median of 144 ms before its note and a quarter of them over 276 ms, which is
the length of the measured notes around them, and a model that called more of them grace notes
called several times as many measured notes grace notes too. So measured is what it writes,
fewer than one measured note in a hundred is taken for a grace note, and grace notes are what a
reader asks for afterwards, by a click.

### What does one performance change?

```sh
npx vite-node scripts/transcription/deviations.ts ../corpus <roll>
```

Writes `out/<roll>.deviations.html`: every bar the performer played differently, the score's
bar above and the played one below, coloured as the alignment desk colours them. It is the
quickest way to read a transcription, and the way the tie rules were found: against Schumann's
text of *Träumerei* (made from the DCML corpus by `dcml2mei.ts`), Alfred Grünfeld's Welte roll
differs in six ties he does not hold and in nothing else.

### Does the score then explain the recording?

```sh
npx vite-node scripts/transcription/transcribe.ts ../corpus
```

Every roll is aligned, transcribed, and the result held to five things. Thirty rolls (the two
scans that come out transposed are left out here):

| | |
| --- | --- |
| verovio reads the transcribed score | 30 of 30 |
| written notes of the source that moved, or changed pitch | **0** of 49,617 |
| notes the transcriber says it wrote that are not in the score at the pitch played | **0** of 2,791 |
| taking the readings out gives back the document that went in | 30 of 30 |
| written-in notes the aligner pairs with the very key that was played, when run again | 2,639 of 2,791 (**94.6%**) |

The last is the model that found the differences being asked whether they are gone. Played notes
with no written note fall from 3,847 to 1,129, and written notes with no played one from 3,589 to
1,511.

What stays is what should. 999 groups of "unplayed" notes are a unison written in two voices and
played as the one key it is; 144 groups of "added" notes are a trill or a turn the score writes
as a sign, being played; the rest is repeats the engraving shows once and passages the roll plays
from another version of the piece, neither of which this score has a bar for.

## What the model is, and after whom

Placing a played note is rhythm transcription, which has a literature. The formulation is
Cemgil, Desain and Kappen's (*Computer Music Journal* 24/2, 2000): a prior over places in the
bar, a likelihood of the moment the note was struck given the place, the most probable reading
taken. The search is the dynamic programming of the metrical hidden Markov models, Raphael
(*Artificial Intelligence* 137, 2002) and Nakamura, Yoshii and Sagayama (*IEEE/ACM TASLP* 25/4,
2017), from whom the 35 ms within which keys count as struck together is taken. The grace note
as one more hypothesis beside the grid positions is Foscarin, Jacquemard, Rigaux and Sakai's
(*MCM* 2019). Writing a note as long as it is to the next onset rather than as long as it was
held follows Nakamura, Yoshii and Dixon (*TASLP* 25/9, 2017). Spelling by the line of fifths is
Temperley's (*The Cognition of Basic Musical Structures*, 2001).

All of those transcribe blind and have to infer the tempo, the metre and the key. Here the
matched notes give the tempo within a fraction of a second, and the score gives the rest. None of
them, and nothing else that could be found, notates the notes an alignment leaves unmatched:
Nakamura, Yoshii and Katayose (ISMIR 2017) classify them as extra, missing or wrong, Gingras and
McAdams (*JNMR* 40/1, 2011) tell ornaments from errors, Peter et al. (*TISMIR* 6/1, 2023) leave
them as insertions.

Every number in the model is measured on this corpus or taken from one of the above:
`holdout.ts key=a,b,c` sweeps a setting, and `levels.ts` is where the generic prior over metrical
levels comes from.

## What it does not do

- **Tie an added note.** An added note is one note value, cut at the barline and at the end of
  a triplet. Ties the score has are another matter: one that was not held is taken away and one
  that was played where none is written is put in, as readings of the `<tie>` alone.
- **Ties written as `@tie`.** Only a `<tie>` element can be given a reading. A score that writes
  its ties as attributes on the notes has a re-struck note written in as a new note.
- **Tuplets other than triplets.** A note between the notes of a quintuplet is written on the
  nearest place a duple or triple grid has.
- **Leave a played note out.** What was played is written, as notes, grace notes or a sign. A
  note struck before the first matched note or after the last is read against the score's own
  ends. Two things stay out because the score has nowhere for them: the notes of an ornament
  the score already writes as a sign, and a note played on a repeat the engraving shows once.
- **Cuts.** A passage the recording passes over without taking its time is left as written,
  since a cut is a statement about bars and not about each note in them.
- **Two takes.** `<rdg source="performance">` is one reading. Transcribing a second recording of
  a score takes the first one's readings out; the first keeps its matching.
- **Courtesy accidentals in the source's own reading.** Where a new accidental would have changed
  a written note after it, that note has its own accidental restated. The mark is removable and
  `untranscribed` removes it, but while the transcription stands the source's reading shows an
  accidental the source does not print.
