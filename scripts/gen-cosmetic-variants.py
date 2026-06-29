"""Cosmetic color-variant explorer: per base cosmetic, generate 10 hue-rotated
recolors that preserve shadow/highlight relationships within the new hue.

How it differs from a flat tint:
- Per-pixel HSL rotation: shadows STAY proportionally darker, highlights stay
  light. Flat multiply tints crush the value relationships → everything looks
  the same lightness.
- Near-gray pixels (saturation < 0.08) untouched: black outlines stay black,
  white poms stay white, silver chains barely shift (correct — they have no
  real hue to rotate).
- 10 evenly-spaced target hues: red, orange, yellow, lime, green, teal, blue,
  purple, magenta, pink.

Output:
- tools/cosmetics/variants/imgs/<id>_base.png and <id>_<hue>.png per cosmetic
- tools/cosmetics/variants/index.html — visual explorer page

Run:
    npm run cosmetic-variants
    # or POST /run-cosmetic-variants from the page's Generate button
"""
import json, os, colorsys
from PIL import Image
from pathlib import Path

ROOT = Path('.')
ATL_PNG = ROOT / 'public/assets/atlas/cosmetics.png'
ATL_JSON = ROOT / 'public/assets/atlas/cosmetics.json'
CAT_JSON = ROOT / 'tools/cosmetics/cosmetics.json'

OUT_DIR = ROOT / 'tools/cosmetics/variants'
IMG_DIR = OUT_DIR / 'imgs'
OUT_DIR.mkdir(parents=True, exist_ok=True)
IMG_DIR.mkdir(parents=True, exist_ok=True)
# Wipe stale images so removed cosmetics don't leave orphans
for f in IMG_DIR.glob('*.png'):
    f.unlink()

HUE_TARGETS = [
    ('red',     0),
    ('orange',  30),
    ('yellow',  55),
    ('lime',    90),
    ('green',   135),
    ('teal',    175),
    ('blue',    220),
    ('purple',  270),
    ('magenta', 305),
    ('pink',    330),
]

atlas = Image.open(ATL_PNG).convert('RGBA')
atl_json = json.load(open(ATL_JSON))
frames = {f['filename']: f for f in atl_json['frames']}
cat = json.load(open(CAT_JSON))


def extract_canvas(name):
    fr = frames.get(name)
    if not fr:
        return None
    src = fr['frame']
    spr = fr['spriteSourceSize']
    sz = fr['sourceSize']
    canvas = Image.new('RGBA', (sz['w'], sz['h']), (0, 0, 0, 0))
    canvas.paste(
        atlas.crop((src['x'], src['y'], src['x'] + src['w'], src['y'] + src['h'])),
        (spr['x'], spr['y']),
    )
    return canvas


def crop_to_content(img):
    bbox = img.getbbox()
    return img.crop(bbox) if bbox else img


def dominant_hue(img):
    """Saturation-weighted dominant hue. Skips near-grays."""
    pixels = img.getdata()
    hue_buckets = [0.0] * 360
    for r, g, b, a in pixels:
        if a < 50:
            continue
        h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        if s < 0.15:
            continue
        bucket = int(h * 360) % 360
        hue_buckets[bucket] += s * (1.0 - abs(0.5 - l) * 2)
    if max(hue_buckets) == 0:
        return None
    return max(range(360), key=lambda i: hue_buckets[i])


def shift_hue(img, target_h_deg, source_h_deg):
    """Per-pixel hue rotation, preserving lightness + saturation. Near-gray
    pixels left untouched so outlines/whites/blacks survive."""
    rotation = (target_h_deg - source_h_deg) / 360.0
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    src_px = img.load()
    dst_px = out.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = src_px[x, y]
            if a == 0:
                continue
            hh, ll, ss = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            if ss < 0.08:
                dst_px[x, y] = (r, g, b, a)
                continue
            new_h = (hh + rotation) % 1.0
            nr, ng, nb = colorsys.hls_to_rgb(new_h, ll, ss)
            dst_px[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255), a)
    return out


