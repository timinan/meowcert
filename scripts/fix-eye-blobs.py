"""Fix cats with the "tiny white pupil + dark all around" eye pattern.

Detects dark eye blobs in the face region of each cat frame and replaces
them with a proper cat-eye structure:
  - Keep the dark outer rim (preserves silhouette)
  - Fill interior with white sclera
  - Place a small orange iris in the center
  - Tiny dark pupil + tiny white highlight on the orange

Operates per-frame (eye position shifts slightly between anim frames),
so we don't hardcode coordinates. Uses connected-component detection
restricted to the upper-face Y band.

Usage:
  python3 scripts/fix-eye-blobs.py <cat_id> [--preview]
  python3 scripts/fix-eye-blobs.py cat13            # apply in-place + backup
  python3 scripts/fix-eye-blobs.py cat13 --preview  # write /tmp/eyefix-cat13.png
  python3 scripts/fix-eye-blobs.py --all            # scan all cats, apply where needed
"""
import json
import shutil
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import numpy as np

ROOT = Path('.')
RAW = ROOT / 'assets-raw'
BACKUPS = ROOT / 'assets-raw-backups' / 'eye-fix'

# Face-region Y band where eyes can live (for a 91x64 cat frame; eyes
# sit roughly y=18-36 across all base cats inspected).
FACE_Y_MIN, FACE_Y_MAX = 14, 38

# A "dark eye pixel" is a low-luminance, opaque pixel.
DARK_LUMA_MAX = 110  # R+G+B sum
ALPHA_MIN = 200

# Blob acceptance — a real eye blob is roughly 4-12 px wide x 4-9 tall
BLOB_MIN_SIZE = 12
BLOB_MAX_SIZE = 90
BLOB_MIN_W, BLOB_MAX_W = 3, 12
BLOB_MIN_H, BLOB_MAX_H = 3, 10

# Eye palette — matched to cat2 Biscuit + cat6 Inkwell (same artist, same
# eye spec). Both reference cats use these exact RGB values pixel-for-pixel:
#   IRIS    = (255, 162,  20)   orange iris on the outer edge
#   PUPIL   = ( 42,  47,  78)   dark blue-black pupil — NOT pure black
#   HIGHLIGHT = (255, 255, 255) 2x2 white glint inside the dark
# Using a fixed PUPIL (instead of median-of-original) is critical — Butters'
# source art used pure black (0,0,0) for the eye, which reads visibly
# different from the dark blue cat2/cat6 use.
IRIS = (255, 162, 20, 255)
PUPIL = (42, 47, 78, 255)
HIGHLIGHT = (255, 255, 255, 255)


def load_rgba(p: Path) -> np.ndarray:
    return np.array(Image.open(p).convert('RGBA'))


def save_rgba(a: np.ndarray, p: Path):
    Image.fromarray(a, 'RGBA').save(p)


def find_eye_blobs(a: np.ndarray):
    """Return list of (xs, ys) where each entry is the (cols, rows) pixel
    sets of a dark blob in the eye region."""
    r, g, b, alpha = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int), a[..., 3]
    luma = r + g + b
    mask = np.zeros_like(alpha, dtype=bool)
    mask[FACE_Y_MIN:FACE_Y_MAX, :] = (luma[FACE_Y_MIN:FACE_Y_MAX, :] < DARK_LUMA_MAX) & (alpha[FACE_Y_MIN:FACE_Y_MAX, :] > ALPHA_MIN)

    # Connected components (4-neighbor flood fill)
    visited = np.zeros_like(mask, dtype=bool)
    blobs = []
    h, w = mask.shape
    for y in range(h):
        for x in range(w):
            if not mask[y, x] or visited[y, x]:
                continue
            stack = [(y, x)]
            xs, ys = [], []
            while stack:
                cy, cx = stack.pop()
                if cy < 0 or cy >= h or cx < 0 or cx >= w:
                    continue
                if visited[cy, cx] or not mask[cy, cx]:
                    continue
                visited[cy, cx] = True
                xs.append(cx)
                ys.append(cy)
                stack.extend([(cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)])
            if not xs:
                continue
            bw = max(xs) - min(xs) + 1
            bh = max(ys) - min(ys) + 1
            sz = len(xs)
            if (BLOB_MIN_SIZE <= sz <= BLOB_MAX_SIZE
                    and BLOB_MIN_W <= bw <= BLOB_MAX_W
                    and BLOB_MIN_H <= bh <= BLOB_MAX_H):
                blobs.append((xs, ys))
    return blobs


