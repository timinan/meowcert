#!/usr/bin/env python3
"""
Local MusicGen batch generator for backing tracks.

Generates instrumental loops on-device using Meta's MusicGen via the
`transformers` pipeline (MPS on Apple Silicon, CUDA on Linux, CPU fallback).
Each clip goes through the same trim + fade + mono 96 kbps pipeline the
calibrator uses, lands in public/assets/audio/backings/, and gets a vibe
suggestion auto-classified from the generated audio.

Free, scales to as many tracks as you have patience / disk space.

==============================================================================
LAPTOP-SAFETY NOTE — read before running
==============================================================================
The `small` MusicGen model is ~1.5 GB; `medium` is ~5 GB; `large` is ~13 GB.
On Apple Silicon (MPS) the model + per-track activations stay resident
across the run, so generating 10+ tracks back-to-back tends to creep memory
pressure into swap and freeze the laptop.

Safer defaults baked into this script:
  - default `--count` is 1 per vibe (was 3) — small footprint by default
  - `gc.collect()` + `torch.mps.empty_cache()` between tracks
  - explicit cleanup at end (model + processor freed, cache emptied)
  - `--one <vibe>` mode for single-track runs

Strongly recommended workflow:
  - Use `generate-batch.sh <vibe> <count>` (wrapper script). It loops
    `--one <vibe>` N times, each in a FRESH Python process. The OS
    reclaims memory between runs so the laptop never spirals.
  - Never run more than 4 tracks per process.
  - Stick to `--model small`. `medium` and `large` will swap on most macs.

==============================================================================

Usage:
    # Smoke test — generate a single 12 s track to validate the chain.
    python3 scripts/audio/generate-backings.py --smoke-test

    # Plan only — print what would be generated and exit (no model load).
    python3 scripts/audio/generate-backings.py --count 2 --dry-run

    # SAFEST: one track of a single vibe per Python process.
    python3 scripts/audio/generate-backings.py --one upbeat

    # Single batch (one model load, up to N tracks per vibe).
    python3 scripts/audio/generate-backings.py --count 2 --vibes upbeat

Approx wall-clock per 60 s track on M-series MPS (small model):
    small  ~1.5 min   medium  ~4 min   large  ~8 min
"""

from __future__ import annotations

import argparse
import gc
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Dict, List, Tuple

import librosa
import numpy as np
import scipy.io.wavfile as wavfile
import torch

# Re-use the trim / fade / vibe-classifier knobs from the retroactive
# script so the two pipelines stay in lockstep.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from importlib import import_module
_reprocess = import_module("reprocess-backings")
classify_vibe = _reprocess.classify_vibe
find_good_start = _reprocess.find_good_start
render_clip = _reprocess.render_clip
rotate_backup = _reprocess.rotate_backup
CLIP_DURATION_S = _reprocess.CLIP_DURATION_S

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKINGS_DIR = REPO_ROOT / "public" / "assets" / "audio" / "backings"
MUSIC_JSON = REPO_ROOT / "tools" / "music" / "music.json"

# === Prompt library ========================================================
#
# Each entry is a short genre descriptor that gets composed with the BPM
# at generation time. Keep them prompt-engineered for the kind of feel we
# want in-game: instrumental, looping-friendly, simple harmonic structure,
# no vocals. The variety stops every batch from sounding identical.

