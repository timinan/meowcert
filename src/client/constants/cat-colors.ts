/**
 * Primary color per cat breed — used to tint the rhythm lanes so each
 * lane's color reads as "this cat's lane" at a glance. Hand-picked
 * against the catalog art: saturated enough to survive the
 * `liftTowardWhite` lane wash but still recognizable as the cat's hue.
 *
 * When a seat is empty, Game.resolveLaneTints copies the nearest
 * occupied lane's color so the playfield never has a stale default tint
 * next to a colored neighbour.
 */
import type { PlayerState, SeatId } from '@/../shared/state';

// Brightest fur tone per breed — eyes / ears / noses excluded. Tim's
// rule: pick the dominant FUR color, then nudge it a touch brighter
// than realism so the lane sings under the cat instead of muddying.
// Slightly punched-up vs the earlier picks.
export const CAT_COLOR_BY_BREED: Record<string, number> = {
  rainbow:  0xe6a5ff,  // bumped lavender — rainbow cats hue-cycle, neutral resting tone
  cat1:     0xf5a05a,  // Mochi — warm orange tabby (sprite is orange + white, not cream)
  cat2:     0xb0bdce,  // Biscuit — cool blue-grey tabby (sprite reads grey, not biscuit-tan)
  cat3:     0xc4c4c4,  // Pebble — lifted cool grey
  cat4:     0x8ea0b8,  // Marble — slate blue (sprite is grey-blue marble, not cream)
  cat5:     0x6c7585,  // Saffron — dark slate (sprite reads dark grey, not saffron-orange)
  cat6:     0xd28a4a,  // Inkwell — toasted tabby brown (sprite is orange-brown tabby, not purple)
  cat7:     0xffa7e0,  // Pinky — vivid pink
  cat8:     0x6c6c84,  // Inky — lifted slate (pure black washes flat)
  cat9:     0x9aa6b6,  // Gregre — British Shorthair cool blue-grey, lifted brighter than realism per the rule
  cat10:    0x6cf088,  // Jade — pop jade green (matches green aura)
  cat11:    0xb968ff,  // Purps — punchy purple
  cat12:    0xffc4de,  // Sakura — bright blossom pink
  cat13:    0x6c7785,  // Butters — darker British Shorthair grey, lifted brighter than realism per the rule
  // ===== AUTO-EXTRACTED dominant fur color for cat14+ (scripts/extract-cat-fur-colors.py one-off) =====
  // Algorithm: most-common opaque non-outline non-white non-ear-pink pixel from idle_00, lifted in HSL
  // by +0.10 lightness / +0.15 saturation per the cat-colors rule.
  cat14:    0x6e5252,  cat15:    0xffa470,  cat16:    0xe69d74,  cat17:    0xe9c785,
  cat18:    0xdac995,  cat19:    0xff9a70,  cat20:    0xf0b37e,  cat21:    0x8da4b8,
  cat22:    0xa9b2c5,  cat23:    0xf4cb7a,  cat24:    0xfff270,  cat25:    0x9fff70,
  cat26:    0x77f8f8,  cat27:    0x89e6b7,  cat28:    0xbe90de,  cat29:    0xf88277,
  cat30:    0xff70ce,  cat31:    0x70abff,  cat32:    0xa442fa,  cat33:    0xfe579d,
  cat34:    0x6e5252,  cat35:    0xe69d74,  cat36:    0x70abff,  cat37:    0xf88277,
  cat38:    0x70abff,  cat39:    0x6e5252,  cat40:    0x9fff70,  cat41:    0x89e6b7,
  cat42:    0xbe90de,  cat43:    0xff7070,  cat44:    0x77f8f8,  cat45:    0xaf6be0,
  cat46:    0x77f777,  cat47:    0xf0b37e,  cat48:    0xfff370,  cat49:    0xff70ce,
  cat50:    0x7bb7f3,  cat51:    0x6e5252,  cat52:    0xff7070,  cat53:    0xfff370,
  cat54:    0xff70a7,  cat55:    0x70eeff,  cat56:    0xc770ff,  cat57:    0xd6ff70,
  cat58:    0xff70e2,  cat59:    0xfff770,  cat61:    0x70fff7,  cat62:    0xc6b8a8,
  cat63:    0xc2acac,  cat64:    0x5c4444,  cat65:    0xc2acac,  cat66:    0xf9cb75,
  cat67:    0xecc182,  cat68:    0xefcf7f,  cat69:    0xf1cb7d,  cat70:    0x9bbad3,
  cat71:    0xf5c579,  cat72:    0x616187,  cat73:    0xe7ba87,  cat74:    0xe6c589,
  cat75:    0xcf9fab,  cat76:    0xf4b87a,  cat77:    0xfbc874,  cat78:    0xa9a9c5,
  // Bright neon single-tones (cat79-90)
  cat79:    0xffd046,  cat80:    0xfe4747,  cat81:    0xfa764b,  cat82:    0xffa346,
  cat83:    0xfff046,  cat84:    0xa3ff46,  cat85:    0x5de8ba,  cat86:    0x47fefe,
  cat87:    0x4784fe,  cat88:    0xa24ff6,  cat89:    0xfe47c1,  cat90:    0xf15496,
  // L/R splits — dominant picks one side (typically head color); fine for lane identity.
  cat91:    0xe38262,  cat92:    0xd96c9a,  cat93:    0x6cd9c8,  cat94:    0xb36fd5,
  cat96:    0xde6799,  cat99:    0x62e3d8,  cat103:   0x2f397b,  cat104:   0xc2acac,
  cat105:   0xe39862,  cat106:   0xe39862,  cat107:   0xe39862,  cat108:   0xe39862,
  cat109:   0x805e5e,  cat110:   0x805e5e,  cat113:   0x725454,  cat114:   0x8ca9b9,
  cat115:   0xd99a6c,  cat116:   0xd4b69a,
};