# Eye template = cat6 Inkwell's LEFT-eye exact pixel layout, 6 wide x 8 tall.
# `.` = restore to face color (transparent in template, the cat's fur shows through)
# `O` = IRIS orange    `P` = PUPIL dark-blue    `W` = HIGHLIGHT white
# Taken directly from cat6 idle_00 pixel sample (cols 35-40, rows 25-32):
#   r0: ..PPPP..    (narrow eyelid top, 4 dark)
#   r1: OOOPPP      (3 orange iris bulge + 3 dark)
#   r2: OOPWWP      (highlight band: 2 iris + 1 dark + 2 white + 1 dark)
#   r3: OOPWWP
#   r4: OOPPPP      (2 iris + 4 dark)
#   r5: OOPPPP
#   r6: OOPPPP
#   r7: ..PP..      (narrow eyelid bottom, 2 dark)
EYE_TEMPLATE_LEFT = [
    ['.', 'P', 'P', 'P', 'P', '.'],
    ['O', 'O', 'O', 'P', 'P', 'P'],
    ['O', 'O', 'P', 'W', 'W', 'P'],
    ['O', 'O', 'P', 'W', 'W', 'P'],
    ['O', 'O', 'P', 'P', 'P', 'P'],
    ['O', 'O', 'P', 'P', 'P', 'P'],
    ['O', 'O', 'P', 'P', 'P', 'P'],
    ['.', '.', 'P', 'P', '.', '.'],
]
TEMPLATE_W = 6
TEMPLATE_H = 8


def _mirror_template(t):
    return [list(reversed(row)) for row in t]


EYE_TEMPLATE_RIGHT = _mirror_template(EYE_TEMPLATE_LEFT)


def sample_face_color(a: np.ndarray, blob_set: set, x_min: int, x_max: int,
                      y_min: int, y_max: int) -> tuple:
    """Sample the cat's fur color around (but not inside) the eye blob.

    Looks at a 2-px ring outside the blob bbox, ignores transparent pixels,
    pure-white pixels (could be eye highlight from prior fix), and pixels
    inside the blob itself. Returns the median (R,G,B,A=255).
    """
    samples = []
    for y in range(max(0, y_min - 2), min(a.shape[0], y_max + 3)):
        for x in range(max(0, x_min - 2), min(a.shape[1], x_max + 3)):
            if (y, x) in blob_set:
                continue
            # Skip the interior of the bbox (only the surrounding ring)
            if x_min <= x <= x_max and y_min <= y <= y_max:
                continue
            r, g, b, alpha = a[y, x]
            if alpha < 200:
                continue
            r, g, b = int(r), int(g), int(b)
            # Skip pure-white snout markings + pure-black outline
            if r > 240 and g > 240 and b > 240:
                continue
            if r < 25 and g < 25 and b < 25:
                continue
            samples.append((r, g, b))
    if not samples:
        return (125, 136, 150, 255)  # default Butters grey
    arr = np.array(samples)
    return (int(np.median(arr[:, 0])), int(np.median(arr[:, 1])),
            int(np.median(arr[:, 2])), 255)


def fill_blob(a: np.ndarray, xs, ys, frame_w: int):
    """Erase the existing dark eye blob + stamp the cat6 almond template.

    The previous recolor-in-place approach was wrong — Butters' source art
    has a rectangular eye outline, so painting orange + dark + white INSIDE
    that wrong shape produced an eye with cat6's colors but the wrong
    silhouette. We instead erase Butters' eye art entirely (replacing with
    surrounding fur color) and stamp the cat6 template centered on the
    detected eye centroid.
    """
    pix = set(zip(ys, xs))
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    cx = sum(xs) / len(xs)
    cy = sum(ys) / len(ys)

    is_left_eye = cx < frame_w / 2

    # 1. Sample face color from the ring around the blob.
    face_color = sample_face_color(a, pix, x_min, x_max, y_min, y_max)

    # 2. Build the "eye region to erase" — dark blob pixels + interior whites
    # (legacy tiny-pupil markings sit inside the blob surrounded by dark).
    eye_pixels = set(pix)
    for y in range(y_min, y_max + 1):
        for x in range(x_min, x_max + 1):
            if (y, x) in eye_pixels:
                continue
            r, g, b, alpha = a[y, x]
            if alpha < 50:
                continue
            if int(r) > 200 and int(g) > 200 and int(b) > 200:
                neighbours_in_blob = sum(
                    1 for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]
                    if (y + dy, x + dx) in pix
                )
                if neighbours_in_blob >= 2:
                    eye_pixels.add((y, x))

    # 3. Erase the eye region to face color (template will overwrite the
    # parts that should be eye).
    for (y, x) in eye_pixels:
        a[y, x] = face_color

    # 4. Stamp the template centered on the blob centroid.
    template = EYE_TEMPLATE_LEFT if is_left_eye else EYE_TEMPLATE_RIGHT
    # Template center is at (TEMPLATE_W/2 - 0.5, TEMPLATE_H/2 - 0.5).
    tx = int(round(cx - (TEMPLATE_W / 2 - 0.5)))
    ty = int(round(cy - (TEMPLATE_H / 2 - 0.5)))

    color_map = {'O': IRIS, 'P': PUPIL, 'W': HIGHLIGHT}
    for dy in range(TEMPLATE_H):
        for dx in range(TEMPLATE_W):
            cell = template[dy][dx]
            if cell == '.':
                continue
            y, x = ty + dy, tx + dx
            if 0 <= y < a.shape[0] and 0 <= x < a.shape[1]:
                a[y, x] = color_map[cell]


