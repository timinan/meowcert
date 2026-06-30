"""Apply cat42-style black beady eyes to rainbow cats (cat79-cat90).

These cats have an existing detailed eye drawing (orange iris + tiny black
pupil + tiny white highlight + cheek blush) where the outer dark eye
outline is connected to the face silhouette — so the blob-based detector
in fix-eye-blobs.py can't isolate them.

Strategy:
  1. Detect 2x2-ish WHITE highlight blobs in the face band y=14..35.
  2. Group highlights into left/right eye by proximity (single eye can
     have 2 highlights close together).
  3. Per eye: erase a generous bbox covering the original eye outline +
     surrounding cheek-blush smudge to face color.
  4. Stamp cat42's exact 7x8 black beady template centered on eye center.

Usage:
  python3 scripts/fix-eye-beady.py cat79 [--preview]
  python3 scripts/fix-eye-beady.py --range 79 90
"""
import json
import shutil
import sys
from collections import deque
from pathlib import Path
from PIL import Image
import numpy as np

ROOT = Path('.')
RAW = ROOT / 'assets-raw'
BACKUPS = ROOT / 'assets-raw-backups' / 'eye-fix'

FACE_Y_MIN, FACE_Y_MAX = 14, 35

# cat42 Beady template — extracted pixel-for-pixel from cat42_idle_00.png
# Left eye (viewer's left, cat's right) — 7 wide x 8 tall.
# '.' = transparent (skip), 'P' = pure black pupil, 'W' = white highlight.
BEADY_LEFT = [
    ['.', '.', 'P', 'P', 'P', 'P', '.'],
    ['.', 'P', 'P', 'P', 'P', 'P', 'P'],
    ['.', 'P', 'P', 'P', 'W', 'W', 'P'],
    ['P', 'P', 'P', 'P', 'W', 'W', 'P'],
    ['P', 'P', 'P', 'P', 'P', 'P', 'P'],
    ['.', 'P', 'P', 'P', 'P', 'P', 'P'],
    ['.', 'P', 'P', 'P', 'P', 'P', 'P'],
    ['.', '.', 'P', 'P', 'P', 'P', '.'],
]
TEMPLATE_W = 7
TEMPLATE_H = 8
PUPIL = (0, 0, 0, 255)
HIGHLIGHT = (255, 255, 255, 255)


def mirror(t):
    return [list(reversed(row)) for row in t]


BEADY_RIGHT = mirror(BEADY_LEFT)

# Closed-beady BLINK template — extracted pixel-for-pixel from cat42_idle_07.
# 9 wide x 3 tall, just black pixels (no white highlight, eye is closed).
# Used for frames where the artist drew the cat blinking — those frames have
# no white-highlight blob to detect, so the script falls back to idle_00's
# eye centroid X and stamps this closed slit at it.
BEADY_CLOSED_LEFT = [
    ['.', '.', '.', 'P', 'P', 'P', 'P', 'P', '.'],
    ['.', 'P', 'P', 'P', 'P', 'P', 'P', 'P', '.'],
    ['.', 'P', 'P', 'P', 'P', 'P', 'P', 'P', '.'],
]
BEADY_CLOSED_RIGHT = mirror(BEADY_CLOSED_LEFT)
CLOSED_W = 9
CLOSED_H = 3


def find_white_highlight_blobs(a: np.ndarray) -> list:
    """Find compact white blobs (2-10 px) in the face band."""
    r, g, b, alpha = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    mask = (r > 240) & (g > 240) & (b > 240) & (alpha > 200)
    mask[:FACE_Y_MIN] = False
    mask[FACE_Y_MAX:] = False
    seen = np.zeros_like(mask)
    blobs = []
    h, w = mask.shape
    for y in range(h):
        for x in range(w):
            if not mask[y, x] or seen[y, x]:
                continue
            q = deque([(y, x)])
            seen[y, x] = True
            pix = []
            while q:
                cy, cx = q.popleft()
                pix.append((cy, cx))
                for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            if 2 <= len(pix) <= 10:
                blobs.append(pix)
    return blobs