const SEAT_ORDER: SeatId[] = ['seat-left', 'seat-center', 'seat-right'];

/** Pump a base cat color toward the most-saturated form of its hue so
 *  the lane border reads as a vivid frame rather than a pastel outline.
 *  Game.drawLanes uses this for the opaque border specifically — the
 *  bar fill keeps the softer original. */
export function vividBorderColor(rgb: number): number {
  const r = ((rgb >> 16) & 0xff) / 255;
  const g = ((rgb >> 8) & 0xff) / 255;
  const b = (rgb & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max;
  const s = max === 0 ? 0 : (max - min) / max;
  // Boost saturation to ~0.85 minimum and pin value to 1.0 so the
  // border pops on the dark playfield bg. Hue is preserved.
  const newS = Math.max(s, 0.85);
  const newV = 1;
  let h: number;
  if (max === min) h = 0;
  else if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h *= 60;
  if (h < 0) h += 360;
  const c = newV * newS;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = newV - c;
  let rp = 0, gp = 0, bp = 0;
  if (h < 60)       { rp = c; gp = x; bp = 0; }
  else if (h < 120) { rp = x; gp = c; bp = 0; }
  else if (h < 180) { rp = 0; gp = c; bp = x; }
  else if (h < 240) { rp = 0; gp = x; bp = c; }
  else if (h < 300) { rp = x; gp = 0; bp = c; }
  else              { rp = c; gp = 0; bp = x; }
  const ri = Math.round((rp + m) * 255);
  const gi = Math.round((gp + m) * 255);
  const bi = Math.round((bp + m) * 255);
  // Near-grey inputs (Snow White) saturate to a faint cool blue —
  // that's not what we want for "vivid white border". Detect the
  // grey case and return solid white instead.
  if (v - min < 0.05) return 0xffffff;
  return (ri << 16) | (gi << 8) | bi;
}

/**
 * Shared resolver: pick the lane tint trio from the player's seated cats.
 *
 * Each lane takes the primary color of the cat in the matching seat (left
 * → lane 0, center → lane 1, right → lane 2). Empty seats inherit the
 * color of the nearest occupied lane so a single-cat lineup colors all
 * three lanes the same shade. When ZERO seats are filled, returns null so
 * the caller can fall back to a bg-sampled / default trio.
 *
 * Game.drawLanes and ChartEditor both use this so the playfield + the
 * editor preview always share the same per-lane identity. Don't reach
 * into PlayerState.seatedCats outside this helper for lane colours —
 * keep all the logic here so changes ripple to every screen at once.
 */
export function resolveLaneTintsFromSeatedCats(
  source: { seatedCats?: PlayerState['seatedCats']; ownedCats?: { id: string; breed: string }[] } | null,
): [number, number, number] | null {
  const seatedCats = source?.seatedCats ?? {};
  const ownedCats = source?.ownedCats ?? [];
  const laneColors: (number | null)[] = [null, null, null];
  for (let i = 0; i < 3; i++) {
    const seatId = SEAT_ORDER[i]!;
    const instanceId = seatedCats[seatId];
    if (!instanceId) continue;
    const cat = ownedCats.find((c) => c.id === instanceId);
    if (!cat) continue;
    const color = CAT_COLOR_BY_BREED[cat.breed];
    if (color !== undefined) laneColors[i] = color;
  }
  if (!laneColors.some((c) => c !== null)) return null;
  for (let i = 0; i < 3; i++) {
    if (laneColors[i] !== null) continue;
    for (let d = 1; d < 3; d++) {
      const right = i + d;
      const left = i - d;
      const rightColor = right < 3 ? laneColors[right] : null;
      if (rightColor !== null && rightColor !== undefined) {
        laneColors[i] = rightColor;
        break;
      }
      const leftColor = left >= 0 ? laneColors[left] : null;
      if (leftColor !== null && leftColor !== undefined) {
        laneColors[i] = leftColor;
        break;
      }
    }
  }
  return [laneColors[0]!, laneColors[1]!, laneColors[2]!];
}