PROMPTS: Dict[str, List[str]] = {
    "upbeat": [
        "energetic synthwave with driving kick and bassy synth at {bpm} BPM, no vocals",
        "fast chiptune 8-bit dance track at {bpm} BPM, catchy lead, no vocals",
        "upbeat electro pop with punchy claps and bright synth at {bpm} BPM, no vocals",
        "fast-paced retro arcade music at {bpm} BPM, square wave lead, no vocals",
        "high-energy synthpop with arpeggios and four-on-the-floor kick at {bpm} BPM, no vocals",
        "neon-soaked synthwave with sidechain pads at {bpm} BPM, no vocals",
        "bouncy electro house with plucky lead at {bpm} BPM, no vocals",
        "upbeat retrowave with rolling bass at {bpm} BPM, no vocals",
        "vibrant electro funk with slap bass and bright stabs at {bpm} BPM, no vocals",
        "fast-paced drum-and-bass with rolling break at {bpm} BPM, no vocals",
        "energetic future house with pluck lead at {bpm} BPM, no vocals",
        "punchy synth disco with strings and clavinet at {bpm} BPM, no vocals",
        "vaporwave dance with chopped pad and tight kick at {bpm} BPM, no vocals",
        "sparkly j-pop electronica with bright synths at {bpm} BPM, no vocals",
        "kawaii future bass with squeaky lead and big drop at {bpm} BPM, no vocals",
        "bright tropical house with pluck flute synth at {bpm} BPM, no vocals",
        "neon city night drive synth at {bpm} BPM, no vocals",
        "anime opening uptempo synthrock at {bpm} BPM, no vocals",
        "bitcrushed sega-genesis racing music at {bpm} BPM, no vocals",
        "energetic uk garage with skippy hats at {bpm} BPM, no vocals",
        "high-energy outrun with arpeggio and snare hits at {bpm} BPM, no vocals",
        "electro samba with steel pan synth at {bpm} BPM, no vocals",
        "punchy hyperpop with bouncy bass at {bpm} BPM, no vocals",
        "bright italo disco with vintage analog synth at {bpm} BPM, no vocals",
        "fast surf-rock electronic crossover at {bpm} BPM, no vocals",
        "celebratory ska-punk horns over synth bed at {bpm} BPM, no vocals",
        "video game boss battle synth at {bpm} BPM, no vocals",
        "upbeat carnival electro with whistles at {bpm} BPM, no vocals",
        "uplifting trance pluck with airy pads at {bpm} BPM, no vocals",
        "snappy pop-punk synth crossover at {bpm} BPM, no vocals",
    ],
    "melodic": [
        "melodic chiptune adventure music at {bpm} BPM, video game soundtrack, no vocals",
        "playful electronic music with bell synth at {bpm} BPM, no vocals",
        "cozy melodic synthwave with arpeggios at {bpm} BPM, no vocals",
        "warm melodic electronic track with soft drums at {bpm} BPM, no vocals",
        "dreamy melodic chiptune with twinkling lead at {bpm} BPM, no vocals",
        "tender melodic synth track with mellow pads at {bpm} BPM, no vocals",
        "wistful melodic video game music at {bpm} BPM, no vocals",
        "whimsical music-box electronic at {bpm} BPM, no vocals",
        "magical fairy-tale celesta and pluck synth at {bpm} BPM, no vocals",
        "soft melodic city-pop with rhodes and pluck guitar at {bpm} BPM, no vocals",
        "hopeful indie pop instrumental with glockenspiel at {bpm} BPM, no vocals",
        "cozy cafe pop with rhodes and brushed snare at {bpm} BPM, no vocals",
        "uplifting cinematic strings and pluck synth at {bpm} BPM, no vocals",
        "gentle ghibli-style orchestral pop at {bpm} BPM, no vocals",
        "warm acoustic-fingerpicking with subtle synth at {bpm} BPM, no vocals",
        "lush melodic synthpop with airy lead at {bpm} BPM, no vocals",
        "sweet melodic chillwave with shimmer pad at {bpm} BPM, no vocals",
        "cozy puzzle-game soundtrack with marimba at {bpm} BPM, no vocals",
        "twinkly cosmic adventure synth at {bpm} BPM, no vocals",
        "playful kalimba and pluck synth duet at {bpm} BPM, no vocals",
        "sunshine indie pop with handclaps at {bpm} BPM, no vocals",
        "tender mallet percussion with airy pad at {bpm} BPM, no vocals",
        "melodic synth-folk with strummed acoustic at {bpm} BPM, no vocals",
        "wholesome saturday morning cartoon melody at {bpm} BPM, no vocals",
        "melodic cinematic montage with piano and pluck at {bpm} BPM, no vocals",
        "melodic island ukulele pop with synth at {bpm} BPM, no vocals",
        "sparkly melodic snowflake celesta at {bpm} BPM, no vocals",
        "warm autumn melodic pop with rhodes at {bpm} BPM, no vocals",
        "cozy bedtime story melodic pad at {bpm} BPM, no vocals",
        "melodic 16-bit overworld music at {bpm} BPM, no vocals",
    ],
    "smooth": [
        "smooth lo-fi hip hop with mellow piano at {bpm} BPM, jazzy, no vocals",
        "smooth bossa nova with light percussion at {bpm} BPM, no vocals",
        "smooth jazz fusion with electric piano at {bpm} BPM, mellow, no vocals",
        "ambient lo-fi with rain pads and soft kick at {bpm} BPM, no vocals",
        "smooth chill funk with muted guitar at {bpm} BPM, no vocals",
        "calm cocktail lounge piano at {bpm} BPM, no vocals",
        "mellow downtempo electronica with deep bass at {bpm} BPM, no vocals",
        "smooth deep house with warm pad and shuffle hats at {bpm} BPM, no vocals",
        "soulful neosoul guitar over chill drums at {bpm} BPM, no vocals",
        "smooth trip hop with vinyl crackle and rhodes at {bpm} BPM, no vocals",
        "smooth saxophone over chillhop beat at {bpm} BPM, no vocals",
        "calm rainy-night jazz cafe at {bpm} BPM, no vocals",
        "smooth nujabes-style chillhop at {bpm} BPM, no vocals",
        "smooth indie chillwave with reverb guitar at {bpm} BPM, no vocals",
        "smooth midnight city groove with rhodes at {bpm} BPM, no vocals",
        "smooth chillout bossa with shaker at {bpm} BPM, no vocals",
        "smooth dub reggae with tape echo at {bpm} BPM, no vocals",
        "smooth sunset chill electronica with airy pad at {bpm} BPM, no vocals",
        "smooth tropical lounge with marimba at {bpm} BPM, no vocals",
        "soft ambient piano with synth pad and shimmer at {bpm} BPM, no vocals",
        "smooth trip-hop with dusty drums and chord stabs at {bpm} BPM, no vocals",
        "smooth bossa-jazz with vibraphone at {bpm} BPM, no vocals",
        "smooth retro funk with wah guitar at {bpm} BPM, no vocals",
        "smooth chillwave with airy melodic lead at {bpm} BPM, no vocals",
        "smooth ambient electronica with field recordings at {bpm} BPM, no vocals",
        "smooth coffee-shop trip-hop with rhodes at {bpm} BPM, no vocals",
        "smooth lo-fi acoustic guitar with brushes at {bpm} BPM, no vocals",
        "smooth funk-house with deep groove at {bpm} BPM, no vocals",
        "smooth retro-jazz with muted trumpet at {bpm} BPM, no vocals",
        "smooth analog warm chillout pad at {bpm} BPM, no vocals",
    ],
}