def group_eyes(blobs: list, frame_w: int):
    """Return list of (cy, cx, member_blobs) — one entry per eye.

    Multiple highlights within ±4 px x-distance and same eye-half are
    merged into a single eye. Returns at most 2 eyes (one each side of
    frame center).
    """
    left = []
    right = []
    for blob in blobs:
        cy = sum(p[0] for p in blob) / len(blob)
        cx = sum(p[1] for p in blob) / len(blob)
        (left if cx < frame_w / 2 else right).append((cy, cx, blob))
    out = []
    for group in (left, right):
        if not group:
            continue
        # Centroid of all member highlights
        all_pix = [p for g in group for p in g[2]]
        cy = sum(p[0] for p in all_pix) / len(all_pix)
        cx = sum(p[1] for p in all_pix) / len(all_pix)
        out.append((cy, cx, all_pix))
    return out


def sample_face_color(a: np.ndarray) -> tuple:
    """Sample cat body color from cheek/chest row 36-42 (below eyes).

    Fallback sampler — used only when the local ring sampler can't find
    enough fur pixels around the eye (small frames, heavy occlusion).
    """
    samples = []
    for y in range(36, 44):
        for x in range(20, a.shape[1] - 20):
            r, g, b, al = a[y, x]
            if al < 200:
                continue
            r, g, b = int(r), int(g), int(b)
            if r < 30 and g < 30 and b < 30:
                continue
            if r > 240 and g > 240 and b > 240:
                continue
            # Skip pink blush (saturated pink range)
            if r > 200 and 90 < g < 170 and 90 < b < 170:
                continue
            samples.append((r, g, b))
    if not samples:
        return (200, 200, 200, 255)
    arr = np.array(samples)
    return (int(np.median(arr[:, 0])), int(np.median(arr[:, 1])),
            int(np.median(arr[:, 2])), 255)


def sample_face_color_local(a: np.ndarray, ey_min: int, ey_max: int,
                             ex_min: int, ex_max: int,
                             fallback: tuple) -> tuple:
    """Sample fur color from a RING immediately around the per-eye erase rect.

    Why local: the global sampler (sample_face_color) reads cheek/chest at
    y=36..43, which is the cat's MIDLINE color. On cat79-90 lick/meow frames
    the artist drew darker shading around the eyes. The old code used the
    midline median as face_color and the distance-threshold in
    is_eye_region_pixel then flagged the darker shadow as "eye art" and
    bleached it to the lighter median — leaving a lighter halo around the
    closed slit that broke the artist's shadow gradient.

    Sampling from the ring around the erase rect picks up exactly the shade
    the surrounding pixels are using (shadow OR plain fur, whichever is
    actually around this eye), so the bleach color matches and the seam is
    invisible.
    """
    RING_PAD = 4
    h, w = a.shape[:2]
    y0 = max(0, ey_min - RING_PAD)
    y1 = min(h, ey_max + RING_PAD)
    x0 = max(0, ex_min - RING_PAD)
    x1 = min(w, ex_max + RING_PAD)
    samples = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            # Skip the erase rect interior (those are the eye art we're
            # about to repaint — we want the OUTSIDE shade).
            if ey_min <= y < ey_max and ex_min <= x < ex_max:
                continue
            r, g, b, al = a[y, x]
            if al < 200:
                continue
            r, g, b = int(r), int(g), int(b)
            if r < 30 and g < 30 and b < 30:  # outline
                continue
            if r > 240 and g > 240 and b > 240:  # white highlight remnant
                continue
            # Pink blush — skip
            if r > 200 and 90 < g < 170 and 90 < b < 170:
                continue
            # Saturated orange — likely iris that escaped the rect (e.g. on
            # frames where the artist drew the iris wider than our pad)
            if r > 200 and 80 < g < 180 and b < 100 and (r - b) > 100:
                continue
            samples.append((r, g, b))
    if len(samples) < 5:
        return fallback
    arr = np.array(samples)
    return (int(np.median(arr[:, 0])), int(np.median(arr[:, 1])),
            int(np.median(arr[:, 2])), 255)


def is_outline_or_blush(rgba) -> bool:
    """True for pure-black outline OR red/orange cheek blush — pixels we
    want to erase to face color when cleaning the eye region."""
    r, g, b, al = int(rgba[0]), int(rgba[1]), int(rgba[2]), int(rgba[3])
    if al < 50:
        return False
    if r < 30 and g < 30 and b < 30:
        return True
    return False


