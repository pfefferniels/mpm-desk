#!/usr/bin/env bash
#
# Builds the WebAssembly toolkit from the verovio fork that carries the
# performance alignment (see include/vrv/performance.h there) and assembles it
# as the vendored `verovio` package this project depends on.
#
# The built artefacts are committed, so this only needs to run when the fork
# changes. Override the locations with VEROVIO_ROOT / EMSDK_ROOT / VEROVIO_BRANCH.
#
set -euo pipefail

VEROVIO_ROOT=${VEROVIO_ROOT:-"$HOME/Projects/verovio"}
EMSDK_ROOT=${EMSDK_ROOT:-"$HOME/emsdk"}
VEROVIO_BRANCH=${VEROVIO_BRANCH:-aligned-mei}

HERE=$(cd "$(dirname "$0")/.." && pwd)
VENDOR="$HERE/vendor/verovio"

[ -d "$VEROVIO_ROOT/emscripten" ] || { echo "No verovio checkout at $VEROVIO_ROOT" >&2; exit 1; }
[ -f "$EMSDK_ROOT/emsdk_env.sh" ] || { echo "No emsdk at $EMSDK_ROOT" >&2; exit 1; }

branch=$(git -C "$VEROVIO_ROOT" rev-parse --abbrev-ref HEAD)
if [ "$branch" != "$VEROVIO_BRANCH" ]; then
    echo "$VEROVIO_ROOT is on '$branch', expected '$VEROVIO_BRANCH'" >&2
    exit 1
fi

# shellcheck disable=SC1091
source "$EMSDK_ROOT/emsdk_env.sh" >/dev/null

cd "$VEROVIO_ROOT/emscripten"

# -w webassembly, -m modularized ES module, -H without the Humdrum importer,
# -M clean makefile, -c progress. This is what the official package ships as
# its `verovio/wasm` entry point.
echo "Building the toolkit from $VEROVIO_ROOT ($VEROVIO_BRANCH)..."
./buildToolkit -c -w -M -H -m

# The JavaScript wrapper around the module is plain source, rolled up as is
[ -d npm/node_modules ] || npm --prefix npm install
npm --prefix npm run build

mkdir -p "$VENDOR/dist"
cp build/verovio.js "$VENDOR/dist/verovio-module.mjs"
cp npm/dist/verovio.mjs npm/dist/verovio.cjs "$VENDOR/dist/"

cat > "$VENDOR/build-info.json" <<EOF
{
    "branch": "$VEROVIO_BRANCH",
    "commit": "$(git -C "$VEROVIO_ROOT" rev-parse HEAD)",
    "describes": "$(git -C "$VEROVIO_ROOT" log -1 --format=%s)",
    "builtOn": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "emscripten": "$(emcc --version | head -1 | sed 's/.*) //; s/ .*//')"
}
EOF

echo "Vendored into $VENDOR"
ls -la "$VENDOR/dist"
