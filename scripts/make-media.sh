#!/usr/bin/env bash
# Turn docs/media/demo.webm into a small mp4 and gif, then delete the webm.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
webm="$root/docs/media/demo.webm"
mp4="$root/docs/media/demo.mp4"
gif="$root/docs/media/demo.gif"
palette="$(mktemp "${TMPDIR:-/tmp}/torq-palette.XXXXXX.png")"

cleanup() { rm -f "$palette"; }
trap cleanup EXIT

if [[ ! -f "$webm" ]]; then
  echo "missing $webm — run npm run capture first" >&2
  exit 1
fi

ffmpeg -y -i "$webm" -an -c:v libx264 -pix_fmt yuv420p -crf 28 -movflags +faststart "$mp4"
ffmpeg -y -i "$webm" -vf "fps=8,scale=800:-1:flags=lanczos,palettegen" -update 1 "$palette"
ffmpeg -y -i "$webm" -i "$palette" -lavfi "fps=8,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse" -loop 0 "$gif"
rm -f "$webm"

limit=$((10 * 1024 * 1024))
fail=0
for file in "$mp4" "$gif"; do
  bytes="$(wc -c < "$file" | tr -d ' ')"
  awk -v bytes="$bytes" -v name="$file" 'BEGIN { printf "%s  %.2f MB (%d bytes)\n", name, bytes / 1024 / 1024, bytes }'
  if (( bytes >= limit )); then
    echo "error: $file is over 10 MB" >&2
    fail=1
  fi
done
exit "$fail"
