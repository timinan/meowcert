#!/usr/bin/env python3
"""
Retroactive backing-track processor.

For each known source MP3 on Tim's Desktop, run the same pipeline the
calibrator now uses going forward:

  1. Skip leading silence / soft-intro to find a strong start point.
  2. Cut a CLIP_DURATION_S (62 s) window from there.
  3. Apply a small fade-in (FADE_IN_MS) + fade-out (FADE_OUT_MS) so the
     Phaser loop seam is masked when the song restarts.
  4. Encode mono / 96 kbps / 44.1 kHz mp3, dropped into the catalog dir.
  5. Compute energy + brightness + onset density features and suggest a
     vibe label (upbeat / melodic / smooth) per song. Writes a report to
     stdout and updates tools/music/music.json's loopDurationMs +
     suggested vibe.

Usage:  python3 scripts/audio/reprocess-backings.py
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, Tuple, List

import librosa
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKINGS_DIR = REPO_ROOT / "public" / "assets" / "audio" / "backings"
MUSIC_JSON = REPO_ROOT / "tools" / "music" / "music.json"
HOME = Path(os.path.expanduser("~"))
DESKTOP = HOME / "Desktop"

# === Pipeline knobs ========================================================

CLIP_DURATION_S = 62.0
FADE_IN_MS = 350
FADE_OUT_MS = 1500
# Minimum amount of seconds AFTER the start point that need non-silent
# content. Stops the picker from landing on a single loud transient
# followed by silence.
START_LOOKAHEAD_S = 4.0
# RMS threshold above which a frame counts as "loud enough to be a real
# start." Tuned for Suno's mastering — silence floors around -inf dB,
# typical content sits in -25 to -10 dB range. Anything quieter than
# -28 dB reads as intro fade-in / pad.
START_RMS_DB = -28.0
# Frame analysis hop in ms (librosa default-equivalent).
HOP_MS = 50

# Map source-filename → catalog slug. Stays in sync with the
# desktop-mp3 → audio-backings mapping in scripts/audio/retrim-backings.
SOURCE_MAP: List[Tuple[str, str]] = [
    ("bounce-bloom-1",         "Bounce & Bloom.mp3"),
    ("bounce-bloom-2",         "Bounce & Bloom (1).mp3"),
    ("bouncy-bounce",          "Bouncy Bounce.mp3"),
    ("cinematic-bossa-nova-1", "Cinematic Bossa Nova.mp3"),
    ("cinematic-bossa-nova-2", "Cinematic Bossa Nova (1).mp3"),
    ("midnight-coffee",        "Midnight Coffee.mp3"),
    ("neon-dash",              "Neon Dash.mp3"),
    ("warmth-in-the-air",      "Warmth in the Air.mp3"),
    ("midnight-skyline",       "Midnight Skyline.mp3"),
    ("midnight-skyline-1",     "Midnight Skyline (1).mp3"),
    ("neon-horizon",           "Neon Horizon.mp3"),
    ("neon-pulse",             "Neon Pulse.mp3"),
    ("neon-pulse-1",           "Neon Pulse (1).mp3"),
    ("warmth-in-the-air-1",    "Warmth in the Air (1).mp3"),
    ("neon-horizon-3",         "Neon Horizon (3).mp3"),
]


# === Start-point detection =================================================

def find_good_start(y: np.ndarray, sr: int) -> float:
    """Return the start time (s) where the song is loud enough AND keeps
    going for START_LOOKAHEAD_S without a long quiet stretch."""
    hop_len = int(sr * (HOP_MS / 1000))
    frame_len = hop_len * 2
    rms = librosa.feature.rms(y=y, frame_length=frame_len, hop_length=hop_len)[0]
    rms_db = librosa.amplitude_to_db(rms, ref=np.max)

    lookahead_frames = int(START_LOOKAHEAD_S / (HOP_MS / 1000))
    last_safe_start = len(rms_db) - lookahead_frames - 1

    for i in range(0, last_safe_start):
        if rms_db[i] < START_RMS_DB:
            continue
        # Sustained: at least 80% of the lookahead window also above
        # threshold. Catches "intro hit then quiet" cases.
        window = rms_db[i:i + lookahead_frames]
        if (window >= START_RMS_DB).mean() >= 0.8:
            return i * (HOP_MS / 1000)
    # Fallback: first frame above threshold (no sustainment check).
    above = np.where(rms_db >= START_RMS_DB)[0]
    return float(above[0]) * (HOP_MS / 1000) if len(above) else 0.0


# === Vibe classification ===================================================

def classify_vibe(y: np.ndarray, sr: int) -> Tuple[str, Dict[str, float]]:
    """Return ('upbeat' | 'melodic' | 'smooth', feature_dict)."""
    # Tempo / onset density
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    tempo_arr = librosa.feature.tempo(onset_envelope=onset_env, sr=sr)
    tempo = float(np.atleast_1d(tempo_arr)[0])
    onset_count = len(librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr))
    duration = librosa.get_duration(y=y, sr=sr)
    onsets_per_s = onset_count / duration if duration else 0.0

    # Brightness
    cent = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    centroid_mean = float(cent.mean())
    centroid_norm = centroid_mean / (sr / 2)  # 0..1

    # Energy + dynamics
    rms = librosa.feature.rms(y=y)[0]
    rms_mean = float(rms.mean())
    rms_var = float(rms.std() / (rms.mean() + 1e-6))

    # Percussive vs harmonic balance
    harm, perc = librosa.effects.hpss(y)
    perc_ratio = float(np.sqrt((perc ** 2).mean()) / (np.sqrt((y ** 2).mean()) + 1e-9))

    features = {
        "tempo": round(tempo, 1),
        "onsets_per_s": round(onsets_per_s, 2),
        "centroid_norm": round(centroid_norm, 3),
        "rms_mean": round(rms_mean, 3),
        "rms_var": round(rms_var, 3),
        "perc_ratio": round(perc_ratio, 3),
    }

    # Heuristic decision — re-tuned after dry-run showed almost every
    # 130 BPM Suno track scoring 'melodic' regardless of feel.
    #  - Upbeat: dance / kick-driven tracks. Dense onsets + percussive.
    #  - Smooth: low onset density AND low percussive content. Bossa,
    #    lounge, lo-fi.
    #  - Melodic: middle ground — has rhythm but isn't club-y.
    score_upbeat = 0
    score_smooth = 0
    if onsets_per_s >= 5.0: score_upbeat += 2
    elif onsets_per_s >= 3.5: score_upbeat += 1
    elif onsets_per_s <= 2.0: score_smooth += 2
    elif onsets_per_s <= 2.8: score_smooth += 1
    if perc_ratio >= 0.55: score_upbeat += 2
    elif perc_ratio >= 0.45: score_upbeat += 1
    elif perc_ratio <= 0.30: score_smooth += 2
    elif perc_ratio <= 0.38: score_smooth += 1
    if centroid_norm >= 0.14: score_upbeat += 1
    elif centroid_norm <= 0.08: score_smooth += 1
    if rms_var <= 0.30: score_smooth += 1
    elif rms_var >= 0.55: score_upbeat += 1

    if score_upbeat >= 3 and score_upbeat > score_smooth:
        return "upbeat", features
    if score_smooth >= 3 and score_smooth > score_upbeat:
        return "smooth", features
    return "melodic", features


# === ffmpeg trim + fade ====================================================

def render_clip(source: Path, start_s: float, out_path: Path) -> None:
    """Trim source [start_s, start_s + CLIP_DURATION_S], apply fades,
    encode to mono / 44.1 kHz / 96 kbps mp3 at out_path."""
    fade_out_start = CLIP_DURATION_S - (FADE_OUT_MS / 1000)
    afilter = (
        f"afade=t=in:st=0:d={FADE_IN_MS/1000:.3f},"
        f"afade=t=out:st={fade_out_start:.3f}:d={FADE_OUT_MS/1000:.3f}"
    )
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{start_s:.3f}",
        "-i", str(source),
        "-t", f"{CLIP_DURATION_S:.3f}",
        "-af", afilter,
        "-ac", "1",
        "-ar", "44100",
        "-b:a", "96k",
        str(out_path),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg failed for {source.name}: {r.stderr.strip()[:300]}")


# === Driver ================================================================

def rotate_backup(path: Path, max_keep: int = 5) -> None:
    """Rotate music.bak-1..N before overwriting music.json — mirrors the
    server's rotateBackups behavior."""
    for i in range(max_keep, 0, -1):
        cur = path.with_name(path.stem + f".bak-{i}" + path.suffix)
        prev = path.with_name(path.stem + f".bak-{i-1}" + path.suffix) if i > 1 else path
        if prev.exists():
            if cur.exists():
                cur.unlink()
            shutil.copy2(prev, cur)