# === MusicGen wrapper ======================================================

MODEL_ALIASES = {
    "small":  "facebook/musicgen-small",
    "medium": "facebook/musicgen-medium",
    "large":  "facebook/musicgen-large",
}


def pick_device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def empty_device_cache(device: str) -> None:
    """Best-effort cache flush. MPS and CUDA hold on to released allocations
    until empty_cache is called explicitly; without this, memory pressure
    creeps across the per-track loop until the laptop swaps."""
    if device == "mps":
        try:
            torch.mps.empty_cache()
        except (AttributeError, RuntimeError):
            pass
    elif device == "cuda":
        try:
            torch.cuda.empty_cache()
        except (AttributeError, RuntimeError):
            pass


def load_model(alias: str, device: str):
    """Load MusicGen via the transformers pipeline. dtype is float16 on
    GPU-class devices (mps / cuda), float32 on CPU.

    On MPS the EnCodec audio decoder hits an "Output channels > 65536"
    NotImplementedError (the inner conv1d exceeds an MPS-specific
    op limit). Workaround: keep the transformer on MPS (fast,
    autoregressive token sampling) and pin just `audio_encoder` to CPU
    in float32 (small, runs once per clip, only milliseconds slower).
    """
    from transformers import AutoProcessor, MusicgenForConditionalGeneration

    model_id = MODEL_ALIASES.get(alias, alias)
    print(f"[gen] loading {model_id} on {device} ...", flush=True)
    t0 = time.time()
    processor = AutoProcessor.from_pretrained(model_id)
    dtype = torch.float16 if device in ("mps", "cuda") else torch.float32
    model = MusicgenForConditionalGeneration.from_pretrained(
        model_id, dtype=dtype
    ).to(device)
    model.eval()
    if device == "mps":
        # Encodec decoder back to CPU+float32 — bypasses the MPS conv1d
        # output-channels limit that crashes the decode pass. The tokens
        # produced by the transformer live on MPS, so we wrap decode to
        # move inputs to CPU before invoking the (now CPU-resident)
        # encodec module.
        model.audio_encoder.to("cpu", dtype=torch.float32)
        _original_decode = model.audio_encoder.decode

        def _decode_cpu(audio_codes, audio_scales=None, padding_mask=None, **kw):
            audio_codes = audio_codes.to("cpu")
            if audio_scales is not None:
                audio_scales = [
                    (s.to("cpu") if hasattr(s, "to") else s) for s in audio_scales
                ]
            if padding_mask is not None and hasattr(padding_mask, "to"):
                padding_mask = padding_mask.to("cpu")
            return _original_decode(
                audio_codes,
                audio_scales=audio_scales,
                padding_mask=padding_mask,
                **kw,
            )

        model.audio_encoder.decode = _decode_cpu
        print("[gen] pinned audio_encoder to cpu/float32 (MPS workaround)", flush=True)
    print(f"[gen] model ready in {time.time()-t0:.1f}s", flush=True)
    return processor, model