def hue_to_swatch(deg):
    r, g, b = colorsys.hls_to_rgb(deg / 360, 0.5, 0.7)
    return f'#{int(r*255):02x}{int(g*255):02x}{int(b*255):02x}'


bases = [c for c in cat if not c.get('sourceFrame') and c.get('id') not in ('c58', 'c59')]
print(f'Generating variants for {len(bases)} bases × {len(HUE_TARGETS)} hues each')

manifest = []
for c in bases:
    cid = c['id']
    frame_name = f'cosmetic_{cid}_idle_00'
    img = extract_canvas(frame_name)
    if img is None:
        print(f'  SKIP {cid}: no atlas frame {frame_name}')
        continue
    img = crop_to_content(img)
    src_hue = dominant_hue(img)
    base_path = IMG_DIR / f'{cid}_base.png'
    img.save(base_path)
    variants = []
    if src_hue is None:
        for hname, _ in HUE_TARGETS:
            variants.append((hname, base_path.name, True))
    else:
        for hname, hdeg in HUE_TARGETS:
            v_img = shift_hue(img, hdeg, src_hue)
            v_path = IMG_DIR / f'{cid}_{hname}.png'
            v_img.save(v_path)
            variants.append((hname, v_path.name, False))
    manifest.append(
        {
            'id': cid,
            'name': c.get('name', ''),
            'slot': c.get('slot', ''),
            'base': base_path.name,
            'src_hue': src_hue,
            'variants': variants,
        }
    )

# --- Build HTML ---
slot_order = ['head', 'face', 'neck']
slot_label = {'head': 'HEAD', 'face': 'FACE', 'neck': 'NECK'}
by_slot = {s: [c for c in manifest if c['slot'] == s] for s in slot_order}

rows_html = []
for slot in slot_order:
    items = by_slot[slot]
    if not items:
        continue
    rows_html.append(f'<h2 class="slot-hdr">{slot_label[slot]} · {len(items)} cosmetics</h2>')
    for c in items:
        var_cells = []
        for hname, vfile, is_gray in c['variants']:
            label = hname + (' *' if is_gray else '')
            var_cells.append(
                f'<div class="vcell"><img src="imgs/{vfile}" alt="{hname}"/><div class="vlbl">{label}</div></div>'
            )
        src_h = c['src_hue']
        hue_note = f'src hue {src_h}°' if src_h is not None else 'grayscale source'
        rows_html.append(
            f'''
        <div class="row">
          <div class="base">
            <img src="imgs/{c['base']}" alt="{c['id']}"/>
            <div class="bid">{c['id']}</div>
            <div class="bnm">{c['name']}</div>
            <div class="bhue">{hue_note}</div>
          </div>
          <div class="variants">{''.join(var_cells)}</div>
        </div>'''
        )

hdr_swatches = ''.join(
    f'<div class="vh"><span class="sw" style="background:{hue_to_swatch(d)}"></span><span>{n}</span></div>'
    for n, d in HUE_TARGETS
)

