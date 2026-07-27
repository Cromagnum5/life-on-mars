#!/usr/bin/env bash
# Renders the combat sim headlessly so effects and poses can be judged as a
# picture rather than as code. The sim's `t` parameter steps a fixed timestep
# fight to an exact moment, so every capture is reproducible.
#
#   tools/capture_sim.sh OUTPUT_DIR [MATCHUP] [SEED] [TIME...]
#
# Example: tools/capture_sim.sh /tmp/sheet 3v2 5 3 6 9 12
#
# EXTRA appends further sim parameters, which is how a pose gets judged rather
# than a fight: `EXTRA='zoom=9&hud=0'` fills the frame with one fighter. Every
# URL it builds is printed, and opening one in a browser shows that exact
# frame — this is the whole point of the tool. A pose argued from anything but
# these pictures is a pose argued from a renderer nobody is looking at.
#
#   EXTRA='zoom=9&hud=0' tools/capture_sim.sh /tmp/sheet "1h v 1" 3 1.3 1.6 1.9
#
# Requires a dev server (npm run dev) and a Chromium binary. Set CHROME to
# override the binary and SIM_URL to point at a different origin/port.

set -euo pipefail

OUTPUT_DIR="${1:?output directory required}"
MATCHUP="${2:-1v1}"
SEED="${3:-1}"
shift 3 2>/dev/null || shift $(($#))
TIMES=("$@")
if [ ${#TIMES[@]} -eq 0 ]; then
  TIMES=(2 4 6 8 10 12)
fi

CHROME="${CHROME:-$HOME/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome}"
SIM_URL="${SIM_URL:-http://localhost:5173/sim.html}"
SIZE="${SIZE:-1280,860}"

mkdir -p "$OUTPUT_DIR"

EXTRA="${EXTRA:-}"

for TIME in "${TIMES[@]}"; do
  URL="${SIM_URL}?matchup=${MATCHUP}&seed=${SEED}&t=${TIME}${EXTRA:+&$EXTRA}"
  OUT="${OUTPUT_DIR}/${MATCHUP}-seed${SEED}-t${TIME}.png"
  "$CHROME" --headless=new --no-sandbox --disable-gpu \
    --enable-unsafe-swiftshader --use-gl=swiftshader \
    --hide-scrollbars --force-device-scale-factor=1 \
    --virtual-time-budget=9000 --window-size="$SIZE" \
    --screenshot="$OUT" "$URL" >/dev/null 2>&1
  echo "$OUT"
  echo "  $URL"
done