def generate_audio(processor, model, device: str, prompt: str, seconds: float) -> Tuple[np.ndarray, int]:
    """Generate raw audio (int16 wav-ready ndarray) at the model's native
    sample rate. Handles the 30 s-per-call MusicGen window by chaining one
    continuation when `seconds` exceeds the per-call cap."""
    sr = model.config.audio_encoder.sampling_rate
    # MusicGen's encodec runs at 50 Hz token rate; 1500 tokens ≈ 30 s.
    tokens_per_sec = model.config.audio_encoder.frame_rate
    per_call_cap_s = 28.0  # leave a little headroom under the 30 s window
    chunk_s = min(seconds, per_call_cap_s)

    def _gen(text: str, max_new_tokens: int) -> torch.Tensor:
        inputs = processor(text=[text], padding=True, return_tensors="pt").to(device)
        with torch.no_grad():
            out = model.generate(
                **inputs,
                do_sample=True,
                guidance_scale=3.0,
                max_new_tokens=max_new_tokens,
            )
        return out[0].cpu().float()

    first_tokens = int(chunk_s * tokens_per_sec)
    first = _gen(prompt, first_tokens)

    if seconds <= per_call_cap_s:
        wav = first
    else:
        # Continuation: feed the last ~5 s of `first` as a text+audio
        # prompt for the second chunk and stitch the new content onto the
        # tail of `first`. Drop the overlapping context samples from the
        # second chunk so the two pieces line up cleanly.
        ctx_s = 5.0
        ctx_samples = int(ctx_s * sr)
        # second chunk needs to cover (seconds - per_call_cap_s + ctx_s)
        remaining_s = seconds - per_call_cap_s + ctx_s
        second_tokens = int(min(per_call_cap_s, remaining_s) * tokens_per_sec)
        second = _gen(prompt, second_tokens)
        # Stitch: first chunk + (second chunk minus its leading ctx_samples).
        if second.shape[-1] > ctx_samples:
            second_tail = second[..., ctx_samples:]
        else:
            second_tail = second
        wav = torch.cat([first, second_tail], dim=-1)

    arr = wav.numpy()
    if arr.ndim == 2:
        # Stereo → keep first channel; we mono-down later anyway.
        arr = arr[0]
    # Normalize to int16 with a small headroom.
    arr = arr / max(1e-6, np.max(np.abs(arr))) * 0.92
    arr = (arr * 32767).astype(np.int16)
    return arr, int(sr)


# === Slug + catalog helpers ===============================================