def main() -> None:
    if not DESKTOP.exists():
        sys.exit(f"Desktop not found at {DESKTOP}")
    BACKINGS_DIR.mkdir(parents=True, exist_ok=True)

    catalog = json.loads(MUSIC_JSON.read_text())
    results: List[Dict] = []
    missing: List[Tuple[str, str]] = []

    for slug, src_name in SOURCE_MAP:
        src = DESKTOP / src_name
        out = BACKINGS_DIR / f"{slug}.mp3"
        if not src.exists():
            missing.append((slug, src_name))
            print(f"MISS  {slug:26s}  source not on Desktop: {src_name}", flush=True)
            continue
        # Analyze source for start point + vibe. mono load saves memory.
        y, sr = librosa.load(str(src), sr=None, mono=True)
        start_s = find_good_start(y, sr)

        # Use the clip itself (not the source) for vibe classification so
        # the heuristic sees the actual content the player will hear.
        clip_y = y[int(start_s * sr): int((start_s + CLIP_DURATION_S) * sr)]
        suggested, feats = classify_vibe(clip_y, sr)

        # Render the clip.
        render_clip(src, start_s, out)
        actual_dur = float(librosa.get_duration(path=str(out)))

        prev_vibe = catalog.get(slug, {}).get("vibe", "—")
        results.append({
            "slug": slug,
            "start_s": round(start_s, 2),
            "duration": round(actual_dur, 2),
            "prev_vibe": prev_vibe,
            "suggested_vibe": suggested,
            "features": feats,
        })
        diff = "  ⇢ AUTO-RETAG" if prev_vibe != suggested else ""
        print(
            f"OK  {slug:24s}  start={start_s:5.2f}s  dur={actual_dur:5.2f}s  "
            f"old={prev_vibe:7s} → suggest={suggested:7s}  "
            f"tempo={feats['tempo']:5.1f}  ons={feats['onsets_per_s']:4.2f}  "
            f"perc={feats['perc_ratio']:.2f}  cent={feats['centroid_norm']:.3f}  "
            f"rms_var={feats['rms_var']:.2f}{diff}",
            flush=True,
        )

    # Update music.json: bump loopDurationMs always; only overwrite the
    # vibe when no vibe was set (a brand-new song) — existing labels were
    # picked deliberately and we shouldn't quietly clobber them.
    for r in results:
        entry = catalog.setdefault(r["slug"], {})
        entry["loopDurationMs"] = int(CLIP_DURATION_S * 1000)
        if not entry.get("vibe"):
            entry["vibe"] = r["suggested_vibe"]

    rotate_backup(MUSIC_JSON)
    MUSIC_JSON.write_text(json.dumps(catalog, indent=2) + "\n")

    print()
    print(f"Wrote {len(results)} backings to {BACKINGS_DIR}")
    if missing:
        print()
        print("Missing sources (slugs at 32 s in the catalog until you re-upload):")
        for slug, name in missing:
            print(f"  - {slug}  expected source: ~/Desktop/{name}")


if __name__ == "__main__":
    main()