def is_eye_region_pixel(rgba, face_color) -> bool:
    """True for any non-fur-color pixel we want to wipe from the eye area
    (outline black, white highlight remnants, orange iris, dark pupil,
    pink/red blush smudge)."""
    r, g, b, al = int(rgba[0]), int(rgba[1]), int(rgba[2]), int(rgba[3])
    fr, fg, fb = face_color[0], face_color[1], face_color[2]
    if al < 50:
        return False
    # Pure black outline
    if r < 30 and g < 30 and b < 30:
        return True
    # White highlight remnant
    if r > 240 and g > 240 and b > 240:
        return True
    # Pink/red cheek blush — distinguishable from fur by saturation
    if r > 200 and g < 180 and b < 180 and abs(int(r) - int(g)) > 40:
        return True
    # Different enough from fur (more than ~50 RGB-distance) — likely orange
    # iris or dark pupil that's not pure black
    dist = abs(r - fr) + abs(g - fg) + abs(b - fb)
    if dist > 80:
        return True
    return False


def fix_frame(a: np.ndarray, fallback_eyes: list | None = None) -> tuple[np.ndarray, int, bool]:
    """Stamp beady eyes on the frame.

    Detection path (open-eye frames):
      1. Find white-highlight blobs in face band
      2. Group into ≤2 eye centroids
      3. Stamp BEADY_LEFT/RIGHT (open eye) at each centroid

    Fallback path (blink frames — no highlight detected):
      1. Skip if `fallback_eyes` is None
      2. Use those eye centroids (typically harvested from idle_00)
      3. Stamp BEADY_CLOSED_LEFT/RIGHT (closed slit) at the same X centroids
         but Y shifted down so the slit sits where the lower eyelid would be

    Returns (out_array, eyes_painted, was_blink).
    """
    blobs = find_white_highlight_blobs(a)
    eyes = group_eyes(blobs, a.shape[1])

    is_blink = False
    if len(eyes) < 2:
        if not fallback_eyes or len(fallback_eyes) < 2:
            return a.copy(), 0, False
        eyes = fallback_eyes
        is_blink = True

    out = a.copy()
    frame_w = a.shape[1]
    # Global midline sampler — kept as a fallback only. Per-eye erase uses
    # sample_face_color_local so the bleach color matches the shade
    # immediately around each eye (artist's eye-area shadow), not the
    # cheek/chest median which would leave a lighter halo on shaded frames.
    global_fallback = sample_face_color(a)
    ERASE_PAD = 2

    for cy, cx, _members in eyes:
        is_left = cx < frame_w / 2

        if is_blink:
            # Closed slit: anchor at SAME X centroid but Y shifted down ~2 px
            # so the slit sits at the lower-lid line, not centered on the open
            # eye's vertical midpoint. cat42's frame 7 places the slit at
            # cy_open + ~2 — verified against reference.
            tpl = BEADY_CLOSED_LEFT if is_left else BEADY_CLOSED_RIGHT
            th, tw = CLOSED_H, CLOSED_W
            # Closed template center: row 1 (middle of 3), col 4 (middle of 9)
            tx = int(round(cx - 4))
            ty = int(round(cy))  # cy of open eye → top of closed slit
            erase_top_pad = 4    # wipe original eye art that's ABOVE the slit
            erase_bot_pad = 2
        else:
            tpl = BEADY_LEFT if is_left else BEADY_RIGHT
            th, tw = TEMPLATE_H, TEMPLATE_W
            if is_left:
                tx = int(round(cx - 4.5))
                ty = int(round(cy - 2.5))
            else:
                tx = int(round(cx - 1.5))
                ty = int(round(cy - 2.5))
            erase_top_pad = ERASE_PAD
            erase_bot_pad = ERASE_PAD

        ey_min = ty - erase_top_pad
        ey_max = ty + th + erase_bot_pad
        ex_min = tx - ERASE_PAD
        ex_max = tx + tw + ERASE_PAD
        face_color = sample_face_color_local(
            a, ey_min, ey_max, ex_min, ex_max, global_fallback
        )
        for y in range(max(0, ey_min), min(a.shape[0], ey_max)):
            for x in range(max(0, ex_min), min(a.shape[1], ex_max)):
                if is_eye_region_pixel(a[y, x], face_color):
                    out[y, x] = face_color

        for dy in range(th):
            for dx in range(tw):
                cell = tpl[dy][dx]
                if cell == '.':
                    continue
                y, x = ty + dy, tx + dx
                if 0 <= y < a.shape[0] and 0 <= x < a.shape[1]:
                    out[y, x] = PUPIL if cell == 'P' else HIGHLIGHT

    return out, len(eyes), is_blink