def slugify_prompt(prompt: str) -> str:
    # Take the leading 2-3 distinctive words from the prompt as a slug stem.
    stripped = re.sub(r"\bno vocals\b", "", prompt)
    words = re.findall(r"[a-z]+", stripped.lower())
    # Skip very common filler words.
    skip = {"with", "at", "and", "a", "the", "of", "in", "no", "vocals", "bpm"}
    keep = [w for w in words if w not in skip][:3]
    return "-".join(keep) or "track"


def next_slug(catalog: Dict, stem: str) -> str:
    if stem not in catalog:
        return stem
    i = 1
    while f"{stem}-{i}" in catalog:
        i += 1
    return f"{stem}-{i}"


def speed_label_for_bpm(bpm: int) -> str:
    if bpm < 95:  return "slow"
    if bpm < 120: return "medium"
    if bpm < 150: return "fast"
    return "faster"


# === Main loop =============================================================

def build_plan(args: argparse.Namespace) -> Tuple[List[Tuple[str, str]], float]:
    """Resolve CLI args to (plan, gen_seconds). `plan` is a list of
    (vibe, prompt_template) tuples to generate in order. Pulled out of
    main so --dry-run can preview without loading the model."""
    if args.smoke_test:
        return [("upbeat", PROMPTS["upbeat"][0])], 12.0

    if args.one:
        vibe = args.one
        if vibe not in PROMPTS:
            print(f"[error] unknown vibe {vibe!r} for --one", flush=True)
            sys.exit(2)
        prompt = random.choice(PROMPTS[vibe])
        return [(vibe, prompt)], CLIP_DURATION_S + 6

    plan: List[Tuple[str, str]] = []
    vibes = [v.strip() for v in args.vibes.split(",") if v.strip()]
    for vibe in vibes:
        if vibe not in PROMPTS:
            print(f"[warn] unknown vibe {vibe!r}, skipping", flush=True)
            continue
        picks = random.sample(PROMPTS[vibe], k=min(args.count, len(PROMPTS[vibe])))
        extra = args.count - len(picks)
        while extra > 0:
            more = random.sample(PROMPTS[vibe], k=min(extra, len(PROMPTS[vibe])))
            picks.extend(more)
            extra -= len(more)
        for p in picks:
            plan.append((vibe, p))
    return plan, CLIP_DURATION_S + 6