def fix_frame(a: np.ndarray) -> tuple[np.ndarray, int]:
    """Returns (fixed_array, number_of_blobs_fixed).

    Picks the 2 most-eye-like blobs: smallest mean-Y (eyes sit high in the
    face), then must be a symmetric pair (centers mirrored around frame_w/2
    within ~5 px). When fewer than 2 blobs qualify or no symmetric pair
    exists (sleep frames, full-star meow frames), the frame is left
    untouched rather than smearing orange onto ears, teeth, or stars.
    """
    blobs = find_eye_blobs(a)
    out = a.copy()
    if len(blobs) < 2:
        return out, 0
    frame_w = a.shape[1]

    # Compute (cx, cy, xs, ys) for each blob
    items = []
    for xs, ys in blobs:
        cx = sum(xs) / len(xs)
        cy = sum(ys) / len(ys)
        items.append((cx, cy, xs, ys))

    # Sort by y (highest = smallest y first)
    items.sort(key=lambda it: it[1])

    # Try every pair (prefer upper blobs first) and pick the first one
    # that's symmetric around the frame's horizontal center.
    chosen = None
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            cxi, cyi, _, _ = items[i]
            cxj, cyj, _, _ = items[j]
            # similar Y (within 3 px) and mirror-symmetric around frame_w/2
            if abs(cyi - cyj) > 3:
                continue
            mirror_err = abs((cxi + cxj) / 2 - frame_w / 2)
            if mirror_err > 5:
                continue
            chosen = sorted([items[i], items[j]], key=lambda it: it[0])
            break
        if chosen:
            break

    if not chosen:
        return out, 0

    # Skip frames where the detected eye blob is much shorter than the
    # template (squinted lick/sleepy eyes). Stamping a tall almond on a
    # 3-row blob makes a half-closed cat suddenly look wide-eyed.
    SQUINT_MIN_HEIGHT = TEMPLATE_H - 2  # 6 rows minimum
    for cx, cy, xs, ys in chosen:
        bh = max(ys) - min(ys) + 1
        if bh < SQUINT_MIN_HEIGHT:
            return out, 0

    # Skip frames where the eye INTERIOR is dominated by an intentional
    # colored design (meow frames have a yellow star pupil filling 8+ pixels).
    # One or two isolated colored pixels (hiss frames where a red shock-
    # asterisk arm crosses the eye) do NOT count — those are overlays, the
    # eye underneath still needs the fix.
    COLORED_PIXEL_SKIP_THRESHOLD = 4
    for cx, cy, xs, ys in chosen:
        blob_set = set(zip(ys, xs))
        x_min, x_max = min(xs), max(xs)
        y_min, y_max = min(ys), max(ys)
        colored_count = 0
        for y in range(y_min, y_max + 1):
            for x in range(x_min, x_max + 1):
                if (y, x) in blob_set:
                    continue
                r, g, b, alpha = a[y, x]
                if alpha < 50:
                    continue
                neighbours_in_blob = sum(
                    1 for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]
                    if (y + dy, x + dx) in blob_set
                )
                if neighbours_in_blob < 2:
                    continue
                r, g, b = int(r), int(g), int(b)
                hi, lo = max(r, g, b), min(r, g, b)
                if hi > 150 and (hi - lo) > 60:
                    colored_count += 1
        if colored_count >= COLORED_PIXEL_SKIP_THRESHOLD:
            return out, 0

    for cx, cy, xs, ys in chosen:
        fill_blob(out, xs, ys, frame_w)
    return out, 2


