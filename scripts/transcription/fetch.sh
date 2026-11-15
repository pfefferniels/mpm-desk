#!/bin/sh
# Fetch the corpus the transcription was measured on: Chopin on red Welte rolls from the Stanford
# University Piano Roll Archive, against the first editions encoded by the Fryderyk Chopin
# Institute.
#
#     scripts/transcription/fetch.sh <corpus dir>
#
# Neither is kept in this repository. SUPRA is CC BY-NC-SA 4.0 (Shi, Sapp, Arul, McBride and
# Smith, ISMIR 2019; https://github.com/pianoroll/SUPRA), the editions are the Institute's
# (https://github.com/pl-wnifc/humdrum-chopin-first-editions), and both are a download away.
set -eu

dir=${1:?usage: fetch.sh <corpus dir>}
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$dir/midi" "$dir/kern" "$dir/mei"
cp "$here/manifest.tsv" "$dir/manifest.tsv"

grep -v '^#' "$here/manifest.tsv" | while IFS="$(printf '\t')" read -r roll score title performer; do
    [ -n "$roll" ] || continue
    [ -s "$dir/midi/$roll.mid" ] || curl -sSf -o "$dir/midi/$roll.mid" \
        "https://raw.githubusercontent.com/pianoroll/SUPRA/master/welte-red/midi-exp/${roll}_exp.mid"
    [ -s "$dir/kern/$score.krn" ] || curl -sSf -o "$dir/kern/$score.krn" \
        "https://raw.githubusercontent.com/pl-wnifc/humdrum-chopin-first-editions/main/kern/$score.krn"
done

# The vendored verovio reads no Humdrum, so the conversion is done by the released build that does
if [ ! -d "$dir/verovio/package" ]; then
    mkdir -p "$dir/verovio"
    (cd "$dir/verovio" && npm pack --silent verovio@6.3.0 >/dev/null && tar xzf verovio-6.3.0.tgz)
fi
node "$here/kern2mei.mjs" "$dir/verovio/package" "$dir/kern" "$dir/mei"

echo "$(ls "$dir/midi" | wc -l) rolls, $(ls "$dir/mei" | wc -l) scores in $dir"