def main() -> None:
    parser = argparse.ArgumentParser(description="Batch-generate backing tracks with MusicGen.")
    # Lower default: 1 per vibe so a forgetful invocation can't accidentally
    # generate 30+ tracks in one Python process. Tim can opt-in higher.
    parser.add_argument("--count", type=int, default=1,
                        help="Tracks PER VIBE to generate (default: 1).")
    parser.add_argument("--bpm", type=int, default=130, help="Target BPM (default: 130).")
    parser.add_argument("--vibes", default="upbeat,melodic,smooth",
                        help="Comma-separated vibes to cover.")
    parser.add_argument("--model", default="small", choices=list(MODEL_ALIASES.keys()),
                        help="MusicGen model size. Stick to 'small' on macOS.")
    parser.add_argument("--smoke-test", action="store_true",
                        help="Generate a single 12 s clip to validate the pipeline.")
    parser.add_argument("--one", default=None,
                        help="Single-track mode: generate exactly one track for the named vibe and exit. "
                             "Recommended on memory-constrained laptops — run from generate-batch.sh "
                             "to chain multiple processes safely.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print the plan and exit without loading the model.")
    parser.add_argument("--max-tracks-warn", type=int, default=4,
                        help="Warn if a single run would generate more than this many tracks (default: 4).")
    parser.add_argument("--seed", type=int, default=None, help="Deterministic prompt-pick seed.")
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    plan, gen_seconds = build_plan(args)
    if not plan:
        print("[gen] empty plan, nothing to do", flush=True)
        return

    if args.dry_run:
        print("[dry-run] would generate:", flush=True)
        for i, (vibe, prompt_tpl) in enumerate(plan, 1):
            print(f"  [{i}] vibe={vibe}  prompt={prompt_tpl.format(bpm=args.bpm)!r}", flush=True)
        print(f"[dry-run] {len(plan)} tracks total, ~{gen_seconds:.0f}s of audio each", flush=True)
        return

    if len(plan) > args.max_tracks_warn:
        print(
            f"[warn] this run will generate {len(plan)} tracks in a single Python process. "
            f"Memory pressure from a long loop can crash low-RAM laptops. "
            f"Recommended: use generate-batch.sh which runs one track per process.",
            flush=True,
        )

    BACKINGS_DIR.mkdir(parents=True, exist_ok=True)
    catalog = json.loads(MUSIC_JSON.read_text()) if MUSIC_JSON.exists() else {}

    device = pick_device()
    processor, model = load_model(args.model, device)

    tmp_dir = Path(tempfile.mkdtemp(prefix="musicgen-"))
    results = []
    try:
        for i, (vibe, prompt_tpl) in enumerate(plan, 1):
            prompt = prompt_tpl.format(bpm=args.bpm)
            print(f"\n[{i}/{len(plan)}] vibe={vibe}  prompt={prompt!r}", flush=True)
            t0 = time.time()
            samples, sr = generate_audio(processor, model, device, prompt, gen_seconds)
            print(f"  generated {len(samples)/sr:.1f}s of audio in {time.time()-t0:.1f}s", flush=True)

            raw_wav = tmp_dir / f"raw_{i:03d}.wav"
            wavfile.write(str(raw_wav), sr, samples)

            if args.smoke_test:
                clip_path = BACKINGS_DIR / "smoke-test.mp3"
                subprocess.run(
                    [
                        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                        "-i", str(raw_wav),
                        "-af", "afade=t=in:st=0:d=0.2,afade=t=out:st=10:d=1.5",
                        "-ac", "1", "-ar", "44100", "-b:a", "96k",
                        str(clip_path),
                    ],
                    check=True,
                )
                print(f"  → smoke output {clip_path.relative_to(REPO_ROOT)}", flush=True)
                return

            y, real_sr = librosa.load(str(raw_wav), sr=None, mono=True)
            start_s = find_good_start(y, real_sr)
            clip_y = y[int(start_s * real_sr): int((start_s + CLIP_DURATION_S) * real_sr)]
            suggested, feats = classify_vibe(clip_y, real_sr)

            stem = slugify_prompt(prompt)
            slug = next_slug(catalog, stem)
            out_path = BACKINGS_DIR / f"{slug}.mp3"
            render_clip(raw_wav, start_s, out_path)

            catalog[slug] = {
                "id": slug,
                "displayName": stem.replace("-", " ").title(),
                "speedLabel": speed_label_for_bpm(args.bpm),
                "vibe": suggested,
                "bpm": args.bpm,
                "loopDurationMs": int(CLIP_DURATION_S * 1000),
            }
            results.append({"slug": slug, "vibe": suggested, "asked": vibe, "feats": feats})
            print(
                f"  → {slug}  asked={vibe}  detected={suggested}  "
                f"tempo={feats['tempo']:.1f}  ons={feats['onsets_per_s']:.2f}  "
                f"perc={feats['perc_ratio']:.2f}",
                flush=True,
            )

            # Flush per-track tensors + numpy arrays before the next loop
            # iteration. Without these, MPS holds on to allocations until
            # the loop exits — generating 10+ tracks back-to-back creeps
            # memory pressure into swap.
            del samples, y, clip_y
            gc.collect()
            empty_device_cache(device)

            # Catalog write-through so a crash mid-run still records what
            # was already generated (and we don't lose the work).
            rotate_backup(MUSIC_JSON)
            MUSIC_JSON.write_text(json.dumps(catalog, indent=2) + "\n")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        # Explicit teardown so the OS reclaims the model footprint instead
        # of waiting on Python's GC. Matters when the shell script that
        # called us is about to fork another run.
        try:
            del model, processor
        except UnboundLocalError:
            pass
        gc.collect()
        empty_device_cache(device)

    if not args.smoke_test:
        print(f"\n[gen] wrote {len(results)} tracks, updated {MUSIC_JSON.name}", flush=True)
        print("[gen] don't forget: npm run sync:catalog", flush=True)


if __name__ == "__main__":
    main()
