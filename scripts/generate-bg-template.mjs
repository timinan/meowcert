/*
 * Generates background PNGs sized to match the existing 1536×1024 art
 * with 3 dashed white circles at the actual cat positions in the
 * vertical Phase 5 layout. The circles sit at canvas design-y ≈ 184
 * (cat feet, scaled 1.4×) and at the three lane centers — so when the
 * texture is stretched to fill the game canvas, the circles land
 * underneath the seated cats instead of way below them.
 *
 * Re-run any time: `node scripts/generate-bg-template.mjs`
 */
import sharpMod from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'themes');

// Image dimensions match Tim's source art so swap is drop-in.
const W = 1536;
const H = 1024;

// Game canvas design space — these are the constants the game uses when
// computing cat positions. Keep in sync with src/client/constants/scene-layout.ts.
const DESIGN_W = 320;
const DESIGN_H = 580;
const TOP_HUD_H = 36;
const CAT_STAGE_H = 190;
// cat Y in seatCats(): (TOP_HUD_H + CAT_STAGE_H * 0.78) = 184.2
const CAT_FEET_Y = TOP_HUD_H + CAT_STAGE_H * 0.78;
// Lane centers at LANE_GUTTER=0, LANE_GAP=0 → colW = DESIGN_W/3
const COL_W = DESIGN_W / 3;
const LANE_CENTERS = [COL_W / 2, COL_W * 1.5, COL_W * 2.5];

// Map design-space coordinates into image-space.
const designToImageX = (x) => Math.round((x / DESIGN_W) * W);
const designToImageY = (y) => Math.round((y / DESIGN_H) * H);

const CIRCLE_CENTERS = LANE_CENTERS.map((cx) => ({
  x: designToImageX(cx),
  y: designToImageY(CAT_FEET_Y),
}));
// Cat sprite is 91px tall × 1.4× scale = ~127 design pixels of width.
// Ovals slightly wider so the cat's feet sit nicely inside.
const CIRCLE_RX = Math.round((150 / DESIGN_W) * W);
const CIRCLE_RY = Math.round((28 / DESIGN_H) * H);

/**
 * Returns an SVG string with a themed gradient + 3 dashed circles at the
 * computed positions. Each theme has its own palette but the structure
 * (gradient + circles) is identical so tweaks stay consistent.
 */
function makeSvg(theme) {
  const palettes = {
    stage: {
      bg1: '#1a0a2e',
      bg2: '#3d1564',
      accent: '#c678ff',
      decor: `
        <!-- Stage backdrop suggestion: vertical light beams sweeping
             down from the top of the frame so the cats look spotlit. -->
        <g opacity="0.35">
          <polygon points="${W * 0.2},0 ${W * 0.18},${H * 0.5} ${W * 0.32},${H * 0.5} ${W * 0.3},0" fill="#ff9ed4"/>
          <polygon points="${W * 0.46},0 ${W * 0.44},${H * 0.5} ${W * 0.58},${H * 0.5} ${W * 0.56},0" fill="#6fbcff"/>
          <polygon points="${W * 0.72},0 ${W * 0.7},${H * 0.5} ${W * 0.84},${H * 0.5} ${W * 0.82},0" fill="#ffd34d"/>
        </g>
        <!-- Stage floor band behind the circles -->
        <rect x="0" y="${designToImageY(CAT_FEET_Y) - 60}" width="${W}" height="${(H * 0.6) | 0}" fill="#000" opacity="0.25"/>
      `,
    },
    forest: {
      bg1: '#0b1a2a',
      bg2: '#1a2f1f',
      accent: '#4dffb4',
      decor: `
        <g opacity="0.4">
          <!-- A few tree silhouettes peeking in at the edges -->
          <polygon points="0,0 ${W * 0.18},0 ${W * 0.14},${H * 0.6} ${W * 0.04},${H * 0.6}" fill="#000"/>
          <polygon points="${W * 0.85},0 ${W},0 ${W},${H * 0.6} ${W * 0.86},${H * 0.6}" fill="#000"/>
          <circle cx="${W * 0.78}" cy="${H * 0.14}" r="${H * 0.045}" fill="#fff8c0" opacity="0.55"/>
        </g>
      `,
    },
  };

  const p = palettes[theme];

  // Each lane gets the lane color as a soft tint inside the circle so
  // the editor / game reinforces the "left = blue, center = purple,
  // right = yellow" mental model from the actual lane bars.
  const laneTints = ['#6fbcff', '#c678ff', '#ffd34d'];
  const circles = CIRCLE_CENTERS.map(({ x, y }, i) => `
    <ellipse cx="${x}" cy="${y}" rx="${CIRCLE_RX}" ry="${CIRCLE_RY}"
             fill="${laneTints[i]}" fill-opacity="0.10"/>
    <ellipse cx="${x}" cy="${y}" rx="${CIRCLE_RX}" ry="${CIRCLE_RY}"
             fill="none" stroke="white" stroke-width="6"
             stroke-dasharray="22,14" opacity="0.9"/>
  `).join('');

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${p.bg1}"/>
        <stop offset="100%" stop-color="${p.bg2}"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    ${p.decor}
    ${circles}
  </svg>`;
}

async function render(theme, outName) {
  const svg = makeSvg(theme);
  const outPath = path.join(OUT_DIR, outName);
  await sharpMod(Buffer.from(svg)).png().toFile(outPath);
  console.log(`[gen-bg] wrote ${outPath}`);
}

await fs.mkdir(OUT_DIR, { recursive: true });
await render('stage', 'stage-bg.png');
await render('forest', 'forest-bg.png');
