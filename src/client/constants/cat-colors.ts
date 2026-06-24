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
// Brightest fur tone per breed — eyes / ears / noses excluded. Tim's
// rule: pick the dominant FUR color, then nudge it a touch brighter
// than realism so the lane sings under the cat instead of muddying.
// Slightly punched-up vs the earlier picks.
export const CAT_COLOR_BY_BREED: Record<string, number> = {
  rainbow:  0xe6a5ff,  // bumped lavender — rainbow cats hue-cycle, neutral resting tone
  cat1:     0xfff7e8,  // Mochi — pearly cream
  cat2:     0xf5c690,  // Biscuit — bright toasted tan
  cat3:     0xc4c4c4,  // Pebble — lifted cool grey
  cat4:     0xeae3d0,  // Marble — bright marble cream
  cat5:     0xffb04d,  // Saffron — sun-bright orange
  cat6:     0x8f6cc7,  // Inkwell — vivid mid-purple (was muddy)
  cat7:     0xffa7e0,  // Pinky — vivid pink
  cat8:     0x6c6c84,  // Inky — lifted slate (pure black washes flat)
  cat9:     0xeef3fb,  // Snow White — clean bright cool white
  cat10:    0x6cf088,  // Jade — pop jade green (matches green aura)
  cat11:    0xb968ff,  // Purps — punchy purple
  cat12:    0xffc4de,  // Sakura — bright blossom pink
};
