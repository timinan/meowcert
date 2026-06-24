import { BACKING_CATALOG, type BackingVibe } from '@/../shared/state';

export interface TempoEntry {
  speedLabel: string;
  bpm: number;
}

/** Derive the tempo cycle from BACKING_CATALOG so any UI offering tempo
 *  picks only offers BPMs we actually have music for. One entry per
 *  unique speedLabel, sorted by BPM. When multiple backings share a
 *  label, picks the lowest BPM to keep the cycle predictable. */
export function buildTempoCycle(): TempoEntry[] {
  const byLabel = new Map<string, TempoEntry>();
  for (const backing of Object.values(BACKING_CATALOG)) {
    const existing = byLabel.get(backing.speedLabel);
    if (!existing || backing.bpm < existing.bpm) {
      byLabel.set(backing.speedLabel, {
        speedLabel: backing.speedLabel,
        bpm: backing.bpm,
      });
    }
  }
  return [...byLabel.values()].sort((a, b) => a.bpm - b.bpm);
}

const VIBE_DISPLAY_ORDER: BackingVibe[] = ['upbeat', 'melodic', 'smooth'];

/** Vibes available at a given BPM. UI vibe pickers should only show
 *  options that actually have at least one backing at the current tempo
 *  so an empty pick is impossible. */
export function buildVibeCycle(bpm: number): BackingVibe[] {
  const set = new Set<BackingVibe>();
  for (const backing of Object.values(BACKING_CATALOG)) {
    if (backing.bpm === bpm) set.add(backing.vibe);
  }
  return VIBE_DISPLAY_ORDER.filter((v) => set.has(v));
}
