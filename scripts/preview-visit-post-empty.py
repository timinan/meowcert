#!/usr/bin/env python3
"""Render static PNG previews of the two empty-chart splash surfaces so
the composition can be pixel-checked before wiring it into either.

1. `empty-splash.png` — Phaser VisitPost scene, 320x580 design canvas.
2. `empty-splash-card.png` — Devvit HTML splash card (splash.html +
   splash.css with body.empty-chart), roughly 380x700 to match a phone
   feed viewport.

Both use the brand palette; the button label is rendered with a system
font because the project ships Pixeloid webfonts via CSS, not TTFs on
disk. The color/position check is what matters, not glyph fidelity.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / 'public' / 'assets' / 'images' / 'logo.png'
OUT_DIR = ROOT / 'tools' / 'visit-post-preview'
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT = OUT_DIR / 'empty-splash.png'

W, H = 320, 580
BG = (0x1a, 0x0a, 0x2e)
BTN = (0xff, 0xd3, 0x4d)
BTN_TEXT = (0x1a, 0x0a, 0x2e)

img = Image.new('RGB', (W, H), BG)

logo = Image.open(LOGO).convert('RGBA')
logo = logo.resize((220, 220), Image.NEAREST)
logo_cx, logo_cy = W // 2, int(H * 0.36)
img.paste(logo, (logo_cx - 110, logo_cy - 110), logo)

btn_cx, btn_cy = W // 2, int(H * 0.62)
btn_w, btn_h = 220, 48
draw = ImageDraw.Draw(img)
draw.rectangle(
    [btn_cx - btn_w // 2, btn_cy - btn_h // 2, btn_cx + btn_w // 2, btn_cy + btn_h // 2],
    fill=BTN,
)

try:
    font = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 18)
except Exception:
    font = ImageFont.load_default()
label = 'PLAY NOW'
tb = draw.textbbox((0, 0), label, font=font)
tw, th = tb[2] - tb[0], tb[3] - tb[1]
draw.text((btn_cx - tw // 2, btn_cy - th // 2 - 2), label, fill=BTN_TEXT, font=font)

# Butters memorial — barely visible below the button.
try:
    small_font = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 10)
except Exception:
    small_font = font
memoriam = '(in memory of Butters)'
mb = draw.textbbox((0, 0), memoriam, font=small_font)
mw = mb[2] - mb[0]
draw.text((W // 2 - mw // 2, int(H * 0.70)), memoriam, fill=(0x2a, 0x1a, 0x4a), font=small_font)

img.save(OUT)
print(f'wrote {OUT.relative_to(ROOT)}  ({W}x{H})')

# --- splash-card empty-chart preview (Devvit HTML surface) ----------
CARD_W, CARD_H = 380, 700
card = Image.new('RGB', (CARD_W, CARD_H), (0x0b, 0x04, 0x1a))

# Stage band stretches to fill vertical space in empty-chart mode. The
# actual CSS uses flex-grow, but we approximate with a fixed inset that
# leaves room for the button at the bottom.
STAGE_INSET_TOP = 8
STAGE_INSET_BOT = 100
stage_draw = ImageDraw.Draw(card)
stage_draw.rectangle(
    [0, STAGE_INSET_TOP, CARD_W, CARD_H - STAGE_INSET_BOT],
    fill=(0x1a, 0x0a, 0x2e),
)

# Logo centered at 36% of viewport — matches Preloader loading-screen
# anchor exactly so the feed splash → Devvit modal → Preloader chain
# reads as "logo stays put".
logo2 = Image.open(LOGO).convert('RGBA')
LOGO_W = min(260, int(CARD_W * 0.66))
logo2 = logo2.resize((LOGO_W, LOGO_W), Image.NEAREST)
logo2_cx = CARD_W // 2
logo2_cy = int(CARD_H * 0.36)
card.paste(logo2, (logo2_cx - LOGO_W // 2, logo2_cy - LOGO_W // 2), logo2)

# Play button centered on 62% of viewport — Preloader loading-bar
# center. Same width bounds as CSS (calc(100% - 32px), max 260).
card_draw = ImageDraw.Draw(card)
BTN_H = 46
btn_w_target = min(260, CARD_W - 32)
btn_cx = CARD_W // 2
btn_cy = int(CARD_H * 0.62)
card_draw.rectangle(
    [btn_cx - btn_w_target // 2, btn_cy - BTN_H // 2,
     btn_cx + btn_w_target // 2, btn_cy + BTN_H // 2],
    fill=BTN,
)
btn_label = '▶  TAP TO PLAY'
tb2 = card_draw.textbbox((0, 0), btn_label, font=font)
tw2, th2 = tb2[2] - tb2[0], tb2[3] - tb2[1]
card_draw.text(
    (btn_cx - tw2 // 2, btn_cy - th2 // 2 - 2),
    btn_label,
    fill=BTN_TEXT,
    font=font,
)

# Butters memorial under the button.
mb2 = card_draw.textbbox((0, 0), memoriam, font=small_font)
mw2 = mb2[2] - mb2[0]
card_draw.text(
    (CARD_W // 2 - mw2 // 2, int(CARD_H * 0.70)),
    memoriam,
    fill=(0x2a, 0x1a, 0x4a),
    font=small_font,
)

OUT_CARD = OUT_DIR / 'empty-splash-card.png'
card.save(OUT_CARD)
print(f'wrote {OUT_CARD.relative_to(ROOT)}  ({CARD_W}x{CARD_H})')