html = f'''<!doctype html>
<html><head><meta charset="utf-8"/>
<title>meowcert · cosmetic color variants</title>
<style>
  :root {{
    --bg: #1a0a2e; --bg2: #261540; --bg3: #341c5a;
    --text: #fff; --muted: #c0a0e6; --accent: #ffd34d;
  }}
  body {{ margin: 0; background: var(--bg); color: var(--text);
    font-family: system-ui, -apple-system, sans-serif; font-size: 13px; }}
  .hdr {{ position: sticky; top: 40px; z-index: 50; background: var(--bg);
    padding: 14px 20px 10px; border-bottom: 1px solid var(--bg3); }}
  .hdr h1 {{ margin: 0 0 4px; font-size: 18px; color: var(--accent); }}
  .hdr .sub {{ color: var(--muted); font-size: 12px; margin-bottom: 8px; }}
  .palette {{ display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }}
  .vh {{ display: flex; align-items: center; gap: 4px; font-size: 11px;
    color: var(--muted); padding: 3px 7px; background: var(--bg2); border-radius: 4px; }}
  .vh .sw {{ width: 12px; height: 12px; border-radius: 3px; border: 1px solid #0006; }}
  .navbtn {{ display: inline-block; padding: 4px 12px; background: #4a7c3a; color: #fff;
    border: 1px solid #6ba85a; border-radius: 4px; font-size: 12px;
    cursor: pointer; font-family: inherit; margin-left: 16px; }}
  .navbtn:hover {{ background: #5a9c44; }}
  .navbtn:disabled {{ opacity: 0.55; cursor: progress; }}
  .navbtn.err {{ background: #8b2c2c; border-color: #c44; }}
  .slot-hdr {{ margin: 28px 20px 8px; color: var(--accent); font-size: 14px;
    letter-spacing: 1px; padding-bottom: 4px; border-bottom: 1px solid var(--bg3); }}
  .row {{ display: flex; gap: 14px; padding: 12px 20px; align-items: flex-start;
    border-bottom: 1px solid #2a1845; }}
  .row:nth-child(even) {{ background: #14082599; }}
  .base {{ flex: 0 0 130px; text-align: center; padding: 10px; background: var(--bg2);
    border-radius: 8px; border: 2px solid var(--accent); }}
  .base img {{ display: block; margin: 0 auto 6px; width: 80px; height: auto;
    image-rendering: pixelated; }}
  .base .bid {{ color: var(--accent); font-weight: 700; font-size: 13px; }}
  .base .bnm {{ color: var(--text); font-size: 11px; margin: 2px 0; }}
  .base .bhue {{ color: var(--muted); font-size: 10px; }}
  .variants {{ display: grid; grid-template-columns: repeat(10, 1fr); gap: 8px;
    flex: 1; min-width: 0; }}
  .vcell {{ background: var(--bg2); border-radius: 6px; padding: 8px 4px;
    text-align: center; min-width: 0; }}
  .vcell img {{ display: block; margin: 0 auto 4px; width: 60px; height: auto;
    image-rendering: pixelated; }}
  .vlbl {{ color: var(--muted); font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.5px; }}
  @media (max-width: 1200px) {{
    .variants {{ grid-template-columns: repeat(5, 1fr); }}
  }}
</style></head>
<body>
  <div class="hdr">
    <h1>cosmetic color variants</h1>
    <div class="sub">
      Each base cosmetic shown with 10 hue-rotated variants. HSL-aware rotation
      preserves shadow/highlight relationships within the new hue — darker shadows
      stay darker, blacks stay black, whites stay white. Near-gray sources
      (saturation &lt; 0.08, marked <code>*</code>) won't shift much because they
      have no real hue to rotate.
    </div>
    <div class="palette">
      {hdr_swatches}
      <button class="navbtn" id="gen-btn" onclick="regenerate()">🔄 Generate (delete + rerun)</button>
    </div>
  </div>
  {''.join(rows_html)}
  <script src="/tools-nav.js"></script>
  <script>
    async function regenerate() {{
      const btn = document.getElementById('gen-btn');
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = '⏳ Generating…';
      btn.classList.remove('err');
      try {{
        const res = await fetch('/run-cosmetic-variants', {{ method: 'POST' }});
        const body = await res.json().catch(() => ({{ ok: false, error: 'bad json' }}));
        if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${{res.status}}`);
        btn.textContent = '✅ Reloading…';
        location.reload();
      }} catch (e) {{
        btn.classList.add('err');
        btn.textContent = '❌ ' + (e.message || 'failed');
        btn.disabled = false;
        setTimeout(() => {{ btn.textContent = original; btn.classList.remove('err'); }}, 5000);
      }}
    }}
  </script>
</body></html>
'''
(OUT_DIR / 'index.html').write_text(html)
print(f'\nWrote {OUT_DIR / "index.html"} ({len(manifest)} cosmetics × {len(HUE_TARGETS)} hues)')