def make_preview(cat_id: str, frame_filename: str, before: np.ndarray, after: np.ndarray, save_to: Path):
    """8x-scale side-by-side comparison."""
    scale = 8
    h, w = before.shape[:2]
    gap = 30
    header = 30
    pw = w * scale
    ph = h * scale
    total_w = pw * 2 + gap * 3
    total_h = ph + header * 2 + 20
    img = Image.new('RGBA', (total_w, total_h), (255, 245, 200, 255))
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Courier New Bold.ttf', 18)
    except Exception:
        font = ImageFont.load_default()
    draw.text((gap, 4), f'{cat_id} {frame_filename}  —  BEFORE / AFTER (8x)', fill=(40, 20, 60, 255), font=font)
    bimg = Image.fromarray(before, 'RGBA').resize((pw, ph), Image.NEAREST)
    aimg = Image.fromarray(after, 'RGBA').resize((pw, ph), Image.NEAREST)
    img.paste(bimg, (gap, header), bimg)
    img.paste(aimg, (gap * 2 + pw, header), aimg)
    draw.text((gap + pw // 2 - 40, header + ph + 4), 'BEFORE', fill=(120, 30, 30, 255), font=font)
    draw.text((gap * 2 + pw + pw // 2 - 30, header + ph + 4), 'AFTER', fill=(30, 110, 30, 255), font=font)
    img.save(save_to)


def cat_needs_fix(cat_id: str) -> bool:
    """Heuristic: cat needs fix if idle_00 has 2 dark eye blobs in the face band."""
    idle = RAW / cat_id / f'{cat_id}_idle_00.png'
    if not idle.exists():
        return False
    a = load_rgba(idle)
    blobs = find_eye_blobs(a)
    return len(blobs) >= 2


def process_cat(cat_id: str, dry_run: bool = False, preview: bool = False) -> dict:
    cat_dir = RAW / cat_id
    frames = sorted(cat_dir.glob(f'{cat_id}_*.png'))
    if not frames:
        return {'cat': cat_id, 'error': 'no frames'}

    if preview:
        # Use idle_00 specifically for a consistent reference shot
        idle = cat_dir / f'{cat_id}_idle_00.png'
        src = idle if idle.exists() else frames[0]
        a = load_rgba(src)
        fixed, n = fix_frame(a)
        prev = Path('/tmp') / f'eyefix-{cat_id}-preview.png'
        make_preview(cat_id, src.name, a, fixed, prev)
        return {'cat': cat_id, 'preview': str(prev), 'blobs_in_first_frame': n}

    BACKUPS.mkdir(parents=True, exist_ok=True)
    backup_dir = BACKUPS / cat_id
    backup_dir.mkdir(parents=True, exist_ok=True)
    counts = []
    for fp in frames:
        a = load_rgba(fp)
        fixed, n = fix_frame(a)
        # backup once
        bp = backup_dir / fp.name
        if not bp.exists():
            shutil.copy2(fp, bp)
        if not dry_run:
            save_rgba(fixed, fp)
        counts.append((fp.name, n))
    return {'cat': cat_id, 'frames_processed': len(counts),
            'frames_with_2_blobs': sum(1 for _, n in counts if n == 2),
            'frames_with_0_blobs': sum(1 for _, n in counts if n == 0)}


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)

    if args[0] == '--all':
        dry = '--dry-run' in args
        # Scan every cat directory
        cats = sorted([p.name for p in RAW.iterdir() if p.is_dir() and p.name.startswith('cat') and p.name[3:].isdigit()],
                      key=lambda s: int(s[3:]))
        affected = []
        for cid in cats:
            if cat_needs_fix(cid):
                affected.append(cid)
        print(f'cats needing fix (have ≥2 dark eye blobs): {len(affected)}')
        print(' '.join(affected))
        if dry:
            return
        for cid in affected:
            r = process_cat(cid)
            print(f'  {cid:6s}  frames={r["frames_processed"]:3d}  2-blob={r["frames_with_2_blobs"]:3d}  0-blob={r["frames_with_0_blobs"]:3d}')
        return

    cat_id = args[0]
    if '--preview' in args:
        r = process_cat(cat_id, preview=True)
        print(json.dumps(r, indent=2))
    else:
        r = process_cat(cat_id, dry_run='--dry-run' in args)
        print(json.dumps(r, indent=2))


if __name__ == '__main__':
    main()