def harvest_reference_eyes(cat_id: str) -> list | None:
    """Pull eye centroids from the pre-fix backup of idle_00 (or current idle_00
    if no backup exists). Used as fallback for blink frames where the
    highlight-blob detector can't find anything."""
    backup_idle0 = BACKUPS / cat_id / f'{cat_id}_idle_00.png'
    current_idle0 = RAW / cat_id / f'{cat_id}_idle_00.png'
    src = backup_idle0 if backup_idle0.exists() else current_idle0
    if not src.exists():
        return None
    a = np.array(Image.open(src).convert('RGBA'))
    blobs = find_white_highlight_blobs(a)
    eyes = group_eyes(blobs, a.shape[1])
    if len(eyes) >= 2:
        return eyes
    return None


def process_cat(cat_id: str, dry_run: bool = False, preview: bool = False) -> dict:
    cat_dir = RAW / cat_id
    frames = sorted(cat_dir.glob(f'{cat_id}_*.png'))
    if not frames:
        return {'cat': cat_id, 'error': 'no frames'}

    ref_eyes = harvest_reference_eyes(cat_id)

    if preview:
        idle = cat_dir / f'{cat_id}_idle_00.png'
        src = idle if idle.exists() else frames[0]
        a = np.array(Image.open(src).convert('RGBA'))
        fixed, n, _ = fix_frame(a, fallback_eyes=ref_eyes)
        prev = Path('/tmp') / f'beadyfix-{cat_id}.png'
        Image.fromarray(fixed, 'RGBA').save(prev)
        return {'cat': cat_id, 'preview': str(prev), 'eyes_fixed': n}

    BACKUPS.mkdir(parents=True, exist_ok=True)
    backup_dir = BACKUPS / cat_id
    backup_dir.mkdir(parents=True, exist_ok=True)
    counts = []
    blinks = 0
    for fp in frames:
        # Always read from backup if it exists so we re-process a CLEAN frame
        # (lets us re-run the script after the open-eye-only pass without
        # double-stamping over already-fixed pixels).
        bp = backup_dir / fp.name
        if not bp.exists():
            shutil.copy2(fp, bp)
        src_path = bp  # always work from the original
        a = np.array(Image.open(src_path).convert('RGBA'))
        fixed, n, was_blink = fix_frame(a, fallback_eyes=ref_eyes)
        if was_blink:
            blinks += 1
        if not dry_run:
            Image.fromarray(fixed, 'RGBA').save(fp)
        counts.append((fp.name, n))
    return {
        'cat': cat_id,
        'frames': len(counts),
        'frames_with_open_eyes': sum(1 for _, n in counts if n == 2) - blinks,
        'frames_with_closed_blink': blinks,
        'frames_with_0_eyes': sum(1 for _, n in counts if n == 0),
    }


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)

    if args[0] == '--range':
        lo, hi = int(args[1]), int(args[2])
        for n in range(lo, hi + 1):
            cid = f'cat{n}'
            if not (RAW / cid).exists():
                continue
            r = process_cat(cid)
            print(f'  {cid:7s} frames={r["frames"]:3d} open={r["frames_with_open_eyes"]:3d} blink={r["frames_with_closed_blink"]:3d} 0eyes={r["frames_with_0_eyes"]:3d}')
        return

    cat_id = args[0]
    if '--preview' in args:
        r = process_cat(cat_id, preview=True)
    else:
        r = process_cat(cat_id, dry_run='--dry-run' in args)
    print(json.dumps(r, indent=2))


if __name__ == '__main__':
    main()
