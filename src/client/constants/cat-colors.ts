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
export const CAT_COLOR_BY_BREED: Record<string, number> = {
  rainbow:  0xc678ff,  // lavender — rainbow cats hue-cycle, so use a neutral resting tone
  cat1:     0xfff0dc,  // Mochi — soft cream
  cat2:     0xe3b07a,  // Biscuit — toasted tan
  cat3:     0x8c8c8c,  // Pebble — pebble grey
  cat4:     0xd8d4ca,  // Marble — pale marble cream
  cat5:     0xff9933,  // Saffron — saffron orange
  cat6:     0x4a3266,  // Inkwell — deep ink purple
  cat7:     0xff8ed4,  // Pinky — bright pink
  cat8:     0x3a3a4a,  // Inky — dark slate (pure black washes flat under the lane tint)
  cat9:     0xdce4f0,  // Snow White — cool soft white
  cat10:    0x4dcf6b,  // Jade — jade green (matches the equipped green aura)
  cat11:    0xa050ff,  // Purps — vibrant purple
  cat12:    0xffb1d6,  // Sakura — sakura blossom pink
};
