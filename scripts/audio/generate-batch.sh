#!/usr/bin/env bash
# Safe wrapper around generate-backings.py for memory-constrained laptops.
#
# Each track is generated in a fresh Python process so the OS reclaims
# the model + activation footprint between runs. Use this instead of
# `--count` when you want N tracks of a vibe without crashing the laptop.
#
# Usage:
#   ./scripts/audio/generate-batch.sh <vibe> <count> [extra args...]
#
# Examples:
#   ./scripts/audio/generate-batch.sh upbeat 4
#   ./scripts/audio/generate-batch.sh melodic 6 --bpm 110
#
# Each run between iterations sleeps for COOLDOWN seconds (default 5).
# Bump it if Activity Monitor still shows pressure when the next run kicks.

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <vibe> <count> [extra args...]" >&2
  echo "       vibe: upbeat | melodic | smooth" >&2
  exit 2
fi

VIBE="$1"
COUNT="$2"
shift 2

COOLDOWN="${COOLDOWN:-5}"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PY_SCRIPT="$REPO_ROOT/scripts/audio/generate-backings.py"

if [[ ! -f "$PY_SCRIPT" ]]; then
  echo "[error] missing $PY_SCRIPT" >&2
  exit 1
fi

echo "[batch] vibe=$VIBE  count=$COUNT  cooldown=${COOLDOWN}s"
echo "[batch] each track runs in its own Python process — laptop-safe"

for i in $(seq 1 "$COUNT"); do
  echo
  echo "===== run $i / $COUNT ====="
  python3 "$PY_SCRIPT" --one "$VIBE" "$@"
  if [[ "$i" -lt "$COUNT" ]]; then
    echo "[batch] cooling down ${COOLDOWN}s before next run..."
    sleep "$COOLDOWN"
  fi
done

echo
echo "[batch] done — $COUNT tracks generated"
echo "[batch] don't forget: npm run sync:catalog"
